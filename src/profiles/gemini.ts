import { lstat, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractImports } from "../core/markdown.js";
import {
  canonicalDirectory,
  canonicalTarget,
  displayPath,
  InputError,
  isWithin,
  pathChain,
} from "../core/paths.js";
import type {
  GeminiTraceOptions,
  ProfileMetadata,
  TraceDecision,
  TraceResult,
} from "../core/types.js";

const DEFAULT_CONTEXT_FILENAME = "GEMINI.md";
const MAX_IMPORT_DEPTH = 5;
const SOURCE_ID = "gemini-context";
const SOURCE_CODE_ID = "gemini-memory-source";
const IMPORT_SOURCE_ID = "gemini-imports";
const SECURITY_SOURCE_ID = "ruletrace-security";

export const GEMINI_PROFILE: ProfileMetadata = {
  id: "gemini",
  displayName: "Google Gemini CLI",
  verifiedOn: "2026-07-29",
  status: "implemented",
  sources: [
    {
      id: SOURCE_ID,
      label: "Provide context with GEMINI.md files",
      url: "https://geminicli.com/docs/cli/gemini-md/",
    },
    {
      id: SOURCE_CODE_ID,
      label: "Gemini CLI memory discovery implementation",
      url: "https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/memoryDiscovery.ts",
    },
    {
      id: IMPORT_SOURCE_ID,
      label: "Memory Import Processor",
      url: "https://geminicli.com/docs/reference/memport/",
    },
    {
      id: SECURITY_SOURCE_ID,
      label: "Agent RuleTrace read boundary",
      url: "https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model",
    },
  ],
};

interface SettingCandidate {
  shownPath: string;
  names: string[];
  bytes: number;
}

interface ExistingCandidate {
  readPath: string;
  shownPath: string;
  bytes: number;
  identity?: string;
  safe: boolean;
  kind: "user" | "project" | "import";
}

interface TraceContext {
  root: string;
  cwd: string;
  target: string;
  geminiHome?: string;
  names: string[];
  decisions: TraceDecision[];
  warnings: string[];
  loadedIdentities: Map<string, string>;
  sequence: number;
}

function shown(context: TraceContext, candidate: string): string {
  return displayPath(context.root, candidate, context.geminiHome);
}

function normalizeNames(raw: string[]): { names?: string[]; error?: string } {
  const names: string[] = [];
  for (const value of raw) {
    const trimmed = value.trim();
    if (!trimmed) {
      return { error: "context.fileName entries must not be empty" };
    }
    if (path.isAbsolute(trimmed)) {
      return { error: `context filename must be relative: ${trimmed}` };
    }
    const normalized = path.normalize(trimmed);
    if (
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith(`..${path.sep}`)
    ) {
      return {
        error: `context filename escapes its discovery directory: ${trimmed}`,
      };
    }
    if (!names.includes(normalized)) {
      names.push(normalized);
    }
  }
  return { names };
}

async function readSetting(
  settingsPath: string,
  boundary: string,
  context: TraceContext,
): Promise<SettingCandidate | undefined> {
  let raw: string;
  try {
    const resolved = await realpath(settingsPath);
    if (!isWithin(boundary, resolved) || !(await lstat(resolved)).isFile()) {
      return undefined;
    }
    raw = await readFile(resolved, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("settings root must be an object");
    }
    const contextValue = (value as Record<string, unknown>).context;
    if (contextValue === undefined) {
      return undefined;
    }
    if (
      contextValue === null ||
      typeof contextValue !== "object" ||
      Array.isArray(contextValue)
    ) {
      throw new Error("context must be an object");
    }
    const fileName = (contextValue as Record<string, unknown>).fileName;
    if (fileName === undefined) {
      return undefined;
    }
    const rawNames =
      typeof fileName === "string"
        ? [fileName]
        : Array.isArray(fileName) &&
            fileName.every((item) => typeof item === "string")
          ? fileName
          : undefined;
    if (!rawNames) {
      throw new Error(
        "context.fileName must be a string or an array of strings",
      );
    }
    const normalized = normalizeNames(rawNames);
    if (!normalized.names || normalized.names.length === 0) {
      throw new Error(
        normalized.error ??
          "context.fileName must contain at least one filename",
      );
    }
    return {
      shownPath: shown(context, settingsPath),
      names: normalized.names,
      bytes: Buffer.byteLength(raw),
    };
  } catch (error) {
    context.decisions.push({
      path: shown(context, settingsPath),
      kind: "settings",
      phase: "startup",
      status: "parse-error",
      bytesAvailable: Buffer.byteLength(raw),
      bytesIncluded: 0,
      reason: `invalid settings: ${(error as Error).message}`,
      confidence: "documented",
      source: SOURCE_ID,
    });
    context.warnings.push(
      `${shown(context, settingsPath)} could not be parsed`,
    );
    return undefined;
  }
}

