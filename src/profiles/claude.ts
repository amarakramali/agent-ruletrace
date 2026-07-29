import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { existingFile, markdownFiles, posixPath } from "../core/files.js";
import { extractImports, parseRuleFrontmatter } from "../core/markdown.js";
import {
  canonicalDirectory,
  canonicalTarget,
  displayPath,
  InputError,
  isWithin,
  pathChain,
} from "../core/paths.js";
import type {
  ClaudeTraceOptions,
  ProfileMetadata,
  TraceDecision,
  TraceResult,
} from "../core/types.js";

const SOURCE_ID = "claude-memory";
const SECURITY_SOURCE_ID = "ruletrace-security";
const MAX_IMPORT_DEPTH = 4;

export const CLAUDE_PROFILE: ProfileMetadata = {
  id: "claude",
  displayName: "Anthropic Claude Code",
  verifiedOn: "2026-07-29",
  status: "implemented",
  sources: [
    {
      id: SOURCE_ID,
      label: "How Claude remembers your project",
      url: "https://code.claude.com/docs/en/memory",
    },
    {
      id: SECURITY_SOURCE_ID,
      label: "Agent RuleTrace read boundary",
      url: "https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model",
    },
  ],
};

interface TraceContext {
  root: string;
  cwd: string;
  target: string;
  claudeHome?: string;
  excludes: string[];
  decisions: TraceDecision[];
  warnings: string[];
  sequence: number;
}

function matchesAny(candidate: string, patterns: string[]): boolean {
  const normalized = posixPath(candidate);
  return patterns.some((pattern) => {
    try {
      return minimatch(normalized, posixPath(pattern), { dot: true });
    } catch {
      return false;
    }
  });
}

function pathKind(
  context: TraceContext,
  candidate: string,
): "user" | "project" {
  return context.claudeHome && isWithin(context.claudeHome, candidate)
    ? "user"
    : "project";
}

function shown(context: TraceContext, candidate: string): string {
  return displayPath(context.root, candidate, context.claudeHome);
}

async function readExcludes(
  settingsPath: string,
  context: TraceContext,
): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("settings root must be an object");
    }
    const excludes = (value as Record<string, unknown>).claudeMdExcludes;
    if (excludes === undefined) {
      return [];
    }
    if (
      !Array.isArray(excludes) ||
      !excludes.every((item) => typeof item === "string")
    ) {
      throw new Error("claudeMdExcludes must be an array of strings");
    }
    return excludes;
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
    return [];
  }
}

