# Agent RuleTrace architecture

Architecture approved on 2026-07-29 for `v0.1.0`.

## Problem definition

Coding-agent clients discover repository instructions differently. Given a
client, launch directory, and target file, developers cannot quickly determine
which files are effective, when they are loaded, why they match, or which file
was ignored in favor of another.

Agent RuleTrace is a read-only simulator and provenance explorer for that
question.

## Target audience

- Developers using two or more coding-agent clients.
- Monorepo maintainers with nested or path-scoped instructions.
- Platform teams reviewing instruction footprint and migration behavior.
- Tool authors that need a stable JSON representation of effective context.

## Core use case

Within two minutes, a developer can run:

```bash
npx agent-ruletrace explain src/api/users.ts --client claude --cwd .
```

and see:

- the resolved project root, launch directory, and target;
- every candidate instruction file encountered;
- whether it is loaded eagerly, loaded lazily, path-matched, ignored, shadowed,
  excluded, or outside the simulated scope;
- the documented reason and source for each decision;
- guaranteed order/precedence and explicitly marked uncertainty;
- included bytes and a clearly labeled approximate token count.

The matrix command shows the same target across all supported clients:

```bash
npx agent-ruletrace matrix src/api/users.ts --cwd .
```

## MVP scope

### Commands

1. `ruletrace explain <target>`
   - required `--client codex|claude|gemini|copilot`;
   - optional `--root`, `--cwd`, `--format text|json`;
   - optional `--include-user` to inspect user/home instruction sources;
   - optional client settings file arguments where behavior depends on settings.
2. `ruletrace matrix <target>`
   - runs every built-in profile with the same root/cwd/target;
   - text table by default, stable JSON on request.
3. `ruletrace profiles`
   - prints profile version, verification date, support level, and official
     source URLs.

### Client profiles

| Profile        | v0.1 behavior modeled                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex          | Project-root detection, root-to-cwd walk, override/default/fallback selection, global selection, merge order, empty-file skipping, and byte-cap truncation.                                             |
| Claude Code    | Ancestor launch context, lazy descendant `CLAUDE.md` loading for the target, `CLAUDE.local.md`, `.claude/rules/**/*.md`, `paths` matching, exclusions, and import discovery up to the documented depth. |
| Gemini CLI     | Global/workspace context, configured context filenames, just-in-time target ancestry, imports, and duplicate-source reporting.                                                                          |
| GitHub Copilot | Repository-wide instructions, applicable `.instructions.md` files and `applyTo` globs, agent instruction candidates, and documented precedence tiers.                                                   |

Each profile returns a confidence marker:

- `documented`: directly specified by a primary source;
- `host-dependent`: depends on settings or host-provided personal/org context;
- `experimental`: documented as preview/experimental by the client;
- `unsupported`: intentionally outside the profile.

### Output contract

Each trace contains:

```text
schemaVersion
toolVersion
profile { id, verifiedOn, sources[] }
inputs { root, cwd, target, includeUser }
decisions[] {
  path,
  kind,
  phase,
  status,
  sequence,
  matchedPattern?,
  selectedOver?,
  reason,
  confidence,
  source
}
summary { includedFiles, includedBytes, approximateTokens, warnings[] }
```

JSON paths are normalized to `/` and repository-relative wherever possible. User
paths are replaced with `<home>` unless `--reveal-absolute-paths` is explicitly
passed.

## Non-goals for v0.1

- Judging whether instruction prose is good, contradictory, or stale.
- Editing, generating, synchronizing, or auto-fixing instruction files.
- Executing agents, hooks, imports, commands, or repository code.
- Reproducing private organization/personal instructions unavailable on disk.
- Claiming deterministic order where a vendor explicitly does not guarantee it.
- Supporting Cursor, Windsurf, Cline, Zed, or every Copilot host in the first
  release.
- Exact tokenizer accounting; the first release reports bytes and a labeled
  approximation only.

## System components

```text
CLI parser
  -> input resolver and trust boundary
  -> client profile
       -> safe filesystem inventory
       -> settings reader
       -> frontmatter/import parser
       -> path matcher
       -> decision/provenance builder
  -> normalized trace model
  -> text renderer | JSON renderer | matrix renderer
```

