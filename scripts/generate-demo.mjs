import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const exampleRoot = path.join(repositoryRoot, "examples", "mixed-agent-repo");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const outputPath = path.join(repositoryRoot, "docs", "demo.svg");
const command = "$ ruletrace matrix src/api/users.ts --cwd .";

const result = spawnSync(
  process.execPath,
  [
    cliPath,
    "matrix",
    "src/api/users.ts",
    "--root",
    exampleRoot,
    "--cwd",
    exampleRoot,
  ],
  {
    cwd: exampleRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    windowsHide: true,
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(
    `demo command exited ${result.status}\n${result.stdout}\n${result.stderr}`,
  );
}

const ansiPattern = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);
const stripAnsi = (value) => value.replace(ansiPattern, "");
const normalizeExamplePath = (value) =>
  value
    .split(exampleRoot)
    .join("./examples/mixed-agent-repo")
    .replaceAll("\\", "/");
const lines = [
  command,
  "",
  ...normalizeExamplePath(stripAnsi(result.stdout)).trimEnd().split(/\r?\n/),
];

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const lineHeight = 22;
const top = 70;
const height = top + lines.length * lineHeight + 28;
const text = lines
  .map((line, index) => {
    const y = top + index * lineHeight;
    const fill =
      index === 0
        ? "#7ee787"
        : line.startsWith("PROFILE") || line === "Loaded instruction paths"
          ? "#79c0ff"
          : "#c9d1d9";
    return `<text x="28" y="${y}" fill="${fill}" style="white-space:pre">${escapeXml(line)}</text>`;
  })
  .join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${height}" viewBox="0 0 1280 ${height}" role="img" aria-labelledby="title description">
  <title id="title">Agent RuleTrace profile matrix demo</title>
  <desc id="description">Terminal output comparing effective instruction files for Codex, Claude Code, Gemini CLI, and GitHub Copilot CLI.</desc>
  <rect width="1280" height="${height}" rx="12" fill="#0d1117"/>
  <rect width="1280" height="42" rx="12" fill="#161b22"/>
  <rect y="30" width="1280" height="12" fill="#161b22"/>
  <circle cx="24" cy="21" r="6" fill="#ff7b72"/>
  <circle cx="44" cy="21" r="6" fill="#d29922"/>
  <circle cx="64" cy="21" r="6" fill="#3fb950"/>
  <text x="640" y="26" text-anchor="middle" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">agent-ruletrace · mixed-agent-repo</text>
  <g xml:space="preserve" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="15">
  ${text}
  </g>
</svg>
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, "utf8");
process.stdout.write(
  `Generated ${path.relative(repositoryRoot, outputPath)} from installed CLI output.\n`,
);