function settingDecision(
  candidate: SettingCandidate,
  effective: boolean,
  selectedBy: string,
): TraceDecision {
  return {
    path: candidate.shownPath,
    kind: "settings",
    phase: "startup",
    status: effective ? "loaded" : "shadowed",
    bytesAvailable: candidate.bytes,
    bytesIncluded: 0,
    reason: effective
      ? `sets the effective context filenames to ${candidate.names.join(", ")}; Gemini CLI also retains ${DEFAULT_CONTEXT_FILENAME}`
      : `${selectedBy} supplies the higher-precedence context.fileName value`,
    confidence: "documented",
    source: SOURCE_ID,
  };
}

async function inspectCandidate(
  candidate: string,
  boundary: string,
  kind: "user" | "project" | "import",
  context: TraceContext,
): Promise<ExistingCandidate | undefined> {
  let info;
  try {
    info = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!info.isFile() && !info.isSymbolicLink()) {
    return undefined;
  }

  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    return {
      readPath: candidate,
      shownPath: shown(context, candidate),
      bytes: 0,
      safe: false,
      kind,
    };
  }
  if (!isWithin(boundary, resolved)) {
    return {
      readPath: resolved,
      shownPath: shown(context, candidate),
      bytes: 0,
      safe: false,
      kind,
    };
  }
  const resolvedInfo = await stat(resolved);
  if (!resolvedInfo.isFile()) {
    return undefined;
  }
  return {
    readPath: resolved,
    shownPath: shown(context, candidate),
    bytes: resolvedInfo.size,
    identity: `${resolvedInfo.dev.toString()}:${resolvedInfo.ino.toString()}`,
    safe: true,
    kind,
  };
}

function blockCandidate(
  candidate: ExistingCandidate,
  context: TraceContext,
  phase: "startup" | "lazy" | "import",
  reason: string,
): void {
  context.decisions.push({
    path: candidate.shownPath,
    kind: candidate.kind,
    phase,
    status: "skipped-security-boundary",
    bytesAvailable: 0,
    bytesIncluded: 0,
    reason,
    confidence: "documented",
    source: SECURITY_SOURCE_ID,
  });
  context.warnings.push(
    `${candidate.shownPath} was not read because it escapes the allowed root`,
  );
}

