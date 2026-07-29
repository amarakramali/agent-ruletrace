export type TraceStatus =
  | "loaded"
  | "loaded-truncated"
  | "shadowed"
  | "excluded"
  | "inapplicable"
  | "parse-error"
  | "import-cycle"
  | "import-depth"
  | "skipped-empty"
  | "skipped-limit"
  | "skipped-security-boundary";

export type TraceConfidence = "documented" | "host-dependent";

export interface ProfileSource {
  id: string;
  label: string;
  url: string;
}

export interface ProfileMetadata {
  id: string;
  displayName: string;
  verifiedOn: string;
  status: "implemented" | "planned";
  sources: ProfileSource[];
}

export interface TraceInput {
  root: string;
  cwd: string;
  target: string;
  includeUser: boolean;
}

export interface TraceDecision {
  path: string;
  kind: "managed" | "user" | "project" | "rule" | "import" | "settings";
  phase: "startup" | "lazy" | "import";
  status: TraceStatus;
  sequence?: number;
  matchedPattern?: string;
  bytesAvailable: number;
  bytesIncluded: number;
  selectedOver?: string[];
  reason: string;
  confidence: TraceConfidence;
  source: string;
}

export interface TraceSummary {
  includedFiles: number;
  includedBytes: number;
  approximateTokens: number;
  warnings: string[];
}

export interface TraceResult {
  schemaVersion: 1;
  toolVersion: string;
  profile: ProfileMetadata;
  inputs: TraceInput;
  decisions: TraceDecision[];
  summary: TraceSummary;
}

export interface CodexTraceOptions {
  root: string;
  cwd: string;
  target: string;
  includeUser?: boolean;
  codexHome?: string;
  fallbackFilenames?: string[];
  maxBytes?: number;
}

export interface ClaudeTraceOptions {
  root: string;
  cwd: string;
  target: string;
  includeUser?: boolean;
  claudeHome?: string;
  excludes?: string[];
}

export interface GeminiTraceOptions {
  root: string;
  cwd: string;
  target: string;
  includeUser?: boolean;
  geminiHome?: string;
  contextFilenames?: string[];
}

export interface CopilotTraceOptions {
  root: string;
  cwd: string;
  target: string;
  includeUser?: boolean;
  copilotHome?: string;
}

export interface ProfileTraceOptions {
  root: string;
  cwd: string;
  target: string;
  includeUser?: boolean;
  codexHome?: string;
  claudeHome?: string;
  geminiHome?: string;
  copilotHome?: string;
  fallbackFilenames?: string[];
  excludes?: string[];
  contextFilenames?: string[];
  maxBytes?: number;
}

export interface MatrixSummary {
  profileCount: number;
  includedFiles: number;
  includedBytes: number;
  approximateTokens: number;
  warningCount: number;
}

export interface MatrixResult {
  schemaVersion: 1;
  toolVersion: string;
  inputs: TraceInput;
  traces: TraceResult[];
  summary: MatrixSummary;
}
