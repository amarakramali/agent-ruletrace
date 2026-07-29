import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InputError } from "../src/core/paths.js";
import { traceCodex } from "../src/profiles/codex.js";

const temporaryRoots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-ruletrace-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".git"));
  return root;
}

async function put(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Codex profile", () => {
  it("explains root-to-cwd selection, overrides, fallbacks, and shadowed files", async () => {
    const root = await fixture();
    const cwd = path.join(root, "services", "api");
    await mkdir(cwd, { recursive: true });
    await put(root, "AGENTS.md", "root instructions");
    await put(root, "services/AGENTS.override.md", "service override");
    await put(root, "services/AGENTS.md", "shadowed service instructions");
    await put(root, "services/api/TEAM.md", "api fallback");
    await put(root, "services/api/handler.ts", "export {}");

    const trace = await traceCodex({
      root,
      cwd,
      target: "handler.ts",
      fallbackFilenames: ["TEAM.md"],
    });

    expect(
      trace.decisions.map(({ path: file, status, sequence }) => ({ file, status, sequence })),
    ).toEqual([
      { file: "AGENTS.md", status: "loaded", sequence: 1 },
      { file: "services/AGENTS.override.md", status: "loaded", sequence: 2 },
      { file: "services/AGENTS.md", status: "shadowed", sequence: undefined },
      { file: "services/api/TEAM.md", status: "loaded", sequence: 3 },
    ]);
    expect(trace.summary.includedFiles).toBe(3);
  });

  it("does not fall through when the first existing candidate is empty", async () => {
    const root = await fixture();
    await put(root, "AGENTS.override.md", "  \n");
    await put(root, "AGENTS.md", "would otherwise load");
    await put(root, "target.ts", "");

    const trace = await traceCodex({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions.map(({ path: file, status }) => ({ file, status }))).toEqual([
      { file: "AGENTS.override.md", status: "skipped-empty" },
      { file: "AGENTS.md", status: "shadowed" },
    ]);
    expect(trace.summary.includedFiles).toBe(0);
  });

  it("does fall through empty user instructions to the first non-empty user candidate", async () => {
    const root = await fixture();
    const codexHome = await fixture();
    await put(root, "target.ts", "");
    await put(codexHome, "AGENTS.override.md", "\n");
    await put(codexHome, "AGENTS.md", "personal instructions");

    const trace = await traceCodex({
      root,
      cwd: root,
      target: "target.ts",
      includeUser: true,
      codexHome,
    });

    expect(trace.decisions.map(({ path: file, status, sequence }) => ({ file, status, sequence }))).toEqual([
      { file: "<home>/AGENTS.override.md", status: "skipped-empty", sequence: undefined },
      { file: "<home>/AGENTS.md", status: "loaded", sequence: 1 },
    ]);
    expect(trace.summary.includedFiles).toBe(1);
  });

  it("truncates the final selected file at the project byte limit", async () => {
    const root = await fixture();
    const cwd = path.join(root, "child");
    await mkdir(cwd);
    await put(root, "AGENTS.md", "123456");
    await put(root, "child/AGENTS.md", "abcdef");
    await put(root, "child/target.ts", "");

    const trace = await traceCodex({ root, cwd, target: "target.ts", maxBytes: 8 });

    expect(trace.decisions.map(({ status, bytesIncluded }) => ({ status, bytesIncluded }))).toEqual([
      { status: "loaded", bytesIncluded: 6 },
      { status: "loaded-truncated", bytesIncluded: 2 },
    ]);
    expect(trace.summary).toMatchObject({
      includedFiles: 2,
      includedBytes: 8,
      approximateTokens: 2,
    });
    expect(trace.summary.warnings).toHaveLength(1);
  });

  it("rejects a target outside the declared project root", async () => {
    const root = await fixture();
    const outside = await fixture();
    await put(outside, "outside.ts", "");

    await expect(
      traceCodex({ root, cwd: root, target: path.join(outside, "outside.ts") }),
    ).rejects.toBeInstanceOf(InputError);
  });

  it("does not read a project instruction symlink that escapes the root", async () => {
    const root = await fixture();
    const outside = await fixture();
    await put(outside, "secret.md", "do not read");
    await put(root, "target.ts", "");

    try {
      await symlink(path.join(outside, "secret.md"), path.join(root, "AGENTS.md"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    }

    const trace = await traceCodex({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions[0]).toMatchObject({
      path: "AGENTS.md",
      status: "skipped-security-boundary",
      bytesIncluded: 0,
    });
    expect(trace.summary.warnings).toHaveLength(1);
  });
});
