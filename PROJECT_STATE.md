# Agent RuleTrace project state

- Project: Agent RuleTrace
- Repository slug: `agent-ruletrace`
- State: `ARCHITECTED`
- State updated: 2026-07-29
- Opportunity score: 86/100
- Previous state: `SELECTED`
- Next state: `IN_DEVELOPMENT`

## State history

| Date | State | Exit evidence |
| --- | --- | --- |
| 2026-07-29 | `DISCOVERED` | Agent instruction files emerged as a fast-growing, fragmented configuration surface across Codex, Claude Code, Gemini CLI, and GitHub Copilot. |
| 2026-07-29 | `VALIDATED` | Multiple official specifications, an empirical study, user reports, and a competitor review confirmed the problem and the narrower provenance gap. |
| 2026-07-29 | `SELECTED` | Agent RuleTrace scored 86/100 and beat the other researched candidates after exact-solution checks. |
| 2026-07-29 | `ARCHITECTED` | The MVP contract, client profiles, data flow, security boundaries, error behavior, test plan, packaging, demo, and release gates are defined in `docs/ARCHITECTURE.md`. |

## Current-cycle rule

Do not start another tool project before Agent RuleTrace reaches `RELEASED` or is
explicitly abandoned for one of the allowed evidence-based reasons.