### Repository layout

```text
src/
  cli.ts
  commands/
    explain.ts
    matrix.ts
    profiles.ts
  core/
    filesystem.ts
    frontmatter.ts
    imports.ts
    paths.ts
    tokens.ts
    trace.ts
    types.ts
  profiles/
    codex.ts
    claude.ts
    gemini.ts
    copilot.ts
    registry.ts
  render/
    json.ts
    matrix.ts
    text.ts
tests/
  fixtures/
    codex/
    claude/
    gemini/
    copilot/
  unit/
  integration/
docs/
  ARCHITECTURE.md
  VALIDATION.md
  PROFILE_SOURCES.md
  demo.svg
examples/
  mixed-agent-repo/
```

## Data flow

1. Resolve `root`, `cwd`, and `target` to canonical absolute paths.
2. Reject inputs that violate the trust boundary or are inconsistent.
3. Load only the selected profile and explicitly provided settings.
4. Inventory candidate files without following directory symlinks.
5. Parse only bounded metadata needed by the profile: frontmatter, supported
   settings keys, and import references.
6. Evaluate client-specific discovery and path matching.
7. Emit a decision for every encountered candidate, including exclusions.
8. Normalize paths and attach the primary source for every behavior rule.
9. Render human-readable output or stable versioned JSON.

No network request occurs in this flow.

## Technology choices

- A supported Node.js LTS release (Node 22 or newer) and TypeScript in strict
  mode.
- `commander` for a predictable CLI contract.
- `minimatch` for documented glob behavior.
- `yaml` for safe, non-executing frontmatter/settings parsing.
- `picocolors` for optional terminal color with no formatting magic.
- Vitest for unit and integration tests.
- ESLint and Prettier for static checks and formatting.
- `tsup` to produce a single CommonJS-compatible executable bundle.
- npm package with a `ruletrace` binary; users can run it with `npx`.

The small dependency set is justified by correctness around YAML and glob
semantics. The runtime remains local and network-free after installation.

## Profile design and maintenance

Profiles implement a shared interface:

```ts
interface ClientProfile {
  metadata: ProfileMetadata;
  trace(input: TraceInput, fs: SafeFileSystem): Promise<TraceResult>;
}
```

Every profile:

- stores official source URLs and a verification date in code;
- maps every decision reason to a source identifier;
- has fixtures derived from documented examples;
- distinguishes guaranteed order from concatenation without guaranteed order;
- never silently guesses a missing user or organization setting.

`docs/PROFILE_SOURCES.md` is generated from the registry so documentation and
runtime metadata cannot drift independently.

## Security model

- Read-only by design; no write operation exists in runtime code.
- No telemetry and no runtime network access.
- User/home files are opt-in through `--include-user`.
- Absolute home paths are redacted by default.
- Directory symlinks are not followed during discovery.
- File symlinks resolving outside the declared root are reported and skipped,
  unless the user explicitly includes user scope and the target is an expected
  user-level file.
- Imports are parsed as references, never executed.
- Import depth, file count, file size, and total bytes are bounded.
- YAML is parsed as data with schema restrictions; custom tags are rejected.
- Settings readers accept only known keys required by a profile.
- Terminal output escapes control characters from filenames and parsed values.
- CI includes dependency audit and secret scanning.

## Failure behavior

| Failure                     | Behavior                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| Target does not exist       | Exit 2 with the resolved path and correction hint.                       |
| Cwd is outside root         | Exit 2; require an explicit consistent root/cwd pair.                    |
| Target is outside root      | Exit 2 unless it is an explicitly supported user-scope source.           |
| No instruction files        | Exit 0 with an empty trace and suggested candidate locations.            |
| Invalid YAML/frontmatter    | Keep tracing other files, mark the file `parse-error`, warn, and exit 1. |
| Damaged settings file       | Do not guess; report the affected profile as indeterminate and exit 1.   |
| Import cycle/depth overflow | Record the stopped edge, emit a warning, and exit 1.                     |
| Symlink escapes root        | Record `skipped-security-boundary`, do not read it, and exit 1.          |
| Unsupported host feature    | Record `unsupported` or `host-dependent`; do not fabricate context.      |
| Unknown client              | Exit 2 and print the supported profile list.                             |
| Unreadable file             | Record the OS error without file contents and exit 1.                    |

