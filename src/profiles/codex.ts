import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalDirectory,
  canonicalTarget,
  displayPath,
  InputError,
  isWithin,
  pathChain,
} from "../core/paths.js";
import type {
  CodexTraceOptions,
  ProfileMetadata,
  TraceDecision,
  TraceResult,
  TraceStatus,
} from "../core/types.js";

const DEFAULT_MAX_BYTES = 32 * 1024;
const PRIMARY_NAMES = ["AGENTS.override.md", "AGENTS.md"] as const;
const SOURCE_ID = "codex-agents-md";
const SECURITY_SOURCE_ID = "ruletrace-security";

export const CODEX_PROFILE: ProfileMetadata = {
  id: "codex",
  displayName: "OpenAI Codex",
  verifiedOn: "2026-07-29",
  status: "implemented",
  sources: [
    {
      id: SOURCE_ID,
      label: "Custom instructions with AGENTS.md",
      url: "https://learn.chatgpt.com/docs/agent-configuration/agents-md.md",
    },
    {
      id: "codex-source",
      label: "Codex AGENTS.md discovery implementation",
      url: "https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs",
    },
    {
      id: SECURITY_SOURCE_ID,
      label: "Agent RuleTrace read boundary",
      url: "https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model",
    },
  ],
};

interface ExistingCandidate {
  absolutePath: string;
  readPath: string;
  displayPath: string;
  bytesAvailable: number;
  safe: boolean;
}

interface SelectedCandidate extends ExistingCandidate {
  kind: "user" | "project";
  shadowed: ExistingCandidate[];
}

function deduplicateNames(fallbacks: string[]): string[] {
  const names: string[] = [...PRIMARY_NAMES];
  for (const fallback of fallbacks) {
    const trimmed = fallback.trim();
    if (trimmed && !names.includes(trimmed)) {
      names.push(trimmed);
    }
  }
  return [...new Set(names)];
}

