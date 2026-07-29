import { parseDocument } from "yaml";

export interface ParsedRule {
  paths?: string[];
  error?: string;
}

export interface ParsedCopilotInstruction {
  applyTo?: string[];
  error?: string;
}

export function parseRuleFrontmatter(content: string): ParsedRule {
  if (!content.startsWith("---")) {
    return {};
  }

  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return { error: "frontmatter starts with --- but has no closing delimiter" };
  }

  const document = parseDocument(lines.slice(1, end).join("\n"), {
    customTags: [],
    strict: true,
  });
  if (document.errors.length > 0) {
    return { error: document.errors.map((error) => error.message).join("; ") };
  }

  const value = document.toJS() as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "frontmatter must be a mapping" };
  }
  const rawPaths = (value as Record<string, unknown>).paths;
  if (rawPaths === undefined) {
    return {};
  }
  if (typeof rawPaths === "string") {
    return { paths: [rawPaths] };
  }
  if (Array.isArray(rawPaths) && rawPaths.every((item) => typeof item === "string")) {
    return { paths: rawPaths };
  }
  return { error: "frontmatter paths must be a string or an array of strings" };
}

export function parseCopilotFrontmatter(content: string): ParsedCopilotInstruction {
  if (!content.startsWith("---")) {
    return {};
  }

  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return { error: "frontmatter starts with --- but has no closing delimiter" };
  }

  const document = parseDocument(lines.slice(1, end).join("\n"), {
    customTags: [],
    strict: true,
  });
  if (document.errors.length > 0) {
    return { error: document.errors.map((error) => error.message).join("; ") };
  }

  const value = document.toJS() as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "frontmatter must be a mapping" };
  }
  const rawApplyTo = (value as Record<string, unknown>).applyTo;
  if (rawApplyTo === undefined) {
    return {};
  }
  if (typeof rawApplyTo !== "string") {
    return { error: "frontmatter applyTo must be a comma-separated string" };
  }
  const applyTo = rawApplyTo
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  return applyTo.length > 0
    ? { applyTo }
    : { error: "frontmatter applyTo must contain at least one glob pattern" };
}

export function extractImports(content: string): string[] {
  const imports: string[] = [];
  let fence: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    const fenceMatch = /^(?<fence>`{3,}|~{3,})/.exec(trimmed)?.groups?.fence;
    if (fenceMatch) {
      if (fence === undefined) {
        fence = fenceMatch[0];
      } else if (fenceMatch[0] === fence[0]) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      continue;
    }

    const withoutInlineCode = line.replace(/`[^`]*`/g, "");
    for (const match of withoutInlineCode.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
      const raw = match[1]?.replace(/[),.;:]+$/g, "");
      if (raw) {
        imports.push(raw);
      }
    }
  }
  return imports;
}
