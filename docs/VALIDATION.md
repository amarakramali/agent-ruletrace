# Validation: Agent RuleTrace

Validated on 2026-07-29.

## Decision

Build a local CLI that answers:

> For this coding-agent client, launch directory, and target file, which
> instruction files are loaded, in what phase/order, and why?

The product is intentionally narrower than an instruction linter. It simulates
file discovery and path matching, explains every inclusion and exclusion, and
reports uncertainty when a client does not guarantee an order.

## Target users and observed problem

The initial users are developers and platform teams that use two or more coding
agents in monorepos or repositories with nested/path-scoped instructions.

The same repository can contain `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`,
`.claude/rules/*.md`, `GEMINI.md`, `.github/copilot-instructions.md`, and
`.github/instructions/*.instructions.md`. Their discovery rules differ:

- Codex builds a root-to-working-directory instruction chain, chooses at most
  one project file per directory, supports configured fallback filenames, and
  truncates at a configurable byte limit.
- Claude Code loads ancestor files at launch, loads descendant files on demand,
  supports recursive imports and path-scoped rules, and can exclude files.
- Gemini CLI combines global, workspace, and just-in-time context and allows a
  configurable list of context filenames.
- GitHub Copilot combines repository-wide, path-specific, agent, personal, and
  organization instructions with documented precedence tiers.

Those differences make a static “which filenames exist?” scan insufficient. A
developer needs to know the effective context for a particular client and path.

## Public evidence

### Official specifications

1. OpenAI documents Codex's exact root discovery, per-directory fallback,
   override selection, merge order, and 32 KiB default cap:
   https://learn.chatgpt.com/docs/agent-configuration/agents-md.md
2. Anthropic documents Claude Code's load order, lazy descendant discovery,
   imports, exclusions, and `paths` frontmatter:
   https://code.claude.com/docs/en/memory
3. Gemini CLI documents global/workspace/JIT context, `/memory show`, imports,
   and configurable context filenames:
   https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
4. GitHub documents repository-wide, path-specific, and agent instruction
   sources plus their precedence:
   https://docs.github.com/en/copilot/concepts/prompting/response-customization
5. VS Code documents automatic instruction discovery, nested `AGENTS.md`, and
   `applyTo` path matching:
   https://code.visualstudio.com/docs/agent-customization/custom-instructions

These primary sources establish both adoption and incompatible behavior. The
profiles in the tool will cite these sources and carry a “verified on” date.

### Empirical and user signals

1. “Configuration Smells in AGENTS.md Files” reports widespread context and
   scope problems in real repositories, including lint leakage and context
   bloat: https://arxiv.org/abs/2606.15828
2. A team discussion describes maintaining duplicated `CLAUDE.md` and
   `AGENTS.md` files across tools:
   https://www.reddit.com/r/mcp/comments/1ur0bj4/how_does_your_team_keep_claudemdagentsmd_files/
3. A Codex user discussion shows uncertainty about how much belongs in
   `AGENTS.md`:
   https://www.reddit.com/r/codex/comments/1ue0868/am_i_overdoing_my_agentsmd_file/
4. GitHub Trending on 2026-07-29 prominently featured agent harnesses,
   governance tools, multi-agent fleets, and agent-output skills, indicating
   continued growth of repository-level agent configuration:
   https://github.com/trending

No single user report is treated as proof. The product decision relies on the
combination of official divergence, empirical measurements, and repeated
community uncertainty.

## Current workarounds

- Read each vendor's documentation and manually reconstruct the chain.
- Ask the agent to summarize its instructions, which is not deterministic,
  difficult to automate, and may omit discovery reasons.
- Inspect runtime logs or client-specific `/memory` views.
- Use a generic linter to validate files without simulating a target path.
- Maintain a static comparison table that becomes stale as clients change.

## Competition review

The generic linting and synchronization space is crowded:

- agnix validates hundreds of rules across agent configuration formats:
  https://github.com/agent-sh/agnix
- ctxlint checks paths, commands, staleness, contradictions, frontmatter,
  tokens, secrets, and session data: https://github.com/YawLabs/ctxlint
- AgentLinter, context-drift, and instrlint provide additional linting, drift,
  and consistency checks: https://github.com/seojoonkim/agentlinter
  https://github.com/geekiyer/context-drift https://github.com/jed1978/instrlint
- Agent Context Map is a useful static, source-linked comparison of instruction
  locations, but currently covers Codex behavior rather than providing an
  executable, target-path simulation:
  https://github.com/cclilshy/agent-context-map

Repository and code searches on 2026-07-29 found no tool whose primary contract
is:

`client + launch directory + target path -> explained effective instruction chain`

The gap is therefore not “another linter.” It is deterministic provenance,
including files that were ignored, shadowed, lazily loaded, or path-matched.

## Why now

- More clients support nested or path-scoped instructions.
- Teams increasingly run several agents against the same repository.
- New instruction formats make silent scope mistakes more likely.
- Official behavior is documented well enough to build deterministic,
  source-linked profiles without reverse-engineering private APIs.

## Smallest useful solution

A zero-network CLI with four profiles (`codex`, `claude`, `gemini`, `copilot`)
that:

1. receives a project root, launch directory, and target path;
2. discovers supported instruction sources;
3. explains loaded, lazy, matched, ignored, shadowed, and uncertain entries;
4. displays order/precedence only when the client guarantees it;
5. estimates the included byte/token budget;
6. emits stable JSON for CI and editor integrations.

User/home instructions are excluded unless explicitly requested.

## Opportunity score

| Criterion           |     Points | Rationale                                                                                                                |
| ------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------ |
| Demand              |      18/20 | Four major clients expose overlapping repository instruction systems; multi-client repositories are increasingly common. |
| Trend speed         |      14/15 | Agent harnesses, multi-agent workflows, and instruction-file research are active in July 2026.                           |
| User pain           |      16/20 | Wrong scope silently changes agent behavior and wastes debugging time, although it is not always blocking.               |
| Competition gap     |      11/15 | Linters and reference tables are strong, but target-path provenance remains underserved.                                 |
| Feasibility         |       9/10 | The MVP is read-only filesystem analysis with documented rules and bounded parsing.                                      |
| Visibility          |       9/10 | A terminal trace and four-client matrix make the value immediately demonstrable.                                         |
| Extension potential |        4/5 | Additional profiles, editor integration, and CI drift detection are natural later steps.                                 |
| Profile fit         |        5/5 | Demonstrates developer tooling, cross-platform parsing, testing, and product judgment.                                   |
| **Total**           | **86/100** | **Selected.**                                                                                                            |

## Ideas rejected during this cycle

- MCP schema diffing: exact, maintained solutions such as `mcp-diff` and schema
  snapshot tools already exist.
- Worktree runtime isolation: `workz`, `falq`, `portree`, `portman-cli`, and
  related tools already address ports, processes, and environment isolation.
- Agent skill security scanning: Cisco, Snyk, and several dedicated open-source
  scanners already cover this wedge.
- Cross-agent session handoff and agent-trace redaction: both have multiple
  current exact solutions.
- Generic instruction lint/sync: agnix and ctxlint are already broad, mature
  competitors.

## Falsifiable launch hypothesis

Developers with multi-agent repositories will prefer one local command that
explains effective instructions for a target file over manually consulting four
client specifications.

The first release should be reconsidered if:

- fixture-backed profiles cannot reproduce documented client behavior;
- a maintained exact competitor is found before publication;
- deterministic output requires executing untrusted repository code; or
- the profile update burden proves disproportionate to the tool's value.
