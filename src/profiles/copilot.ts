import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { markdownFiles, posixPath } from "../core/files.js";
import { parseCopilotFrontmatter } from "../core/markdown.js";
import {
  canonicalDirectory,
  canonicalTarget,
  displayPath,
  InputError,
  isWithin,
  pathChain,
} from "../core/paths.js";
import type {
  CopilotTraceOptions,
  ProfileMetadata,
  TraceDecision,
  TraceResult,
} from "../core/types.js";

const SOURCE_ID = "copilot-cli-instructions";
const SUPPORT_SOURCE_ID = "copilot-instruction-support";
const SECURITY_SOURCE_ID = "ruletrace-security";

export const COPILOT_PROFILE: ProfileMetadata = {
  id: "copilot",
  displayName: "GitHub Copilot CLI",
  verifiedOn: "2026-07-29",
  status: "implemented",
  sources: [
    {
      id: SOURCE_ID,
      label: "Adding custom instructions for GitHub Copilot CLI",
      url: "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions",
    },
    {
      id: SUPPORT_SOURCE_ID,
      label: "Support for different types of custom instructions",
      url: "https://docs.github.com/en/copilot/reference/custom-instructions-support",
    },
    {
      id: SECURITY_SOURCE_ID,
      label: "Agent RuleTrace read boundary",
      url: "https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model",
    },
  ],
};

type InstructionFamily = "user-wide" | "repository-wide" | "agent" | "modular";

interface ExistingCandidate {
  readPath: string;
  shownPath: string;
  bytes: number;
  safe: boolean;
  family: InstructionFamily;
  phase: "startup" | "lazy";
}

interface TraceContext {
  root: string;
  cwd: string;
  target: string;
  copilotHome?: string;
  decisions: TraceDecision[];
  warnings: string[];
  contentSources: Map<string, string>;
}

function shown(context: TraceContext, candidate: string): string {
  return displayPath(context.root, candidate, context.copilotHome);
}

function decisionKind(family: InstructionFamily): "user" | "project" | "rule" {
  if (family === "user-wide") {
    return "user";
  }
  return family === "modular" ? "rule" : "project";
}

async function inspectCandidate(
  candidate: string,
  boundary: string,
  family: InstructionFamily,
  phase: "startup" | "lazy",
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
      family,
      phase,
    };
  }
  if (!isWithin(boundary, resolved)) {
    return {
      readPath: resolved,
      shownPath: shown(context, candidate),
      bytes: 0,
      safe: false,
      family,
      phase,
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
    safe: true,
    family,
    phase,
  };
}

function blockCandidate(
  candidate: ExistingCandidate,
  context: TraceContext,
): void {
  context.decisions.push({
    path: candidate.shownPath,
    kind: decisionKind(candidate.family),
    phase: candidate.phase,
    status: "skipped-security-boundary",
    bytesAvailable: 0,
    bytesIncluded: 0,
    reason:
      "instruction file symlink resolves outside the allowed discovery root",
    confidence: "documented",
    source: SECURITY_SOURCE_ID,
  });
  context.warnings.push(
    `${candidate.shownPath} was not read because it escapes the allowed root`,
  );
}