async function traceImports(
  sourcePath: string,
  content: string,
  boundary: string,
  context: TraceContext,
  depth: number,
  chain: Set<string>,
): Promise<void> {
  for (const specifier of extractImports(content)) {
    if (/^(?:file|https?):\/\//i.test(specifier)) {
      context.decisions.push({
        path: specifier,
        kind: "import",
        phase: "import",
        status: "skipped-security-boundary",
        bytesAvailable: 0,
        bytesIncluded: 0,
        reason: `URL import referenced by ${shown(context, sourcePath)} is rejected by Gemini CLI`,
        confidence: "documented",
        source: IMPORT_SOURCE_ID,
      });
      context.warnings.push(
        `${shown(context, sourcePath)} contains a blocked URL import`,
      );
      continue;
    }

    const unresolved = path.isAbsolute(specifier)
      ? specifier
      : path.resolve(path.dirname(sourcePath), specifier);
    const candidate = await inspectCandidate(
      unresolved,
      boundary,
      "import",
      context,
    );
    if (!candidate) {
      context.decisions.push({
        path: shown(context, unresolved),
        kind: "import",
        phase: "import",
        status: "parse-error",
        bytesAvailable: 0,
        bytesIncluded: 0,
        reason: `imported by ${shown(context, sourcePath)} but the path cannot be read`,
        confidence: "documented",
        source: IMPORT_SOURCE_ID,
      });
      context.warnings.push(
        `${shown(context, sourcePath)} imports a missing file: ${specifier}`,
      );
      continue;
    }
    if (!candidate.safe) {
      blockCandidate(
        candidate,
        context,
        "import",
        `imported by ${shown(context, sourcePath)} but outside Gemini CLI's project boundary`,
      );
      continue;
    }
    if (depth >= MAX_IMPORT_DEPTH) {
      context.decisions.push({
        path: candidate.shownPath,
        kind: "import",
        phase: "import",
        status: "import-depth",
        bytesAvailable: candidate.bytes,
        bytesIncluded: 0,
        reason: `imported by ${shown(context, sourcePath)} beyond Gemini CLI's five-level limit`,
        confidence: "documented",
        source: IMPORT_SOURCE_ID,
      });
      context.warnings.push(
        `${candidate.shownPath} exceeds the five-level import limit`,
      );
      continue;
    }
    if (chain.has(candidate.readPath)) {
      context.decisions.push({
        path: candidate.shownPath,
        kind: "import",
        phase: "import",
        status: "import-cycle",
        bytesAvailable: candidate.bytes,
        bytesIncluded: 0,
        reason: `imported by ${shown(context, sourcePath)} and already present in this import chain`,
        confidence: "documented",
        source: IMPORT_SOURCE_ID,
      });
      context.warnings.push(`${candidate.shownPath} closes an import cycle`);
      continue;
    }

    const imported = await readFile(candidate.readPath, "utf8");
    if (imported.trim() === "") {
      context.decisions.push({
        path: candidate.shownPath,
        kind: "import",
        phase: "import",
        status: "skipped-empty",
        bytesAvailable: Buffer.byteLength(imported),
        bytesIncluded: 0,
        reason: `empty import referenced by ${shown(context, sourcePath)}`,
        confidence: "documented",
        source: IMPORT_SOURCE_ID,
      });
      continue;
    }

    context.decisions.push({
      path: candidate.shownPath,
      kind: "import",
      phase: "import",
      status: "loaded",
      sequence: context.sequence,
      bytesAvailable: Buffer.byteLength(imported),
      bytesIncluded: Buffer.byteLength(imported),
      reason: `imported by ${shown(context, sourcePath)}`,
      confidence: "documented",
      source: IMPORT_SOURCE_ID,
    });
    context.sequence += 1;
    const nextChain = new Set(chain);
    nextChain.add(candidate.readPath);
    await traceImports(
      candidate.readPath,
      imported,
      boundary,
      context,
      depth + 1,
      nextChain,
    );
  }
}

