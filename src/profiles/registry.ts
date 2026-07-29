import { InputError } from "../core/paths.js";
import type {
  ProfileMetadata,
  ProfileTraceOptions,
  TraceResult,
} from "../core/types.js";
import { CLAUDE_PROFILE, traceClaude } from "./claude.js";
import { CODEX_PROFILE, traceCodex } from "./codex.js";
import { COPILOT_PROFILE, traceCopilot } from "./copilot.js";
import { GEMINI_PROFILE, traceGemini } from "./gemini.js";

export const PROFILE_IDS = ["codex", "claude", "gemini", "copilot"] as const;

export type ProfileId = (typeof PROFILE_IDS)[number];

export interface RegisteredProfile {
  metadata: ProfileMetadata;
  trace(options: ProfileTraceOptions): Promise<TraceResult>;
}

export const PROFILE_REGISTRY: readonly RegisteredProfile[] = [
  {
    metadata: CODEX_PROFILE,
    trace: (options) =>
      traceCodex({
        root: options.root,
        cwd: options.cwd,
        target: options.target,
        ...(options.includeUser === undefined
          ? {}
          : { includeUser: options.includeUser }),
        ...(options.codexHome === undefined
          ? {}
          : { codexHome: options.codexHome }),
        ...(options.fallbackFilenames === undefined
          ? {}
          : { fallbackFilenames: options.fallbackFilenames }),
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      }),
  },
  {
    metadata: CLAUDE_PROFILE,
    trace: (options) =>
      traceClaude({
        root: options.root,
        cwd: options.cwd,
        target: options.target,
        ...(options.includeUser === undefined
          ? {}
          : { includeUser: options.includeUser }),
        ...(options.claudeHome === undefined
          ? {}
          : { claudeHome: options.claudeHome }),
        ...(options.excludes === undefined ? {} : { excludes: options.excludes }),
      }),
  },
  {
    metadata: GEMINI_PROFILE,
    trace: (options) =>
      traceGemini({
        root: options.root,
        cwd: options.cwd,
        target: options.target,
        ...(options.includeUser === undefined
          ? {}
          : { includeUser: options.includeUser }),
        ...(options.geminiHome === undefined
          ? {}
          : { geminiHome: options.geminiHome }),
        ...(options.contextFilenames === undefined
          ? {}
          : { contextFilenames: options.contextFilenames }),
      }),
  },
  {
    metadata: COPILOT_PROFILE,
    trace: (options) =>
      traceCopilot({
        root: options.root,
        cwd: options.cwd,
        target: options.target,
        ...(options.includeUser === undefined
          ? {}
          : { includeUser: options.includeUser }),
        ...(options.copilotHome === undefined
          ? {}
          : { copilotHome: options.copilotHome }),
      }),
  },
];

const profilesById = new Map(
  PROFILE_REGISTRY.map((profile) => [profile.metadata.id, profile] as const),
);

export function isProfileId(value: string): value is ProfileId {
  return profilesById.has(value);
}

export function supportedProfileIds(): string {
  return PROFILE_IDS.join(", ");
}

export function getProfile(id: string): RegisteredProfile {
  const profile = profilesById.get(id);
  if (!profile) {
    throw new InputError(
      `profile is not implemented yet: ${id} (available: ${supportedProfileIds()})`,
    );
  }
  return profile;
}

export function traceProfile(
  id: string,
  options: ProfileTraceOptions,
): Promise<TraceResult> {
  return getProfile(id).trace(options);
}
