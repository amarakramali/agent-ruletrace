import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export class InputError extends Error {
  readonly exitCode = 2;
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function canonicalDirectory(
  value: string,
  label: string,
): Promise<string> {
  const resolved = path.resolve(value);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new InputError(`${label} is not a directory: ${resolved}`);
    }
    return await realpath(resolved);
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }
    throw new InputError(
      `${label} does not exist or cannot be read: ${resolved}`,
    );
  }
}

export async function canonicalTarget(
  value: string,
  cwd: string,
): Promise<string> {
  const resolved = path.resolve(cwd, value);
  try {
    await access(resolved);
    return await realpath(resolved);
  } catch {
    throw new InputError(
      `target does not exist or cannot be read: ${resolved}`,
    );
  }
}

export async function findGitRoot(start: string): Promise<string> {
  let cursor = await canonicalDirectory(start, "cwd");
  while (true) {
    try {
      await access(path.join(cursor, ".git"));
      return cursor;
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return await canonicalDirectory(start, "cwd");
      }
      cursor = parent;
    }
  }
}

export function pathChain(root: string, cwd: string): string[] {
  if (!isWithin(root, cwd)) {
    throw new InputError(`cwd must be inside root: cwd=${cwd}, root=${root}`);
  }

  const relative = path.relative(root, cwd);
  if (relative === "") {
    return [root];
  }

  const segments = relative.split(path.sep).filter(Boolean);
  const chain = [root];
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    chain.push(cursor);
  }
  return chain;
}

export function displayPath(
  root: string,
  candidate: string,
  home?: string,
): string {
  if (isWithin(root, candidate)) {
    const relative = path.relative(root, candidate);
    return relative === "" ? "." : relative.split(path.sep).join("/");
  }
  if (home && isWithin(home, candidate)) {
    const relative = path.relative(home, candidate).split(path.sep).join("/");
    return relative === "" ? "<home>" : `<home>/${relative}`;
  }
  return candidate.split(path.sep).join("/");
}
