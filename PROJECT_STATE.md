# Agent RuleTrace project state

- Project: Agent RuleTrace
- Repository slug: `agent-ruletrace`
- State: `DOCUMENTING`
- State updated: 2026-07-29
- Opportunity score: 86/100
- Previous state: `DOCUMENTING` (public README, executable example, license, and generated demo)
- Next state: `DOCUMENTING` (profile sources, changelog, community files, and CI)

## State history

| Date | State | Exit evidence |
| --- | --- | --- |
| 2026-07-29 | `DISCOVERING` | Agent instruction files emerged as a fast-growing, fragmented configuration surface across Codex, Claude Code, Gemini CLI, and GitHub Copilot. |
| 2026-07-29 | `VALIDATING` | Multiple official specifications, an empirical study, user reports, and a competitor review confirmed the problem and the narrower provenance gap. |
| 2026-07-29 | `SELECTED` | Agent RuleTrace scored 86/100 and beat the other researched candidates after exact-solution checks. |
| 2026-07-29 | `ARCHITECTING` | The MVP contract, client profiles, data flow, security boundaries, error behavior, test plan, packaging, demo, and release gates are defined in `docs/ARCHITECTURE.md`. |
| 2026-07-29 | `BUILDING` | The executable CLI foundation, normalized trace model, safe path boundary, text/JSON renderers, and fixture-tested Codex profile are implemented. |
| 2026-07-29 | `BUILDING` | The Claude Code profile now explains launch-time and lazy instruction discovery, path-scoped rules, merged exclusions, imports, cycles, depth limits, user scope, and parse failures. |
| 2026-07-29 | `BUILDING` | The Gemini CLI profile now explains effective context filenames, global/workspace/JIT discovery, imports, cycles, depth limits, settings precedence, security boundaries, and duplicate physical sources. |
| 2026-07-29 | `BUILDING` | The GitHub Copilot CLI profile now explains user, repository-wide, path-specific, and agent instructions; root/cwd/target discovery; applyTo matching; documented content deduplication; and unspecified general precedence. |
| 2026-07-29 | `TESTING` | The four-profile registry and matrix command complete the MVP implementation with stable text/JSON comparison, aggregate warnings, shared CLI dispatch, and fixture-backed behavior. |
| 2026-07-29 | `DOCUMENTING` | Unit/profile tests plus a real tarball clean-install test now verify all commands, stable JSON, offline execution, safe package contents, and exit codes 0/1/2 against a mixed-agent fixture. |
| 2026-07-29 | `DOCUMENTING` | The public README, MIT license, executable mixed-agent example, and reproducible SVG terminal demo now explain and visibly prove the primary use case. |

## Current-cycle rule

Do not start another tool project before Agent RuleTrace reaches `CLOSED` or is
explicitly abandoned for one of the allowed evidence-based reasons.