async function resolveImport(
  specifier: string,
  sourcePath: string,
  context: TraceContext,
): Promise<string | undefined> {
  const expanded =
    specifier === "~"
      ? context.claudeHome
      : specifier.startsWith("~/")
        ? context.claudeHome &&
          path.join(context.claudeHome, specifier.slice(2))
        : specifier;
  if (!expanded) {
    return undefined;
  }
  const candidate = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(sourcePath), expanded);
  try {
    const resolved = await realpath(candidate);
    return (await lstat(resolved)).isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function traceImports(
  sourcePath: string,
  content: string,
  context: TraceContext,
  depth: number,
  chain: Set<string>,
): Promise<void> {
  for (const specifier of extractImports(content)) {
    const candidate = await resolveImport(specifier, sourcePath, context);
    const unresolvedDisplay = path.isAbsolute(specifier)
      ? specifier
      : path.resolve(path.dirname(sourcePath), specifier);

    if (!candidate) {
      context.decisions.push({
        path: shown(context, unresolvedDisplay),
        kind: "import",
        phase: "import",
        status: "parse-error",
        bytesAvailable: 0,
        bytesIncluded: 0,
        reason: `imported by ${shown(context, sourcePath)} but the path cannot be read`,
        confidence: "documented",
        source: SOURCE_ID,
      });
      context.warnings.push(
        `${shown(context, sourcePath)} imports a missing file: ${specifier}`,
      );
      continue;
    }

    if (depth >= MAX_IMPORT_DEPTH) {
      context.decisions.push({
        path: shown(context, candidate),
        kind: "import",
        phase: "import",
        status: "import-depth",
        bytesAvailable: (await lstat(candidate)).size,
        bytesIncluded: 0,
        reason: `imported by ${shown(context, sourcePath)} beyond Claude Code's four-hop limit`,
        confidence: "documented",
        source: SOURCE_ID,
      });
      context.warnings.push(
        `${shown(context, candidate)} exceeds the four-hop import limit`,
      );
      continue;
    }

    if (chain.has(candidate)) {
      context.decisions.push({
        path: shown(context, candidate),
        kind: "import",
        phase: "import",
        status: "import-cycle",
        bytesAvailable: (await lstat(candidate)).size,
        bytesIncluded: 0,
        reason: `imported by ${shown(context, sourcePath)} and already present in this import chain`,
        confidence: "documented",
        source: SOURCE_ID,
      });
      context.warnings.push(
        `${shown(context, candidate)} closes an import cycle`,
      );
      continue;
    }

    const allowed =
      isWithin(context.root, candidate) ||
      (context.claudeHome !== undefined &&
        isWithin(context.claudeHome, candidate));
    if (!allowed) {
      context.decisions.push({
        path: posixPath(candidate),
        kind: "import",
        phase: "import",
        status: "skipped-security-boundary",
        bytesAvailable: 0,
        bytesIncluded: 0,
        reason: `external import from ${shown(context, sourcePath)} requires host approval and is outside the simulated roots`,
        confidence: "host-dependent",
        source: SECURITY_SOURCE_ID,
      });
      context.warnings.push(
        `${shown(context, sourcePath)} has an external import that was not read`,
      );
      continue;
    }

    const imported = await readFile(candidate, "utf8");
    if (imported.trim() === "") {
      context.decisions.push({
        path: shown(context, candidate),
        kind: "import",
        phase: "import",
        status: "skipped-empty",
        bytesAvailable: Buffer.byteLength(imported),
        bytesIncluded: 0,
        reason: `empty import referenced by ${shown(context, sourcePath)}`,
        confidence: "documented",
        source: SOURCE_ID,
      });
      continue;
    }

    context.decisions.push({
      path: shown(context, candidate),
      kind: "import",
      phase: "import",
      status: "loaded",
      sequence: context.sequence,
      bytesAvailable: Buffer.byteLength(imported),
      bytesIncluded: Buffer.byteLength(imported),
      reason: `imported by ${shown(context, sourcePath)}`,
      confidence: "documented",
      source: SOURCE_ID,
    });
    context.sequence += 1;
    const nextChain = new Set(chain);
    nextChain.add(candidate);
    await traceImports(candidate, imported, context, depth + 1, nextChain);
  }
}

async function traceMemoryFile(
  candidate: string,
  context: TraceContext,
  phase: "startup" | "lazy",
): Promise<void> {
  if (matchesAny(candidate, context.excludes)) {
    context.decisions.push({
      path: shown(context, candidate),
      kind: pathKind(context, candidate),
      phase,
      status: "excluded",
      bytesAvailable: (await lstat(candidate)).size,
      bytesIncluded: 0,
      reason: "matched a merged claudeMdExcludes pattern",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  const content = await readFile(candidate, "utf8");
  if (content.trim() === "") {
    context.decisions.push({
      path: shown(context, candidate),
      kind: pathKind(context, candidate),
      phase,
      status: "skipped-empty",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: "instruction file contains no model-visible text",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  context.decisions.push({
    path: shown(context, candidate),
    kind: pathKind(context, candidate),
    phase,
    status: "loaded",
    sequence: context.sequence,
    bytesAvailable: Buffer.byteLength(content),
    bytesIncluded: Buffer.byteLength(content),
    reason:
      phase === "startup"
        ? "found in the root-to-launch-directory instruction hierarchy"
        : "found below the launch directory when the target file is read",
    confidence: "documented",
    source: SOURCE_ID,
  });
  context.sequence += 1;
  await traceImports(candidate, content, context, 0, new Set([candidate]));
}

async function traceRule(
  candidate: string,
  context: TraceContext,
  basePhase: "startup" | "lazy",
): Promise<void> {
  if (matchesAny(candidate, context.excludes)) {
    context.decisions.push({
      path: shown(context, candidate),
      kind: "rule",
      phase: basePhase,
      status: "excluded",
      bytesAvailable: (await lstat(candidate)).size,
      bytesIncluded: 0,
      reason: "matched a merged claudeMdExcludes pattern",
      confidence: "documented",
      source: SOURCE_ID,
    });
    return;
  }

  const content = await readFile(candidate, "utf8");
  const parsed = parseRuleFrontmatter(content);
  if (parsed.error) {
    context.decisions.push({
      path: shown(context, candidate),
      kind: "rule",
      phase: basePhase,
      status: "parse-error",
      bytesAvailable: Buffer.byteLength(content),
      bytesIncluded: 0,
      reason: parsed.error,
      confidence: "documented",
      source: SOURCE_ID,
    });
    context.warnings.push(
      `${shown(context, candidate)} has invalid frontmatter`,
    );
    return;
  }

  let matchedPattern: string | undefined;
  if (parsed.paths) {
    const relativeTarget = posixPath(
      path.relative(context.root, context.target),
    );
    matchedPattern = parsed.paths.find((pattern) => {
      try {
        return minimatch(relativeTarget, pattern, { dot: true });
      } catch {
        return false;
      }
    });
    if (!matchedPattern) {
      context.decisions.push({
        path: shown(context, candidate),
        kind: "rule",
        phase: "lazy",
        status: "inapplicable",
        bytesAvailable: Buffer.byteLength(content),
        bytesIncluded: 0,
        reason: `none of ${parsed.paths.length} path pattern(s) match ${relativeTarget}`,
        confidence: "documented",
        source: SOURCE_ID,
      });
      return;
    }
  }

  context.decisions.push({
    path: shown(context, candidate),
    kind: "rule",
    phase: parsed.paths ? "lazy" : basePhase,
    status: "loaded",
    sequence: context.sequence,
    ...(matchedPattern === undefined ? {} : { matchedPattern }),
    bytesAvailable: Buffer.byteLength(content),
    bytesIncluded: Buffer.byteLength(content),
    reason: matchedPattern
      ? `path-scoped rule matches target via ${matchedPattern}`
      : "unconditional Claude Code rule",
    confidence: "documented",
    source: SOURCE_ID,
  });
  context.sequence += 1;
  await traceImports(candidate, content, context, 0, new Set([candidate]));
}

async function memoryCandidates(
  directory: string,
  root: string,
): Promise<string[]> {
  const candidates = [
    path.join(directory, "CLAUDE.md"),
    path.join(directory, ".claude", "CLAUDE.md"),
    path.join(directory, "CLAUDE.local.md"),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    const resolved = await existingFile(candidate, root);
    if (resolved) {
      existing.push(resolved);
    }
  }
  return existing;
}

export async function traceClaude(
  options: ClaudeTraceOptions,
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
  const claudeHome = includeUser
    ? await canonicalDirectory(
        options.claudeHome ?? path.join(os.homedir(), ".claude"),
        "Claude home",
      )
    : undefined;
  const context: TraceContext = {
    root,
    cwd,
    target,
    ...(claudeHome === undefined ? {} : { claudeHome }),
    excludes: [...(options.excludes ?? [])],
    decisions: [],
    warnings: [],
    sequence: 1,
  };

  if (claudeHome) {
    context.excludes.push(
      ...(await readExcludes(path.join(claudeHome, "settings.json"), context)),
    );
  }
  context.excludes.push(
    ...(await readExcludes(
      path.join(root, ".claude", "settings.json"),
      context,
    )),
    ...(await readExcludes(
      path.join(root, ".claude", "settings.local.json"),
      context,
    )),
  );

  if (claudeHome) {
    const userMemory = await existingFile(
      path.join(claudeHome, "CLAUDE.md"),
      claudeHome,
    );
    if (userMemory) {
      await traceMemoryFile(userMemory, context, "startup");
    }
    for (const rule of await markdownFiles(
      path.join(claudeHome, "rules"),
      claudeHome,
    )) {
      await traceRule(rule, context, "startup");
    }
  }

  for (const directory of pathChain(root, cwd)) {
    for (const candidate of await memoryCandidates(directory, root)) {
      await traceMemoryFile(candidate, context, "startup");
    }
    for (const rule of await markdownFiles(
      path.join(directory, ".claude", "rules"),
      root,
    )) {
      await traceRule(rule, context, "startup");
    }
  }

  const targetDirectory = (await lstat(target)).isDirectory()
    ? target
    : path.dirname(target);
  const launchDirectories = new Set(pathChain(root, cwd));
  const lazyDirectories = pathChain(root, targetDirectory).filter(
    (directory) => !launchDirectories.has(directory),
  );
  for (const directory of lazyDirectories) {
    for (const candidate of await memoryCandidates(directory, root)) {
      await traceMemoryFile(candidate, context, "lazy");
    }
    for (const rule of await markdownFiles(
      path.join(directory, ".claude", "rules"),
      root,
    )) {
      await traceRule(rule, context, "lazy");
    }
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
    profile: CLAUDE_PROFILE,
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
