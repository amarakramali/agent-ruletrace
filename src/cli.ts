#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { traceMatrix } from "./core/matrix.js";
import { findGitRoot, InputError } from "./core/paths.js";
import type { ProfileTraceOptions } from "./core/types.js";
import { PROFILE_REGISTRY, traceProfile } from "./profiles/registry.js";
import { renderMatrix } from "./render/matrix.js";
import { renderText } from "./render/text.js";

interface CommonOptions {
  root?: string;
  cwd: string;
  format: "text" | "json";
  includeUser: boolean;
  codexHome?: string;
  claudeHome?: string;
  geminiHome?: string;
  copilotHome?: string;
}

interface ExplainOptions extends CommonOptions {
  client: string;
  fallback?: string[];
  exclude?: string[];
  contextFile?: string[];
  maxBytes: number;
}

type MatrixOptions = CommonOptions;

interface ProfilesOptions {
  format: "text" | "json";
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("expected a non-negative safe integer");
  }
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function validateFormat(format: string): asserts format is "text" | "json" {
  if (format !== "text" && format !== "json") {
    throw new InputError(
      `unsupported format: ${format} (available: text, json)`,
    );
  }
}

function profileTraceOptions(
  target: string,
  root: string,
  options: CommonOptions & Partial<ExplainOptions>,
): ProfileTraceOptions {
  return {
    root,
    cwd: options.cwd,
    target,
    includeUser: options.includeUser,
    ...(options.codexHome === undefined
      ? {}
      : { codexHome: options.codexHome }),
    ...(options.claudeHome === undefined
      ? {}
      : { claudeHome: options.claudeHome }),
    ...(options.geminiHome === undefined
      ? {}
      : { geminiHome: options.geminiHome }),
    ...(options.copilotHome === undefined
      ? {}
      : { copilotHome: options.copilotHome }),
    ...(options.fallback === undefined
      ? {}
      : { fallbackFilenames: options.fallback }),
    ...(options.exclude === undefined ? {} : { excludes: options.exclude }),
    ...(options.contextFile === undefined
      ? {}
      : { contextFilenames: options.contextFile }),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("ruletrace")
    .description("Explain which coding-agent instruction files apply, and why.")
    .version("0.1.0");

  program
    .command("explain")
    .description("Trace instruction discovery for one client and target path.")
    .argument("<target>", "target file or directory, relative to --cwd")
    .requiredOption(
      "--client <client>",
      "client profile: codex, claude, gemini, or copilot",
    )
    .option("--root <path>", "project root; defaults to the nearest Git root")
    .option("--cwd <path>", "simulated client launch directory", process.cwd())
    .option("--format <format>", "output format: text or json", "text")
    .option("--include-user", "include user-level instruction files", false)
    .option("--codex-home <path>", "Codex home used with --include-user")
    .option("--claude-home <path>", "Claude home used with --include-user")
    .option("--gemini-home <path>", "Gemini home used with --include-user")
    .option("--copilot-home <path>", "Copilot home used with --include-user")
    .option(
      "--fallback <filename>",
      "Codex fallback filename; repeatable",
      collect,
      [],
    )
    .option(
      "--exclude <glob>",
      "additional Claude exclusion glob; repeatable",
      collect,
      [],
    )
    .option(
      "--context-file <filename>",
      "effective Gemini context filename; repeatable",
      collect,
      [],
    )
    .option(
      "--max-bytes <bytes>",
      "Codex project instruction byte limit",
      parseNonNegativeInteger,
      32768,
    )
    .action(async (target: string, rawOptions: ExplainOptions) => {
      validateFormat(rawOptions.format);
      const root = rawOptions.root ?? (await findGitRoot(rawOptions.cwd));
      const trace = await traceProfile(
        rawOptions.client,
        profileTraceOptions(target, root, rawOptions),
      );
      process.stdout.write(
        rawOptions.format === "json"
          ? `${JSON.stringify(trace, null, 2)}\n`
          : `${renderText(trace)}\n`,
      );
      if (trace.summary.warnings.length > 0) {
        process.exitCode = 1;
      }
    });

  program
    .command("matrix")
    .description(
      "Compare instruction discovery across every implemented client profile.",
    )
    .argument("<target>", "target file or directory, relative to --cwd")
    .option("--root <path>", "project root; defaults to the nearest Git root")
    .option("--cwd <path>", "simulated client launch directory", process.cwd())
    .option("--format <format>", "output format: text or json", "text")
    .option("--include-user", "include user-level instruction files", false)
    .option("--codex-home <path>", "Codex home used with --include-user")
    .option("--claude-home <path>", "Claude home used with --include-user")
    .option("--gemini-home <path>", "Gemini home used with --include-user")
    .option("--copilot-home <path>", "Copilot home used with --include-user")
    .action(async (target: string, rawOptions: MatrixOptions) => {
      validateFormat(rawOptions.format);
      const root = rawOptions.root ?? (await findGitRoot(rawOptions.cwd));
      const matrix = await traceMatrix(
        profileTraceOptions(target, root, rawOptions),
      );
      process.stdout.write(
        rawOptions.format === "json"
          ? `${JSON.stringify(matrix, null, 2)}\n`
          : `${renderMatrix(matrix)}\n`,
      );
      if (matrix.summary.warningCount > 0) {
        process.exitCode = 1;
      }
    });

  program
    .command("profiles")
    .description(
      "List implemented client profiles and their specification sources.",
    )
    .option("--format <format>", "output format: text or json", "text")
    .action((rawOptions: ProfilesOptions) => {
      validateFormat(rawOptions.format);
      if (rawOptions.format === "json") {
        process.stdout.write(
          `${JSON.stringify(
            {
              schemaVersion: 1,
              toolVersion: "0.1.0",
              profiles: PROFILE_REGISTRY.map((profile) => profile.metadata),
            },
            null,
            2,
          )}\n`,
        );
        return;
      }
      for (const { metadata: profile } of PROFILE_REGISTRY) {
        process.stdout.write(
          `${profile.id}\t${profile.status}\tverified ${profile.verifiedOn}\t${profile.sources.map((source) => source.url).join(",")}\n`,
        );
      }
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof InputError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

function canonicalEntrypoint(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

const modulePath = canonicalEntrypoint(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? canonicalEntrypoint(process.argv[1]) : "";
if (modulePath === invokedPath) {
  await main();
}
