import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { traceClaude } from "../src/profiles/claude.js";

const temporaryRoots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-ruletrace-claude-"));
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

describe("Claude Code profile", () => {
  it("distinguishes launch-time ancestors from target-triggered descendant instructions", async () => {
    const root = await fixture();
    const cwd = path.join(root, "packages", "app");
    await mkdir(path.join(cwd, "src", "api"), { recursive: true });
    await put(root, "CLAUDE.md", "root");
    await put(root, ".claude/CLAUDE.md", "root dot-claude");
    await put(root, "packages/app/CLAUDE.local.md", "local app");
    await put(root, "packages/app/src/CLAUDE.md", "lazy src");
    await put(root, "packages/app/src/api/user.ts", "export {}");

    const trace = await traceClaude({ root, cwd, target: "src/api/user.ts" });

    expect(
      trace.decisions.map(({ path: file, phase, status, sequence }) => ({
        file,
        phase,
        status,
        sequence,
      })),
    ).toEqual([
      { file: "CLAUDE.md", phase: "startup", status: "loaded", sequence: 1 },
      { file: ".claude/CLAUDE.md", phase: "startup", status: "loaded", sequence: 2 },
      {
        file: "packages/app/CLAUDE.local.md",
        phase: "startup",
        status: "loaded",
        sequence: 3,
      },
      {
        file: "packages/app/src/CLAUDE.md",
        phase: "lazy",
        status: "loaded",
        sequence: 4,
      },
    ]);
  });

  it("loads unconditional rules and explains matching and non-matching path rules", async () => {
    const root = await fixture();
    await put(root, "src/api/user.ts", "export {}");
    await put(root, ".claude/rules/global.md", "# Always");
    await put(
      root,
      ".claude/rules/api.md",
      '---\npaths:\n  - "src/api/**/*.ts"\n---\n# API',
    );
    await put(root, ".claude/rules/docs.md", '---\npaths: "docs/**"\n---\n# Docs');

    const trace = await traceClaude({ root, cwd: root, target: "src/api/user.ts" });

    expect(
      trace.decisions.map(({ path: file, phase, status, matchedPattern }) => ({
        file,
        phase,
        status,
        matchedPattern,
      })),
    ).toEqual([
      {
        file: ".claude/rules/api.md",
        phase: "lazy",
        status: "loaded",
        matchedPattern: "src/api/**/*.ts",
      },
      {
        file: ".claude/rules/docs.md",
        phase: "lazy",
        status: "inapplicable",
        matchedPattern: undefined,
      },
      {
        file: ".claude/rules/global.md",
        phase: "startup",
        status: "loaded",
        matchedPattern: undefined,
      },
    ]);
  });

  it("merges project exclusion settings and marks excluded files", async () => {
    const root = await fixture();
    await put(root, "CLAUDE.md", "excluded");
    await put(root, ".claude/rules/testing.md", "# Testing");
    await put(
      root,
      ".claude/settings.local.json",
      JSON.stringify({ claudeMdExcludes: ["**/CLAUDE.md"] }),
    );
    await put(root, "target.ts", "");

    const trace = await traceClaude({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "CLAUDE.md", status: "excluded" }),
        expect.objectContaining({ path: ".claude/rules/testing.md", status: "loaded" }),
      ]),
    );
  });

  it("expands imports, ignores code examples, and stops import cycles", async () => {
    const root = await fixture();
    await put(
      root,
      "CLAUDE.md",
      [
        "@docs/base.md",
        "`@ignored-inline.md`",
        "```md",
        "@ignored-fenced.md",
        "```",
      ].join("\n"),
    );
    await put(root, "docs/base.md", "@../CLAUDE.md\nbase");
    await put(root, "target.ts", "");

    const trace = await traceClaude({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions.map(({ path: file, status }) => ({ file, status }))).toEqual([
      { file: "CLAUDE.md", status: "loaded" },
      { file: "docs/base.md", status: "loaded" },
      { file: "CLAUDE.md", status: "import-cycle" },
    ]);
    expect(trace.summary.warnings).toEqual(["CLAUDE.md closes an import cycle"]);
  });

  it("reports invalid rule frontmatter without losing the rest of the trace", async () => {
    const root = await fixture();
    await put(root, "CLAUDE.md", "project");
    await put(root, ".claude/rules/broken.md", "---\npaths: [\n---\n# Broken");
    await put(root, "target.ts", "");

    const trace = await traceClaude({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "CLAUDE.md", status: "loaded" }),
        expect.objectContaining({ path: ".claude/rules/broken.md", status: "parse-error" }),
      ]),
    );
    expect(trace.summary.warnings).toEqual([
      ".claude/rules/broken.md has invalid frontmatter",
    ]);
  });

  it("loads opted-in user instructions before project instructions", async () => {
    const root = await fixture();
    const claudeHome = await fixture();
    await put(root, "CLAUDE.md", "project");
    await put(root, "target.ts", "");
    await put(claudeHome, "CLAUDE.md", "user");
    await put(claudeHome, "rules/preferences.md", "# Personal");

    const trace = await traceClaude({
      root,
      cwd: root,
      target: "target.ts",
      includeUser: true,
      claudeHome,
    });

    expect(
      trace.decisions
        .filter((decision) => decision.status === "loaded")
        .map(({ path: file, sequence }) => ({ file, sequence })),
    ).toEqual([
      { file: "<home>/CLAUDE.md", sequence: 1 },
      { file: "<home>/rules/preferences.md", sequence: 2 },
      { file: "CLAUDE.md", sequence: 3 },
    ]);
  });

  it("does not read an external project import without host approval", async () => {
    const root = await fixture();
    const outside = await fixture();
    await put(outside, "external.md", "private");
    await put(root, "CLAUDE.md", `@${path.join(outside, "external.md")}`);
    await put(root, "target.ts", "");

    const trace = await traceClaude({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions[1]).toMatchObject({
      kind: "import",
      status: "skipped-security-boundary",
      bytesIncluded: 0,
      confidence: "host-dependent",
    });
    expect(trace.summary.warnings).toHaveLength(1);
  });

  it("stops recursive imports after four hops", async () => {
    const root = await fixture();
    await put(root, "CLAUDE.md", "@imports/a.md");
    await put(root, "imports/a.md", "@b.md");
    await put(root, "imports/b.md", "@c.md");
    await put(root, "imports/c.md", "@d.md");
    await put(root, "imports/d.md", "@e.md");
    await put(root, "imports/e.md", "beyond the limit");
    await put(root, "target.ts", "");

    const trace = await traceClaude({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions.at(-1)).toMatchObject({
      path: "imports/e.md",
      status: "import-depth",
      bytesIncluded: 0,
    });
    expect(trace.summary.includedFiles).toBe(5);
  });
});
