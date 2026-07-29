# Contributing to Agent RuleTrace

Thanks for helping make instruction discovery easier to understand.

## Before opening a change

Agent RuleTrace intentionally models only behavior that can be supported by
primary sources and deterministic fixtures. For a profile change:

1. Link the current official specification or source implementation.
2. Explain the concrete user problem.
3. Keep documented behavior separate from host-dependent inference.
4. Prefer the smallest change that makes the trace more accurate.

Please open a feature request before adding a new client profile or changing the
JSON contract.

## Development setup

Use Node 22 or Node 24 LTS:

```bash
git clone https://github.com/amarakramali/agent-ruletrace.git
cd agent-ruletrace
npm ci
npm run check
```

Useful commands:

```bash
npm test
npm run lint
npm run format:check
npm run typecheck
npm run demo
npm run docs:profiles
npm run test:package
```

## Tests

- Add a focused fixture for every discovery, matching, precedence, parsing, or
  security behavior.
- Cover both the applicable path and the nearest meaningful failure case.
- Do not weaken a security boundary to reproduce a host-specific behavior.
- Run `npm run check` before submitting a pull request.

The package test builds an npm tarball, installs it into a temporary consumer,
blocks runtime network APIs, and invokes the packaged CLI. Keep it independent
of unshipped source files.

## Generated files

Do not hand-edit:

- `docs/PROFILE_SOURCES.md` — run `npm run docs:profiles`.
- `docs/demo.svg` — run `npm run demo`.

Commit generated output together with the source change that caused it.

## Commit and pull-request scope

Use focused commits with imperative messages, for example:

```text
feat: trace nested client instructions
test: cover imported rule cycles
docs: clarify Copilot CLI scope
```

Pull requests should contain the problem, source evidence, verification, and any
new limitation. Never include real private instructions, credentials, or local
identifying paths.
