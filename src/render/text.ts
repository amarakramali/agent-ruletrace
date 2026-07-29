import pc from "picocolors";
import type { TraceDecision, TraceResult } from "../core/types.js";

function statusLabel(decision: TraceDecision): string {
  switch (decision.status) {
    case "loaded":
      return pc.green("LOADED".padEnd(12));
    case "loaded-truncated":
      return pc.yellow("TRUNCATED".padEnd(12));
    case "shadowed":
      return pc.dim("SHADOWED".padEnd(12));
    case "skipped-empty":
      return pc.dim("EMPTY".padEnd(12));
    case "skipped-limit":
      return pc.yellow("LIMIT".padEnd(12));
    case "skipped-security-boundary":
      return pc.red("BLOCKED".padEnd(12));
  }
}

export function renderText(trace: TraceResult): string {
  const lines = [
    pc.bold(`Agent RuleTrace · ${trace.profile.displayName}`),
    `Root:   ${trace.inputs.root}`,
    `Cwd:    ${trace.inputs.cwd}`,
    `Target: ${trace.inputs.target}`,
    "",
  ];

  if (trace.decisions.length === 0) {
    lines.push("No supported instruction files were found.");
  } else {
    for (const decision of trace.decisions) {
      const order = decision.sequence === undefined ? " -" : String(decision.sequence).padStart(2, " ");
      lines.push(`${order}  ${statusLabel(decision)} ${decision.path}`);
      lines.push(`    ${decision.reason}`);
      if (decision.bytesIncluded > 0) {
        lines.push(`    ${decision.bytesIncluded}/${decision.bytesAvailable} bytes included`);
      }
    }
  }

  lines.push(
    "",
    `${trace.summary.includedFiles} file(s), ${trace.summary.includedBytes} bytes, ~${trace.summary.approximateTokens} tokens`,
  );
  for (const warning of trace.summary.warnings) {
    lines.push(pc.yellow(`warning: ${warning}`));
  }
  return lines.join("\n");
}