async function traceContextFile(
  candidate: ExistingCandidate,
  boundary: string,
  phase: "startup" | "lazy",
  context: TraceContext,
): Promise<void> {
  if (!candidate.safe) {
    blockCandidate(
      candidate,
      context,
      phase,
      "context file symlink resolves outside the allowed discovery root",
    );
    return;
  }

  const previous =
    candidate.identity && context.loadedIdentities.get(candidate.identity);
  if (previous) {
    context.decisions.push({
      path: candidate.shownPath,
      kind: candidate.kind,
      phase,
      status: "shadowed",
      bytesAvailable: candidate.bytes,
      bytesIncluded: 0,
      reason: `same physical file was already loaded as ${previous}; Gemini CLI deduplicates file identity`,
      confidence: "documented",
      source: SOURCE_CODE_ID,
    });
    return;
  }
  if (candidate.identity) {
    context.loadedIdentities.set(candidate.identity, candidate.shownPath);
  }

  const content = await readFile(candidate.readPath, "utf8");
  if (content.trim() === "") {
    context.decisions.push({
      path: candidate.shownPath,
      kind: candidate.kind,
      phase,
      status: "skipped-empty",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: "context file contains no model-visible text",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  context.decisions.push({
    path: candidate.shownPath,
    kind: candidate.kind,
    phase,
    status: "loaded",
    sequence: context.sequence,
    bytesAvailable: Buffer.byteLength(content),
    bytesIncluded: Buffer.byteLength(content),
    reason:
      phase === "startup"
        ? candidate.kind === "user"
          ? "global Gemini CLI context loaded at startup"
          : "workspace or ancestor context loaded at startup"
        : "target ancestry context discovered just in time",
    confidence: "documented",
    source: SOURCE_ID,
  });
  context.sequence += 1;
  await traceImports(
    candidate.readPath,
    content,
    boundary,
    context,
    0,
    new Set([candidate.readPath]),
  );
}

async function traceDirectory(
  directory: string,
  boundary: string,
  kind: "user" | "project",
  phase: "startup" | "lazy",
  context: TraceContext,
): Promise<void> {
  for (const name of context.names) {
    const candidate = await inspectCandidate(
      path.join(directory, name),
      boundary,
      kind,
      context,
    );
    if (candidate) {
      await traceContextFile(candidate, boundary, phase, context);
    }
  }
}

export async function traceGemini(
  options: GeminiTraceOptions,
): Promise<TraceResult> {
  const cwd = await canonicalDirectory(options.cwd, "cwd");
  const root = await canonicalDirectory(options.root, "root");
  if (!isWithin(root, cwd)) {
    throw new InputError(`cwd must be inside root: cwd=${cwd}, root=${root}`);
  }
  const target = await canonicalTarget(options.target, cwd);
  if (!isWithin(root, target)) {
    throw new InputError(
      `target must be inside root: target=${target}, root=${root}`,
    );
  }

  const includeUser = options.includeUser ?? false;
  const geminiHome = includeUser
    ? await canonicalDirectory(
        options.geminiHome ?? path.join(os.homedir(), ".gemini"),
        "Gemini home",
      )
    : undefined;
  const context: TraceContext = {
    root,
    cwd,
    target,
    ...(geminiHome === undefined ? {} : { geminiHome }),
    names: [DEFAULT_CONTEXT_FILENAME],
    decisions: [],
    warnings: [],
    loadedIdentities: new Map(),
    sequence: 1,
  };

  const userSetting = geminiHome
    ? await readSetting(
        path.join(geminiHome, "settings.json"),
        geminiHome,
        context,
      )
    : undefined;
  const projectSetting = await readSetting(
    path.join(root, ".gemini", "settings.json"),
    root,
    context,
  );
  const explicit = options.contextFilenames?.length
    ? normalizeNames(options.contextFilenames)
    : undefined;
  if (explicit?.error || (explicit && explicit.names?.length === 0)) {
    throw new InputError(
      explicit.error ?? "context filename list must not be empty",
    );
  }

  const configured =
    explicit?.names ?? projectSetting?.names ?? userSetting?.names ?? [];
  context.names = [...new Set([...configured, DEFAULT_CONTEXT_FILENAME])];

  if (userSetting) {
    context.decisions.push(
      settingDecision(
        userSetting,
        explicit === undefined && projectSetting === undefined,
        explicit
          ? "the command line"
          : (projectSetting?.shownPath ?? "a higher-precedence source"),
      ),
    );
  }
  if (projectSetting) {
    context.decisions.push(
      settingDecision(
        projectSetting,
        explicit === undefined,
        explicit ? "the command line" : "a higher-precedence source",
      ),
    );
  }

  if (geminiHome) {
    await traceDirectory(geminiHome, geminiHome, "user", "startup", context);
  }
  for (const directory of pathChain(root, cwd)) {
    await traceDirectory(directory, root, "project", "startup", context);
  }

  const targetInfo = await lstat(target);
  const targetDirectory = targetInfo.isDirectory()
    ? target
    : path.dirname(target);
  for (const directory of pathChain(root, targetDirectory)) {
    await traceDirectory(directory, root, "project", "lazy", context);
  }

  const included = context.decisions.filter(
    (decision) => decision.status === "loaded" && decision.kind !== "settings",
  );
  const includedBytes = included.reduce(
    (total, decision) => total + decision.bytesIncluded,
    0,
  );
  return {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    profile: GEMINI_PROFILE,
    inputs: { root, cwd, target, includeUser },
    decisions: context.decisions,
    summary: {
      includedFiles: included.length,
      includedBytes,
      approximateTokens: Math.ceil(includedBytes / 4),
      warnings: context.warnings,
    },
  };
}