function contentKey(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function traceAlwaysOn(
  candidate: ExistingCandidate,
  context: TraceContext,
): Promise<void> {
  if (!candidate.safe) {
    blockCandidate(candidate, context);
    return;
  }

  const content = await readFile(candidate.readPath, "utf8");
  if (content.trim() === "") {
    context.decisions.push({
      path: candidate.shownPath,
      kind: decisionKind(candidate.family),
      phase: candidate.phase,
      status: "skipped-empty",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: "instruction file contains no model-visible text",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  const key = contentKey(content);
  const previous = context.contentSources.get(key);
  if (previous) {
    context.decisions.push({
      path: candidate.shownPath,
      kind: decisionKind(candidate.family),
      phase: candidate.phase,
      status: "shadowed",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: `identical instruction content was already discovered in ${previous}`,
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }
  context.contentSources.set(key, candidate.shownPath);

  context.decisions.push({
    path: candidate.shownPath,
    kind: decisionKind(candidate.family),
    phase: candidate.phase,
    status: "loaded",
    bytesAvailable: Buffer.byteLength(content),
    bytesIncluded: Buffer.byteLength(content),
    reason:
      candidate.family === "user-wide"
        ? "user-level Copilot CLI instructions are combined with applicable repository instructions"
        : candidate.phase === "startup"
          ? "discovered between the Git root and launch directory; Copilot CLI defines no general precedence"
          : "discovered in the target path; Copilot CLI defines no general precedence",
    confidence: "documented",
    source: SOURCE_ID,
  });
}

function matchPattern(target: string, patterns: string[]): string | undefined {
  return patterns.find((pattern) => {
    try {
      return minimatch(target, pattern, { dot: true });
    } catch {
      return false;
    }
  });
}

async function traceModular(
  candidate: ExistingCandidate,
  context: TraceContext,
): Promise<void> {
  if (!candidate.safe) {
    blockCandidate(candidate, context);
    return;
  }

  const content = await readFile(candidate.readPath, "utf8");
  const parsed = parseCopilotFrontmatter(content);
  if (parsed.error) {
    context.decisions.push({
      path: candidate.shownPath,
      kind: "rule",
      phase: "lazy",
      status: "parse-error",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: parsed.error,
      confidence: "documented",
      source: SOURCE_ID,
    });
    context.warnings.push(`${candidate.shownPath} has invalid frontmatter`);
    return;
  }
  if (!parsed.applyTo) {
    context.decisions.push({
      path: candidate.shownPath,
      kind: "rule",
      phase: "lazy",
      status: "inapplicable",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason:
        "no applyTo glob is present, so the file is not applied automatically",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  const relativeTarget = posixPath(path.relative(context.root, context.target));
  const matchedPattern = matchPattern(relativeTarget, parsed.applyTo);
  if (!matchedPattern) {
    context.decisions.push({
      path: candidate.shownPath,
      kind: "rule",
      phase: "lazy",
      status: "inapplicable",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: `none of ${parsed.applyTo.length} applyTo pattern(s) match ${relativeTarget}`,
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }
  if (content.trim() === "") {
    context.decisions.push({
      path: candidate.shownPath,
      kind: "rule",
      phase: "lazy",
      status: "skipped-empty",
      matchedPattern,
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: "matching instruction file contains no model-visible text",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  context.decisions.push({
    path: candidate.shownPath,
    kind: "rule",
    phase: "lazy",
    status: "loaded",
    matchedPattern,
    bytesAvailable: Buffer.byteLength(content),
    bytesIncluded: Buffer.byteLength(content),
    reason: `path-specific instructions match the target via ${matchedPattern}`,
    confidence: "documented",
    source: SOURCE_ID,
  });
}

async function traceCandidate(
  candidate: ExistingCandidate | undefined,
  context: TraceContext,
): Promise<void> {
  if (!candidate) {
    return;
  }
  if (candidate.family === "modular") {
    await traceModular(candidate, context);
  } else {
    await traceAlwaysOn(candidate, context);
  }
}

async function traceModularDirectory(
  directory: string,
  boundary: string,
  phase: "startup" | "lazy",
  context: TraceContext,
): Promise<void> {
  for (const candidatePath of await markdownFiles(directory, boundary)) {
    if (!candidatePath.endsWith(".instructions.md")) {
      continue;
    }
    await traceCandidate(
      await inspectCandidate(
        candidatePath,
        boundary,
        "modular",
        phase,
        context,
      ),
      context,
    );
  }
}

async function traceStandardDirectory(
  directory: string,
  phase: "startup" | "lazy",
  context: TraceContext,
): Promise<void> {
  const candidates: Array<{ relative: string; family: InstructionFamily }> = [
    {
      relative: path.join(".github", "copilot-instructions.md"),
      family: "repository-wide",
    },
    { relative: "AGENTS.md", family: "agent" },
    { relative: "CLAUDE.md", family: "agent" },
    { relative: path.join(".claude", "CLAUDE.md"), family: "agent" },
    { relative: "GEMINI.md", family: "agent" },
  ];
  for (const { relative, family } of candidates) {
    await traceCandidate(
      await inspectCandidate(
        path.join(directory, relative),
        context.root,
        family,
        phase,
        context,
      ),
      context,
    );
  }
}

export async function traceCopilot(
  options: CopilotTraceOptions,
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
  const copilotHome = includeUser
    ? await canonicalDirectory(
        options.copilotHome ?? path.join(os.homedir(), ".copilot"),
        "Copilot home",
      )
    : undefined;
  const context: TraceContext = {
    root,
    cwd,
    target,
    ...(copilotHome === undefined ? {} : { copilotHome }),
    decisions: [],
    warnings: [],
    contentSources: new Map(),
  };

  if (copilotHome) {
    await traceCandidate(
      await inspectCandidate(
        path.join(copilotHome, "copilot-instructions.md"),
        copilotHome,
        "user-wide",
        "startup",
        context,
      ),
      context,
    );
    await traceModularDirectory(
      path.join(copilotHome, "instructions"),
      copilotHome,
      "lazy",
      context,
    );
  }

  const launchDirectories = pathChain(root, cwd);
  const launchSet = new Set(launchDirectories);
  const targetInfo = await lstat(target);
  const targetDirectory = targetInfo.isDirectory()
    ? target
    : path.dirname(target);
  const targetDirectories = pathChain(root, targetDirectory);
  const standardDirectories = [
    ...launchDirectories,
    ...targetDirectories.filter((directory) => !launchSet.has(directory)),
  ];
  for (const directory of standardDirectories) {
    await traceStandardDirectory(
      directory,
      launchSet.has(directory) ? "startup" : "lazy",
      context,
    );
  }

  const modularBases = new Set<string>([root, cwd]);
  for (const directory of targetDirectories) {
    if (!launchSet.has(directory)) {
      modularBases.add(directory);
    }
  }
  for (const directory of modularBases) {
    await traceModularDirectory(
      path.join(directory, ".github", "instructions"),
      root,
      launchSet.has(directory) ? "startup" : "lazy",
      context,
    );
  }

  const included = context.decisions.filter(
    (decision) => decision.status === "loaded",
  );
  const includedBytes = included.reduce(
    (total, decision) => total + decision.bytesIncluded,
    0,
  );
  return {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    profile: COPILOT_PROFILE,
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
