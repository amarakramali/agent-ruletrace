#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { findGitRoot, InputError } from "./core/paths.js";
import { CLAUDE_PROFILE, traceClaude } from "./profiles/claude.js";
import { CODEX_PROFILE, traceCodex } from "./profiles/codex.js";
import { GEMINI_PROFILE, traceGemini } from "./profiles/gemini.js";
import { renderText } from "./render/text.js";

interface ExplainOptions {
  client: string;
  root?: string;
  cwd: string;
  format: "text" | "json";
  includeUser: boolean;
  codexHome?: string;
  claudeHome?: string;
  geminiHome?: string;
  fallback?: string[];
  exclude?: string[];
  contextFile?: string[];
  maxBytes: number;
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
    .requiredOption("--client <client>", "client profile: codex, claude, or gemini")
    .option("--root <path>", "project root; defaults to the nearest Git root")
    .option("--cwd <path>", "simulated client launch directory", process.cwd())
    .option("--format <format>", "output format: text or json", "text")
    .option("--include-user", "include user-level instruction files", false)
    .option("--codex-home <path>", "Codex home used with --include-user")
    .option("--claude-home <path>", "Claude home used with --include-user")
    .option("--gemini-home <path>", "Gemini home used with --include-user")
    .option("--fallback <filename>", "Codex fallback filename; repeatable", collect, [])
    .option("--exclude <glob>", "additional Claude exclusion glob; repeatable", collect, [])
    .option(
      "--context-file <filename>",
      "effective Gemini context filename; repeatable",
      collect,
      [],
    )
    .option("--max-bytes <bytes>", "Codex project instruction byte limit", parseNonNegativeInteger, 32768)
    .action(async (target: string, rawOptions: ExplainOptions) => {
      if (
        rawOptions.client !== "codex" &&
        rawOptions.client !== "claude" &&
        rawOptions.client !== "gemini"
      ) {
        throw new InputError(
          `profile is not implemented yet: ${rawOptions.client} (available: codex, claude, gemini)`,
        );
      }
      if (rawOptions.format !== "text" && rawOptions.format !== "json") {
        throw new InputError(`unsupported format: ${rawOptions.format} (available: text, json)`);
      }

      const root = rawOptions.root ?? (await findGitRoot(rawOptions.cwd));
      let trace;
      if (rawOptions.client === "codex") {
        trace = await traceCodex({
          root,
          cwd: rawOptions.cwd,
          target,
          includeUser: rawOptions.includeUser,
          maxBytes: rawOptions.maxBytes,
          ...(rawOptions.codexHome === undefined ? {} : { codexHome: rawOptions.codexHome }),
          ...(rawOptions.fallback === undefined
            ? {}
            : { fallbackFilenames: rawOptions.fallback }),
        });
      } else if (rawOptions.client === "claude") {
        trace = await traceClaude({
          root,
          cwd: rawOptions.cwd,
          target,
          includeUser: rawOptions.includeUser,
          ...(rawOptions.claudeHome === undefined
            ? {}
            : { claudeHome: rawOptions.claudeHome }),
          ...(rawOptions.exclude === undefined ? {} : { excludes: rawOptions.exclude }),
        });
      } else {
        trace = await traceGemini({
          root,
          cwd: rawOptions.cwd,
          target,
          includeUser: rawOptions.includeUser,
          ...(rawOptions.geminiHome === undefined
            ? {}
            : { geminiHome: rawOptions.geminiHome }),
          ...(rawOptions.contextFile === undefined
            ? {}
            : { contextFilenames: rawOptions.contextFile }),
        });
      }
      process.stdout.write(
        rawOptions.format === "json" ? `${JSON.stringify(trace, null, 2)}\n` : `${renderText(trace)}\n`,
      );
      if (trace.summary.warnings.length > 0) {
        process.exitCode = 1;
      }
    });

  program
    .command("profiles")
    .description("List implemented client profiles and their primary sources.")
    .action(() => {
      for (const profile of [CODEX_PROFILE, CLAUDE_PROFILE, GEMINI_PROFILE]) {
        process.stdout.write(
          `${profile.id}\t${profile.status}\tverified ${profile.verifiedOn}\t${profile.sources[0]?.url}\n`,
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

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
