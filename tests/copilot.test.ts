import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { traceCopilot } from "../src/profiles/copilot.js";

const temporaryRoots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "agent-ruletrace-copilot-"),
  );
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".git"));
  return root;
}

async function put(
  root: string,
  relative: string,
  content: string,
): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GitHub Copilot CLI profile", () => {
  it("discovers user, root-to-cwd, and target-path instructions without inventing order", async () => {
    const root = await fixture();
    const copilotHome = await fixture();
    const cwd = path.join(root, "packages", "app");
    await mkdir(path.join(cwd, "src", "api"), { recursive: true });
    await put(copilotHome, "copilot-instructions.md", "personal");
    await put(root, ".github/copilot-instructions.md", "repository");
    await put(root, "AGENTS.md", "root agent");
    await put(root, "packages/CLAUDE.md", "intermediate");
    await put(root, "packages/app/.claude/CLAUDE.md", "launch");
    await put(root, "packages/app/src/GEMINI.md", "target");
    await put(root, "packages/app/src/api/user.ts", "export {}");

    const trace = await traceCopilot({
      root,
      cwd,
      target: "src/api/user.ts",
      includeUser: true,
      copilotHome,
    });

    expect(
      trace.decisions
        .filter((decision) => decision.status === "loaded")
        .map(({ path: file, phase, sequence }) => ({ file, phase, sequence })),
    ).toEqual([
      {
        file: "<home>/copilot-instructions.md",
        phase: "startup",
        sequence: undefined,
      },
      {
        file: ".github/copilot-instructions.md",
        phase: "startup",
        sequence: undefined,
      },
      { file: "AGENTS.md", phase: "startup", sequence: undefined },
      { file: "packages/CLAUDE.md", phase: "startup", sequence: undefined },
      {
        file: "packages/app/.claude/CLAUDE.md",
        phase: "startup",
        sequence: undefined,
      },
      {
        file: "packages/app/src/GEMINI.md",
        phase: "lazy",
        sequence: undefined,
      },
    ]);
  });

  it("applies comma-separated applyTo globs and explains non-matches and missing globs", async () => {
    const root = await fixture();
    await put(root, "src/api/user.ts", "export {}");
    await put(
      root,
      ".github/instructions/typescript.instructions.md",
      '---\napplyTo: "**/*.ts, **/*.tsx"\n---\nTypeScript',
    );
    await put(
      root,
      ".github/instructions/docs.instructions.md",
      '---\napplyTo: "docs/**"\n---\nDocs',
    );
    await put(
      root,
      ".github/instructions/manual.instructions.md",
      "# Manual only",
    );

    const trace = await traceCopilot({
      root,
      cwd: root,
      target: "src/api/user.ts",
    });

    expect(
      trace.decisions.map(({ path: file, status, matchedPattern }) => ({
        file,
        status,
        matchedPattern,
      })),
    ).toEqual([
      {
        file: ".github/instructions/docs.instructions.md",
        status: "inapplicable",
        matchedPattern: undefined,
      },
      {
        file: ".github/instructions/manual.instructions.md",
        status: "inapplicable",
        matchedPattern: undefined,
      },
      {
        file: ".github/instructions/typescript.instructions.md",
        status: "loaded",
        matchedPattern: "**/*.ts",
      },
    ]);
  });

  it("does not discover modular files from root-to-cwd intermediate directories", async () => {
    const root = await fixture();
    const cwd = path.join(root, "packages", "app");
    await mkdir(cwd, { recursive: true });
    await put(
      root,
      ".github/instructions/root.instructions.md",
      '---\napplyTo: "**"\n---\nroot',
    );
    await put(
      root,
      "packages/.github/instructions/intermediate.instructions.md",
      '---\napplyTo: "**"\n---\nintermediate',
    );
    await put(
      root,
      "packages/app/.github/instructions/cwd.instructions.md",
      '---\napplyTo: "**"\n---\ncwd',
    );
    await put(root, "packages/app/target.ts", "");

    const trace = await traceCopilot({ root, cwd, target: "target.ts" });

    expect(trace.decisions.map((decision) => decision.path)).toEqual([
      ".github/instructions/root.instructions.md",
      "packages/app/.github/instructions/cwd.instructions.md",
    ]);
  });

  it("deduplicates identical user, repository-wide, and agent instructions", async () => {
    const root = await fixture();
    const copilotHome = await fixture();
    await put(copilotHome, "copilot-instructions.md", "same");
    await put(root, ".github/copilot-instructions.md", "same");
    await put(root, "AGENTS.md", "same");
    await put(root, "target.ts", "");

    const trace = await traceCopilot({
      root,
      cwd: root,
      target: "target.ts",
      includeUser: true,
      copilotHome,
    });

    expect(
      trace.decisions.map(({ path: file, status }) => ({ file, status })),
    ).toEqual([
      { file: "<home>/copilot-instructions.md", status: "loaded" },
      { file: ".github/copilot-instructions.md", status: "shadowed" },
      { file: "AGENTS.md", status: "shadowed" },
    ]);
    expect(trace.summary.includedFiles).toBe(1);
  });

  it("keeps identical modular files because Copilot documents narrower deduplication", async () => {
    const root = await fixture();
    const copilotHome = await fixture();
    const content = '---\napplyTo: "**/*.ts"\n---\nsame rule';
    await put(copilotHome, "instructions/user.instructions.md", content);
    await put(root, ".github/instructions/project.instructions.md", content);
    await put(root, "target.ts", "");

    const trace = await traceCopilot({
      root,
      cwd: root,
      target: "target.ts",
      includeUser: true,
      copilotHome,
    });

    expect(trace.decisions.map(({ status }) => status)).toEqual([
      "loaded",
      "loaded",
    ]);
    expect(trace.summary.includedFiles).toBe(2);
  });

  it("reports malformed applyTo frontmatter without losing valid files", async () => {
    const root = await fixture();
    await put(root, ".github/copilot-instructions.md", "repository");
    await put(
      root,
      ".github/instructions/broken.instructions.md",
      "---\napplyTo: [\n---\nbroken",
    );
    await put(root, "target.ts", "");

    const trace = await traceCopilot({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".github/copilot-instructions.md",
          status: "loaded",
        }),
        expect.objectContaining({
          path: ".github/instructions/broken.instructions.md",
          status: "parse-error",
        }),
      ]),
    );
    expect(trace.summary.warnings).toEqual([
      ".github/instructions/broken.instructions.md has invalid frontmatter",
    ]);
  });

  it("does not read an instruction symlink that escapes the project root", async () => {
    const root = await fixture();
    const outside = await fixture();
    await put(outside, "secret.md", "private");
    await put(root, "target.ts", "");
    await mkdir(path.join(root, ".github"), { recursive: true });

    try {
      await symlink(
        path.join(outside, "secret.md"),
        path.join(root, ".github", "copilot-instructions.md"),
        "file",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    }

    const trace = await traceCopilot({ root, cwd: root, target: "target.ts" });

    expect(trace.decisions[0]).toMatchObject({
      path: ".github/copilot-instructions.md",
      status: "skipped-security-boundary",
      bytesIncluded: 0,
    });
    expect(trace.summary.warnings).toHaveLength(1);
  });
});
