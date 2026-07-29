import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isWithin } from "./paths.js";

export async function existingFile(
  candidate: string,
  boundary: string,
): Promise<string | undefined> {
  let info;
  try {
    info = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!info.isFile() && !info.isSymbolicLink()) {
    return undefined;
  }
  const resolved = info.isSymbolicLink()
    ? await realpath(candidate)
    : candidate;
  return isWithin(boundary, resolved) ? resolved : undefined;
}

export async function markdownFiles(
  directory: string,
  boundary: string,
): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      result.push(...(await markdownFiles(candidate, boundary)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      isWithin(boundary, candidate)
    ) {
      result.push(candidate);
    }
  }
  return result;
}

export function posixPath(value: string): string {
  return value.split(path.sep).join("/");
}