Exit codes:

- `0`: complete trace, including an empty valid trace;
- `1`: trace produced with warnings/indeterminate decisions;
- `2`: invalid invocation or inconsistent inputs;
- `3`: unexpected internal failure.

## Test strategy

### Unit tests

- root/cwd/target canonicalization on Windows, macOS, and Linux path forms;
- safe symlink handling and outside-root rejection;
- frontmatter parsing, missing fields, invalid YAML, and control characters;
- glob matching, negation where supported, brace expansion, and path
  normalization;
- import parsing, relative resolution, cycles, and maximum depth;
- byte and approximate-token summaries;
- deterministic JSON serialization and path redaction.

### Profile fixture tests

- Codex global override selection, per-directory override/default/fallback
  selection, root-to-cwd ordering, empty files, and cap truncation.
- Claude ancestor order, local-file order, lazy descendant load, unconditional
  and path-scoped rules, exclusions, imports, and on-demand target behavior.
- Gemini global/workspace/JIT layers, custom filename arrays, imports, and
  duplicate discovery.
- Copilot repository-wide, path-specific `applyTo`, agent instruction
  candidates, multiple applicable rules, and unspecified intra-tier order.

### Integration and end-to-end tests

- Run the published CLI entry point against the mixed-client example.
- Snapshot text output and schema-validate JSON output.
- Build and install `npm pack` output into a clean temporary project.
- Execute every README quickstart command in CI.
- Test Node 22 and Node 24 LTS on Ubuntu, Windows, and macOS.
- Verify `npm audit --omit=dev`, secret scan, lint, typecheck, tests, and build.

### Manual validation

For one fixture per client, compare the trace with the client's native
inspection mechanism where available (`/memory`, instruction logs, or documented
debug output). Differences block release or must be labeled host-dependent.

## Packaging and installation

- Package: `agent-ruletrace` (confirmed unclaimed on npm on 2026-07-29).
- Binary: `ruletrace`.
- Install-free quickstart: `npx agent-ruletrace ...`.
- Optional global install: `npm install --global agent-ruletrace`.
- `npm pack` is the release artifact; the package contains the bundle, license,
  README, and profile-source metadata only.

## Demo

The repository will include:

- a mixed-agent fixture with nested and path-scoped rules;
- a deterministic `docs/demo.svg` showing an `explain` trace;
- a matrix example comparing the same target across four clients;
- copyable text output in the README.

The SVG is generated from actual CLI output after tests pass, so the demo cannot
drift from the executable behavior.

## Publication and release

Target first release: `v0.1.0`.

Before publication:

1. All tests, lint, typecheck, build, clean-install, and secret checks pass.
2. Profile sources and verification dates are generated and reviewed.
3. README covers problem, audience, demo, installation, quickstart, processed
   data, privacy, limitations, and contributing.
4. License, changelog, contributing guide, security policy, code of conduct, CI,
   issue templates, and release notes exist.
5. Repository description and topics are prepared.

Release flow:

1. Create intentional implementation, test, and documentation commits.
2. Publish the public GitHub repository.
3. Confirm CI on `main`.
4. Create annotated tag `v0.1.0`.
5. Create GitHub Release with features, installation, limitations, test matrix,
   and npm tarball checksum.
6. Publish npm only after the GitHub artifact and clean-install check agree.

Suggested topics:

`coding-agents`, `agents-md`, `claude-code`, `gemini-cli`, `github-copilot`,
`codex`, `developer-tools`, `cli`, `context-engineering`, `local-first`.

## Release gates

The project may advance:

- to `BUILDING` after this architecture is committed;
- to `TESTED` only after all automated core/profile fixtures pass;
- to `DOCUMENTED` only after the demo and clean-install README check pass;
- to `PUBLISHED` only after the public repository exists and CI is green;
- to `RELEASING` only after the public repository exists and CI is green;
- to `CLOSED` only after the real `v0.1.0` GitHub Release is available.
