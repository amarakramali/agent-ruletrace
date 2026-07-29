#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { findGitRoot, InputError } from "./core/paths.js";
import { CODEX_PROFILE, traceCodex } from "./profiles/codex.js";
import { renderText } from "./render/text.js";

interface ExplainOptions {
  client: string;
  root?: string;
  cwd: string;
  format: "text" | "json";
  includeUser: boolean;
  codexHome?: string;
  fallback?: string[];
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
    .requiredOption("--client <client>", "client profile (currently: codex)")
    .option("--root <path>", "project root; defaults to the nearest Git root")
    .option("--cwd <path>", "simulated client launch directory", process.cwd())
    .option("--format <format>", "output format: text or json", "text")
    .option("--include-user", "include user-level instruction files", false)
    .option("--codex-home <path>", "Codex home used with --include-user")
    .option("--fallback <filename>", "Codex fallback filename; repeatable", collect, [])
    .option("--max-bytes <bytes>", "Codex project instruction byte limit", parseNonNegativeInteger, 32768)
    .action(async (target: string, rawOptions: ExplainOptions) => {
      if (rawOptions.client !== "codex") {
        throw new InputError(`profile is not implemented yet: ${rawOptions.client} (available: codex)`);
      }
      if (rawOptions.format !== "text" && rawOptions.format !== "json") {
        throw new InputError(`unsupported format: ${rawOptions.format} (available: text, json)`);
      }

      const root = rawOptions.root ?? (await findGitRoot(rawOptions.cwd));
      const trace = await traceCodex({
        root,
        cwd: rawOptions.cwd,
        target,
        includeUser: rawOptions.includeUser,
        maxBytes: rawOptions.maxBytes,
        ...(rawOptions.codexHome === undefined ? {} : { codexHome: rawOptions.codexHome }),
        ...(rawOptions.fallback === undefined ? {} : { fallbackFilenames: rawOptions.fallback }),
      });
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
      process.stdout.write(
        `${CODEX_PROFILE.id}\t${CODEX_PROFILE.status}\tverified ${CODEX_PROFILE.verifiedOn}\t${CODEX_PROFILE.sources[0]?.url}\n`,
      );
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