async function inspectCandidate(
  absolutePath: string,
  root: string,
  displayRoot: string,
  home?: string,
): Promise<ExistingCandidate | undefined> {
  let info;
  try {
    info = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  if (!info.isFile() && !info.isSymbolicLink()) {
    return undefined;
  }

  let resolved = absolutePath;
  if (info.isSymbolicLink()) {
    try {
      resolved = await realpath(absolutePath);
    } catch {
      return {
        absolutePath,
        readPath: absolutePath,
        displayPath: displayPath(displayRoot, absolutePath, home),
        bytesAvailable: 0,
        safe: false,
      };
    }
  }

  const safe = isWithin(root, resolved);
  const bytesAvailable = safe ? (await lstat(resolved)).size : 0;
  return {
    absolutePath,
    readPath: resolved,
    displayPath: displayPath(displayRoot, absolutePath, home),
    bytesAvailable,
    safe,
  };
}

async function selectInDirectory(
  directory: string,
  names: string[],
  safetyRoot: string,
  displayRoot: string,
  kind: "user" | "project",
  home?: string,
): Promise<SelectedCandidate | undefined> {
  const existing: ExistingCandidate[] = [];
  for (const name of names) {
    const candidate = await inspectCandidate(path.join(directory, name), safetyRoot, displayRoot, home);
    if (candidate) {
      existing.push(candidate);
    }
  }
  const selected = existing[0];
  if (!selected) {
    return undefined;
  }
  return { ...selected, kind, shadowed: existing.slice(1) };
}

function decisionForShadowed(
  candidate: ExistingCandidate,
  selected: ExistingCandidate,
  kind: "user" | "project",
): TraceDecision {
  return {
    path: candidate.displayPath,
    kind,
    phase: "startup",
    status: "shadowed",
    bytesAvailable: candidate.bytesAvailable,
    bytesIncluded: 0,
    reason: `${selected.displayPath} is the first existing candidate in this directory`,
    confidence: "documented",
    source: SOURCE_ID,
  };
}

async function loadSelected(
  candidate: SelectedCandidate,
  remaining: number | undefined,
  sequence: number,
): Promise<{ decision: TraceDecision; consumed: number; loaded: boolean }> {
  if (!candidate.safe) {
    return {
      decision: {
        path: candidate.displayPath,
        kind: candidate.kind,
        phase: "startup",
        status: "skipped-security-boundary",
        bytesAvailable: candidate.bytesAvailable,
        bytesIncluded: 0,
        reason: "symlink resolves outside the allowed discovery root",
        confidence: "documented",
        source: SECURITY_SOURCE_ID,
      },
      consumed: 0,
      loaded: false,
    };
  }

  if (remaining === 0) {
    return {
      decision: {
        path: candidate.displayPath,
        kind: candidate.kind,
        phase: "startup",
        status: "skipped-limit",
        bytesAvailable: candidate.bytesAvailable,
        bytesIncluded: 0,
        reason: "the Codex project instruction byte budget is exhausted",
        confidence: "documented",
        source: SOURCE_ID,
      },
      consumed: 0,
      loaded: false,
    };
  }

  const raw = await readFile(candidate.readPath);
  const allowed = remaining === undefined ? raw.length : Math.min(raw.length, remaining);
  const included = raw.subarray(0, allowed);
  const text = included.toString("utf8");
  if (text.trim() === "") {
    return {
      decision: {
        path: candidate.displayPath,
        kind: candidate.kind,
        phase: "startup",
        status: "skipped-empty",
        bytesAvailable: raw.length,
        bytesIncluded: 0,
        reason: "the first existing candidate contains no model-visible text",
        confidence: "documented",
        source: SOURCE_ID,
      },
      consumed: 0,
      loaded: false,
    };
  }

  const status: TraceStatus = allowed < raw.length ? "loaded-truncated" : "loaded";
  return {
    decision: {
      path: candidate.displayPath,
      kind: candidate.kind,
      phase: "startup",
      status,
      sequence,
      bytesAvailable: raw.length,
      bytesIncluded: allowed,
      reason:
        status === "loaded-truncated"
          ? "selected for this directory and truncated to the remaining Codex byte budget"
          : "selected as the first existing candidate for this directory",
      confidence: "documented",
      source: SOURCE_ID,
    },
    consumed: allowed,
    loaded: true,
  };
}

export async function traceCodex(options: CodexTraceOptions): Promise<TraceResult> {
  const cwd = await canonicalDirectory(options.cwd, "cwd");
  const root = await canonicalDirectory(options.root, "root");
  if (!isWithin(root, cwd)) {
    throw new InputError(`cwd must be inside root: cwd=${cwd}, root=${root}`);
  }
  const target = await canonicalTarget(options.target, cwd);
  if (!isWithin(root, target)) {
    throw new InputError(`target must be inside root: target=${target}, root=${root}`);
  }

  const includeUser = options.includeUser ?? false;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new InputError(`maxBytes must be a non-negative safe integer: ${maxBytes}`);
  }

  const fallbacks = options.fallbackFilenames ?? [];
  const names = deduplicateNames(fallbacks);
  const decisions: TraceDecision[] = [];
  const warnings: string[] = [];
  let sequence = 1;

  if (includeUser) {
    const home = await canonicalDirectory(options.codexHome ?? path.join(os.homedir(), ".codex"), "codex home");
    const existing: ExistingCandidate[] = [];
    for (const name of PRIMARY_NAMES) {
      const candidate = await inspectCandidate(path.join(home, name), home, root, home);
      if (candidate) {
        existing.push(candidate);
      }
    }

    let selectedIndex = -1;
    for (let index = 0; index < existing.length; index += 1) {
      const candidate = existing[index];
      if (!candidate) {
        continue;
      }
      if (!candidate.safe) {
        decisions.push({
          path: candidate.displayPath,
          kind: "user",
          phase: "startup",
          status: "skipped-security-boundary",
          bytesAvailable: candidate.bytesAvailable,
          bytesIncluded: 0,
          reason: "symlink resolves outside the allowed Codex home",
          confidence: "documented",
          source: SECURITY_SOURCE_ID,
        });
        warnings.push(`${candidate.displayPath} was not read because its symlink escapes the Codex home`);
        continue;
      }
      const raw = await readFile(candidate.readPath);
      if (raw.toString("utf8").trim() === "") {
        decisions.push({
          path: candidate.displayPath,
          kind: "user",
          phase: "startup",
          status: "skipped-empty",
          bytesAvailable: raw.length,
          bytesIncluded: 0,
          reason: "Codex skips an empty user-level candidate",
          confidence: "documented",
          source: SOURCE_ID,
        });
        continue;
      }

      selectedIndex = index;
      const selected: SelectedCandidate = {
        ...candidate,
        kind: "user",
        shadowed: existing.slice(index + 1),
      };
      const loaded = await loadSelected(selected, undefined, sequence);
      decisions.push(loaded.decision);
      sequence += 1;
      decisions.push(...selected.shadowed.map((item) => decisionForShadowed(item, selected, "user")));
      break;
    }

    if (selectedIndex === -1) {
      const alreadyReported = new Set(decisions.filter((item) => item.kind === "user").map((item) => item.path));
      for (const candidate of existing) {
        if (!alreadyReported.has(candidate.displayPath)) {
          decisions.push({
            path: candidate.displayPath,
            kind: "user",
            phase: "startup",
            status: "skipped-empty",
            bytesAvailable: candidate.bytesAvailable,
            bytesIncluded: 0,
            reason: "Codex found no non-empty user-level instructions",
            confidence: "documented",
            source: SOURCE_ID,
          });
        }
      }
    }
  }

  const projectSelections: SelectedCandidate[] = [];
  for (const directory of pathChain(root, cwd)) {
    const selected = await selectInDirectory(directory, names, root, root, "project");
    if (selected) {
      projectSelections.push(selected);
    }
  }

  let remaining = maxBytes;
  for (const selected of projectSelections) {
    const loaded = await loadSelected(selected, remaining, sequence);
    decisions.push(loaded.decision);
    decisions.push(...selected.shadowed.map((item) => decisionForShadowed(item, selected, "project")));
    if (loaded.loaded) {
      sequence += 1;
      remaining -= loaded.consumed;
    }
    if (loaded.decision.status === "loaded-truncated") {
      warnings.push(`${selected.displayPath} was truncated at the ${maxBytes}-byte project limit`);
    }
    if (loaded.decision.status === "skipped-security-boundary") {
      warnings.push(`${selected.displayPath} was not read because its symlink escapes the project root`);
    }
  }

  const included = decisions.filter(
    (decision) => decision.status === "loaded" || decision.status === "loaded-truncated",
  );
  const includedBytes = included.reduce((total, decision) => total + decision.bytesIncluded, 0);

  return {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    profile: CODEX_PROFILE,
    inputs: {
      root,
      cwd,
      target,
      includeUser,
    },
    decisions,
    summary: {
      includedFiles: included.length,
      includedBytes,
      approximateTokens: Math.ceil(includedBytes / 4),
      warnings,
    },
  };
}
