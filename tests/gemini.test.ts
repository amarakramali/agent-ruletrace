import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { traceGemini } from "../src/profiles/gemini.js";

const temporaryRoots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-ruletrace-gemini-"));
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

describe("Gemini CLI profile", () => {
  it("loads global and workspace context before target-triggered JIT context", async () => {
    const root = await fixture();
    const geminiHome = await fixture();
    const cwd = path.join(root, "packages", "app");
    await mkdir(path.join(cwd, "src", "api"), { recursive: true });
    await put(geminiHome, "CONTEXT.md", "global custom");
    await put(geminiHome, "GEMINI.md", "global default");
    await put(root, "CONTEXT.md", "root custom");
    await put(root, "packages/app/GEMINI.md", "workspace default");
    await put(root, "packages/app/src/CONTEXT.md", "jit custom");
    await put(root, "packages/app/src/api/user.ts", "export {}");

    const trace = await traceGemini({
      root,
      cwd,
      target: "src/api/user.ts",
      includeUser: true,
      geminiHome,
      contextFilenames: ["CONTEXT.md"],
    });

    expect(
      trace.decisions
        .filter((decision) => decision.status === "loaded")
        .map(({ path: file, phase, sequence }) => ({ file, phase, sequence })),
    ).toEqual([
      { file: "<home>/CONTEXT.md", phase: "startup", sequence: 1 },
      { file: "<home>/GEMINI.md", phase: "startup", sequence: 2 },
      { file: "CONTEXT.md", phase: "startup", sequence: 3 },
      { file: "packages/app/GEMINI.md", phase: "startup", sequence: 4 },
      { file: "packages/app/src/CONTEXT.md", phase: "lazy", sequence: 5 },
    ]);
    expect(
      trace.decisions.filter(
        (decision) => decision.phase === "lazy" && decision.status === "shadowed",
      ),
    ).toHaveLength(2);
  });

  it("applies project context filenames over user settings and retains GEMINI.md", async () => {
    const root = await fixture();
    const geminiHome = await fixture();
    await put(
      geminiHome,
      "settings.json",
      JSON.stringify({ context: { fileName: "USER.md" } }),
    );
    await put(
      root,
      ".gemini/settings.json",
      JSON.stringify({ context: { fileName: ["PROJECT.md"] } }),
    );
    await put(geminiHome, "USER.md", "not selected");
    await put(geminiHome, "PROJECT.md", "global project name");
    await put(root, "USER.md", "not selected");
    await put(root, "PROJECT.md", "selected");
    await put(root, "GEMINI.md", "default retained");
    await put(root, "target.ts", "");

    const trace = await traceGemini({
      root,
      cwd: root,
      target: "target.ts",
      includeUser: true,
      geminiHome,
    });

    expect(trace.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "<home>/settings.json",
          kind: "settings",
          status: "shadowed",
        }),
        expect.objectContaining({
          path: ".gemini/settings.json",
          kind: "settings",
          status: "loaded",
        }),
        expect.objectContaining({ path: "<home>/PROJECT.md", status: "loaded" }),
        expect.objectContaining({ path: "PROJECT.md", status: "loaded" }),
        expect.objectContaining({ path: "GEMINI.md", status: "loaded" }),
      ]),
    );
    expect(trace.decisions.some((decision) => decision.path.endsWith("USER.md"))).toBe(false);
    expect(trace.summary.includedFiles).toBe(3);
  });

  it("expands imports, ignores code examples, and stops cycles", async () => {
    const root = await fixture();
    await put(
      root,
      "GEMINI.md",
      ["@docs/base.md", "`@ignored-inline.md`", "```md", "@ignored-fenced.md", "```"].join(
        "\n",
      ),
    );
    await put(root, "docs/base.md", "@../GEMINI.md\nbase");
    await put(root, "target.ts", "");

    const trace = await traceGemini({ root, cwd: root, target: "target.ts" });

    expect(
      trace.decisions
        .filter((decision) => decision.phase !== "lazy")
        .map(({ path: file, status }) => ({ file, status })),
    ).toEqual([
      { file: "GEMINI.md", status: "loaded" },
      { file: "docs/base.md", status: "loaded" },
      { file: "GEMINI.md", status: "import-cycle" },
    ]);
    expect(trace.summary.warnings).toEqual(["GEMINI.md closes an import cycle"]);
  });

  it("loads five import hops and stops the sixth", async () => {
    const root = await fixture();
    await put(root, "GEMINI.md", "@imports/a.md");
    await put(root, "imports/a.md", "@b.md");
    await put(root, "imports/b.md", "@c.md");
    await put(root, "imports/c.md", "@d.md");
    await put(root, "imports/d.md", "@e.md");
    await put(root, "imports/e.md", "@f.md");
    await put(root, "imports/f.md", "beyond");
    await put(root, "target.ts", "");

    const trace = await traceGemini({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions.find((decision) => decision.path === "imports/f.md")).toMatchObject({
      status: "import-depth",
      bytesIncluded: 0,
    });
    expect(trace.summary.includedFiles).toBe(6);
  });

  it("reports duplicate physical files instead of loading them twice", async () => {
    const root = await fixture();
    await put(root, "SHARED.md", "same file");
    await link(path.join(root, "SHARED.md"), path.join(root, "GEMINI.md"));
    await put(root, "target.ts", "");

    const trace = await traceGemini({
      root,
      cwd: root,
      target: "target.ts",
      contextFilenames: ["SHARED.md"],
    });

    expect(trace.decisions[0]).toMatchObject({ path: "SHARED.md", status: "loaded" });
    expect(trace.decisions[1]).toMatchObject({ path: "GEMINI.md", status: "shadowed" });
    expect(trace.summary.includedFiles).toBe(1);
  });

  it("blocks imports outside the project boundary", async () => {
    const root = await fixture();
    const outside = await fixture();
    await put(outside, "secret.md", "private");
    await put(root, "GEMINI.md", `@${path.join(outside, "secret.md")}`);
    await put(root, "target.ts", "");

    const trace = await traceGemini({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions[1]).toMatchObject({
      kind: "import",
      status: "skipped-security-boundary",
      bytesIncluded: 0,
    });
    expect(trace.summary.warnings).toHaveLength(1);
  });

  it("reports malformed project settings while continuing a default-name trace", async () => {
    const root = await fixture();
    await put(root, ".gemini/settings.json", '{"context":{"fileName":42}}');
    await put(root, "GEMINI.md", "default");
    await put(root, "target.ts", "");

    const trace = await traceGemini({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions[0]).toMatchObject({
      path: ".gemini/settings.json",
      status: "parse-error",
    });
    expect(trace.decisions[1]).toMatchObject({ path: "GEMINI.md", status: "loaded" });
    expect(trace.summary.warnings).toEqual([".gemini/settings.json could not be parsed"]);
  });
});
