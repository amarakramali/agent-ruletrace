import assert from "node:assert/strict";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureSource = path.join(
  repositoryRoot,
  "tests",
  "fixtures",
  "mixed-agent-repo",
);
const npmCliPath = process.env.npm_execpath;
assert(npmCliPath, "test:package must be launched through npm");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  const expectedStatus = options.expectedStatus ?? 0;
  assert.equal(
    result.status,
    expectedStatus,
    [
      `${command} ${args.join(" ")} exited ${result.status}; expected ${expectedStatus}`,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return result;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `${label} did not emit valid JSON:\n${result.stdout}\n${result.stderr}`,
      { cause: error },
    );
  }
}

function runNpm(args, options = {}) {
  return run(process.execPath, [npmCliPath, ...args], options);
}

function assertSafeTarball(files) {
  const paths = files.map((file) => file.path);
  assert(paths.includes("dist/cli.js"), "tarball must contain the executable bundle");
  assert(paths.includes("dist/cli.d.ts"), "tarball must contain declarations");
  assert(paths.includes("package.json"), "tarball must contain package metadata");

  const forbidden = paths.filter(
    (file) =>
      file.startsWith("src/") ||
      file.startsWith("tests/") ||
      file.startsWith("scripts/") ||
      file === ".env" ||
      file.startsWith(".git/") ||
      file.endsWith(".log"),
  );
  assert.deepEqual(forbidden, [], `tarball contains development-only files: ${forbidden}`);
}

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "agent-ruletrace-package-"),
);

try {
  const packResult = runNpm([
    "pack",
    "--json",
    "--pack-destination",
    temporaryRoot,
  ]);
  const packMetadata = parseJsonOutput(packResult, "npm pack");
  assert.equal(packMetadata.length, 1, "npm pack must produce exactly one tarball");
  assertSafeTarball(packMetadata[0].files);

  const tarball = path.join(temporaryRoot, packMetadata[0].filename);
  const installRoot = path.join(temporaryRoot, "consumer");
  const fixtureRoot = path.join(installRoot, "fixture");
  await mkdir(installRoot, { recursive: true });
  await writeFile(
    path.join(temporaryRoot, "consumer-package.json"),
    '{"name":"ruletrace-clean-install","private":true}',
    "utf8",
  );
  await cp(
    path.join(temporaryRoot, "consumer-package.json"),
    path.join(installRoot, "package.json"),
  );
  await cp(fixtureSource, fixtureRoot, { recursive: true });

  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    { cwd: installRoot },
  );

  const installedPackage = path.join(
    installRoot,
    "node_modules",
    "agent-ruletrace",
  );
  const cliPath = path.join(installedPackage, "dist", "cli.js");
  await access(cliPath);
  await access(
    path.join(
      installRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "ruletrace.cmd" : "ruletrace",
    ),
  );

  const denyNetworkPath = path.join(temporaryRoot, "deny-network.cjs");
  await writeFile(
    denyNetworkPath,
    [
      'const http = require("node:http");',
      'const https = require("node:https");',
      'const net = require("node:net");',
      'const tls = require("node:tls");',
      'const blocked = () => { throw new Error("network access blocked by package test"); };',
      "http.get = blocked;",
      "http.request = blocked;",
      "https.get = blocked;",
      "https.request = blocked;",
      "net.connect = blocked;",
      "net.createConnection = blocked;",
      "tls.connect = blocked;",
      "globalThis.fetch = blocked;",
    ].join("\n"),
    "utf8",
  );
  const offlineEnvironment = {
    ...process.env,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--require=${denyNetworkPath}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
  const runCli = (args, expectedStatus = 0) =>
    run(process.execPath, [cliPath, ...args], {
      cwd: fixtureRoot,
      env: offlineEnvironment,
      expectedStatus,
    });
  const commonArguments = [
    "src/api/users.ts",
    "--root",
    fixtureRoot,
    "--cwd",
    fixtureRoot,
  ];

  assert.equal(runCli(["--version"]).stdout.trim(), "0.1.0");
  assert.deepEqual(
    runCli(["profiles"])
      .stdout.trim()
      .split(/\r?\n/)
      .map((line) => line.split("\t")[0]),
    ["codex", "claude", "gemini", "copilot"],
  );

  const explain = parseJsonOutput(
    runCli([
      "explain",
      ...commonArguments,
      "--client",
      "claude",
      "--format",
      "json",
    ]),
    "installed explain command",
  );
  assert.equal(explain.profile.id, "claude");
  assert.equal(explain.summary.includedFiles, 2);
  assert.deepEqual(
    explain.decisions
      .filter((decision) => decision.status === "loaded")
      .map((decision) => decision.path),
    ["CLAUDE.md", ".claude/rules/typescript.md"],
  );

  const matrix = parseJsonOutput(
    runCli(["matrix", ...commonArguments, "--format", "json"]),
    "installed matrix command",
  );
  assert.deepEqual(
    matrix.traces.map((trace) => trace.profile.id),
    ["codex", "claude", "gemini", "copilot"],
  );
  assert.deepEqual(
    matrix.traces.map((trace) => trace.summary.includedFiles),
    [1, 2, 1, 5],
  );
  assert.equal(matrix.summary.includedFiles, 9);
  assert.equal(matrix.summary.warningCount, 0);

  const textMatrix = runCli(["matrix", ...commonArguments]).stdout;
  assert.match(textMatrix, /Agent RuleTrace .* profile matrix/);
  assert.match(textMatrix, /GitHub Copilot CLI/);
  assert.match(textMatrix, /typescript\.instructions\.md/);

  const missingTarget = runCli(
    [
      "explain",
      "missing.ts",
      "--root",
      fixtureRoot,
      "--cwd",
      fixtureRoot,
      "--client",
      "codex",
    ],
    2,
  );
  assert.match(missingTarget.stderr, /target does not exist or cannot be read/);

  const unknownProfile = runCli(
    ["explain", ...commonArguments, "--client", "cursor"],
    2,
  );
  assert.match(
    unknownProfile.stderr,
    /available: codex, claude, gemini, copilot/,
  );

  await writeFile(
    path.join(
      fixtureRoot,
      ".github",
      "instructions",
      "broken.instructions.md",
    ),
    "---\napplyTo: [\n---\nbroken",
    "utf8",
  );
  const warnedMatrix = parseJsonOutput(
    runCli(["matrix", ...commonArguments, "--format", "json"], 1),
    "warning matrix command",
  );
  assert.equal(warnedMatrix.summary.warningCount, 1);

  const installedManifest = JSON.parse(
    await readFile(path.join(installedPackage, "package.json"), "utf8"),
  );
  assert.equal(installedManifest.bin.ruletrace, "./dist/cli.js");
  assert.equal(installedManifest.engines.node, ">=20");

  process.stdout.write(
    `Package E2E passed: ${packMetadata[0].filename}, ${packMetadata[0].size} bytes, offline CLI, exit codes 0/1/2.\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
