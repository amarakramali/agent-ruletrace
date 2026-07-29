import type {
  MatrixResult,
  ProfileTraceOptions,
  TraceResult,
} from "./types.js";
import { PROFILE_REGISTRY } from "../profiles/registry.js";

const TOOL_VERSION = "0.1.0";

export async function traceMatrix(
  options: ProfileTraceOptions,
): Promise<MatrixResult> {
  const traces = await Promise.all(
    PROFILE_REGISTRY.map((profile) => profile.trace(options)),
  );
  const firstTrace = traces[0];
  if (!firstTrace) {
    throw new Error("profile registry is empty");
  }

  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    inputs: firstTrace.inputs,
    traces,
    summary: {
      profileCount: traces.length,
      includedFiles: sum(traces, (trace) => trace.summary.includedFiles),
      includedBytes: sum(traces, (trace) => trace.summary.includedBytes),
      approximateTokens: sum(
        traces,
        (trace) => trace.summary.approximateTokens,
      ),
      warningCount: sum(traces, (trace) => trace.summary.warnings.length),
    },
  };
}

function sum(
  traces: TraceResult[],
  select: (trace: TraceResult) => number,
): number {
  return traces.reduce((total, trace) => total + select(trace), 0);
}
