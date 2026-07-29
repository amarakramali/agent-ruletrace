# Changelog

All notable changes to Agent RuleTrace are documented here. The project follows
[Semantic Versioning](https://semver.org/) and the structure of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-07-29

### Added

- Source-linked instruction tracing for OpenAI Codex, Anthropic Claude Code,
  Google Gemini CLI, and GitHub Copilot CLI.
- Human-readable and versioned JSON explanations for one client and target.
- Four-profile matrix with loaded paths, byte totals, token approximations, and
  aggregate warnings.
- Safe root/CWD/target boundaries, symlink escape prevention, YAML parsing, glob
  evaluation, import cycle/depth handling, and opt-in user scope.
- Mixed-agent example and reproducible SVG terminal demo.
- Unit/profile fixtures and a real npm-tarball clean-install test with blocked
  runtime networking and verified exit codes 0/1/2.
- Cross-platform CI for Node 22 and Node 24 LTS.

[Unreleased]:
  https://github.com/amarakramali/agent-ruletrace/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/amarakramali/agent-ruletrace/releases/tag/v0.1.0
