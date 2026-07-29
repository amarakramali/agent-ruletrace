import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { traceMatrix } from "../src/core/matrix.js";
import { InputError } from "../src/core/paths.js";
import {
  getProfile,
  isProfileId,
  PROFILE_IDS,
  PROFILE_REGISTRY,
  traceProfile,
} from "../src/profiles/registry.js";
import { renderMatrix } from "../src/render/matrix.js";

const temporaryRoots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-ruletrace-matrix-"));
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

describe("profile registry", () => {
  it("provides every implemented profile in stable CLI order", () => {
    expect(PROFILE_IDS).toEqual(["codex", "claude", "gemini", "copilot"]);
    expect(PROFILE_REGISTRY.map((profile) => profile.metadata.id)).toEqual(
      PROFILE_IDS,
    );
    expect(isProfileId("gemini")).toBe(true);
    expect(isProfileId("cursor")).toBe(false);
  });

  it("dispatches a trace and rejects unknown profiles with the supported list", async () => {
    const root = await fixture();
    await put(root, "AGENTS.md", "instructions");
    await put(root, "target.ts", "export {}");

    const trace = await traceProfile("codex", {
      root,
      cwd: root,
      target: "target.ts",
    });

    expect(trace.profile).toBe(getProfile("codex").metadata);
    expect(trace.summary.includedFiles).toBe(1);
    expect(() => getProfile("cursor")).toThrowError(InputError);
    expect(() => getProfile("cursor")).toThrowError(
      "available: codex, claude, gemini, copilot",
    );
  });
});

describe("profile matrix", () => {
  it("compares full traces for the same target across all profiles", async () => {
    const root = await fixture();
    await put(root, "AGENTS.md", "Codex instruction");
    await put(root, "CLAUDE.md", "Claude instruction");
    await put(root, "GEMINI.md", "Gemini instruction");
    await put(root, ".github/copilot-instructions.md", "Copilot instruction");
    await put(root, "src/target.ts", "export {}");

    const matrix = await traceMatrix({
      root,
      cwd: root,
      target: "src/target.ts",
    });

    expect(matrix.traces.map((trace) => trace.profile.id)).toEqual(PROFILE_IDS);
    expect(
      matrix.traces.every(
        (trace) => trace.inputs.target === matrix.inputs.target,
      ),
    ).toBe(true);
    expect(
      matrix.traces.map((trace) => ({
        id: trace.profile.id,
        files: trace.summary.includedFiles,
      })),
    ).toEqual([
      { id: "codex", files: 1 },
      { id: "claude", files: 1 },
      { id: "gemini", files: 1 },
      { id: "copilot", files: 4 },
    ]);
    expect(matrix.summary).toMatchObject({
      profileCount: 4,
      includedFiles: 7,
      warningCount: 0,
    });
  });

  it("renders comparable totals, loaded paths, and aggregated warnings", async () => {
    const root = await fixture();
    await put(root, "AGENTS.md", "long instructions");
    await put(root, "target.ts", "export {}");

    const matrix = await traceMatrix({
      root,
      cwd: root,
      target: "target.ts",
      maxBytes: 2,
    });
    const output = renderMatrix(matrix);

    expect(matrix.summary.warningCount).toBe(1);
    expect(output).toContain("PROFILE");
    expect(output).toContain("Codex");
    expect(output).toContain("GitHub Copilot CLI");
    expect(output).toContain("codex    AGENTS.md");
    expect(output).toContain("copilot  AGENTS.md");
    expect(output).toContain("1 warning(s) across all profiles");
  });
});
