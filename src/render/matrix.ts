import pc from "picocolors";
import type { MatrixResult, TraceResult } from "../core/types.js";

const NUMBER_WIDTH = 8;

function numberCell(value: number): string {
  return String(value).padStart(NUMBER_WIDTH);
}

function loadedPaths(trace: TraceResult): string {
  const paths = trace.decisions
    .filter(
      (decision) =>
        decision.status === "loaded" || decision.status === "loaded-truncated",
    )
    .map((decision) => decision.path);
  return paths.length === 0 ? "—" : paths.join(", ");
}

export function renderMatrix(matrix: MatrixResult): string {
  const profileWidth =
    Math.max(
      "PROFILE".length,
      ...matrix.traces.map((trace) => trace.profile.displayName.length),
    ) + 2;
  const lines = [
    pc.bold("Agent RuleTrace · profile matrix"),
    `Root:   ${matrix.inputs.root}`,
    `Cwd:    ${matrix.inputs.cwd}`,
    `Target: ${matrix.inputs.target}`,
    "",
    `${"PROFILE".padEnd(profileWidth)}${"FILES".padStart(NUMBER_WIDTH)}${"BYTES".padStart(NUMBER_WIDTH)}${"~TOKENS".padStart(NUMBER_WIDTH)}${"WARN".padStart(NUMBER_WIDTH)}`,
  ];

  for (const trace of matrix.traces) {
    lines.push(
      `${trace.profile.displayName.padEnd(profileWidth)}${numberCell(trace.summary.includedFiles)}${numberCell(trace.summary.includedBytes)}${numberCell(trace.summary.approximateTokens)}${numberCell(trace.summary.warnings.length)}`,
    );
  }

  lines.push("", pc.bold("Loaded instruction paths"));
  for (const trace of matrix.traces) {
    lines.push(`${trace.profile.id.padEnd(8)} ${loadedPaths(trace)}`);
  }

  lines.push(
    "",
    `${matrix.summary.profileCount} profile(s), ${matrix.summary.includedFiles} file(s), ${matrix.summary.includedBytes} bytes, ~${matrix.summary.approximateTokens} tokens`,
  );
  if (matrix.summary.warningCount > 0) {
    lines.push(
      pc.yellow(
        `${matrix.summary.warningCount} warning(s) across all profiles`,
      ),
    );
  }
  return lines.join("\n");
}
