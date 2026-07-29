import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const outputPath = path.join(repositoryRoot, "docs", "PROFILE_SOURCES.md");

const result = spawnSync(
  process.execPath,
  [cliPath, "profiles", "--format", "json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    windowsHide: true,
  },
);
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(
    `profile catalog command exited ${result.status}\n${result.stdout}\n${result.stderr}`,
  );
}

const catalog = JSON.parse(result.stdout);
const lines = [
  "# Profile sources",
  "",
  "> Generated from the runtime profile registry by",
  "> `npm run docs:profiles`. Do not edit source metadata here.",
  "",
  `Registry schema: ${catalog.schemaVersion} / Tool version: ${catalog.toolVersion}`,
  "",
  "| Profile | ID | Status | Verified |",
  "| --- | --- | --- | --- |",
  ...catalog.profiles.map(
    (profile) =>
      `| ${profile.displayName} | \`${profile.id}\` | ${profile.status} | ${profile.verifiedOn} |`,
  ),
  "",
];

for (const profile of catalog.profiles) {
  lines.push(`## ${profile.displayName}`, "");
  for (const source of profile.sources) {
    lines.push(`- [${source.label}](${source.url}) - \`${source.id}\``);
  }
  lines.push("");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
process.stdout.write(
  `Generated ${path.relative(repositoryRoot, outputPath)} from ${catalog.profiles.length} runtime profiles.\n`,
);
