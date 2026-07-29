export type TraceStatus =
  | "loaded"
  | "loaded-truncated"
  | "shadowed"
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
  kind: "user" | "project";
  phase: "startup";
  status: TraceStatus;
  sequence?: number;
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
