import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skippedDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);
const patterns = [
  ["GitHub personal access token", /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g],
  ["OpenAI-style API key", /\bsk-[A-Za-z0-9_-]{20,}/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const findings = [];

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        await scan(candidate);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const info = await lstat(candidate);
    if (info.size > 1_000_000) {
      continue;
    }
    const content = await readFile(candidate, "utf8");
    for (const [label, pattern] of patterns) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        findings.push(
          `${path.relative(repositoryRoot, candidate).split(path.sep).join("/")}:${line} ${label}`,
        );
      }
    }
  }
}

await scan(repositoryRoot);
if (findings.length > 0) {
  process.stderr.write(
    `Potential secrets found:\n${findings.map((finding) => `- ${finding}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed: no credential patterns found.\n");
}
