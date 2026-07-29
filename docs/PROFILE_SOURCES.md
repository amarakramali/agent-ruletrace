# Profile sources

> Generated from the runtime profile registry by `npm run docs:profiles`. Do not
> edit source metadata here.

Registry schema: 1 / Tool version: 0.1.0

| Profile               | ID        | Status      | Verified   |
| --------------------- | --------- | ----------- | ---------- |
| OpenAI Codex          | `codex`   | implemented | 2026-07-29 |
| Anthropic Claude Code | `claude`  | implemented | 2026-07-29 |
| Google Gemini CLI     | `gemini`  | implemented | 2026-07-29 |
| GitHub Copilot CLI    | `copilot` | implemented | 2026-07-29 |

## OpenAI Codex

- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md) -
  `codex-agents-md`
- [Codex AGENTS.md discovery implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs) -
  `codex-source`
- [Agent RuleTrace read boundary](https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model) -
  `ruletrace-security`

## Anthropic Claude Code

- [How Claude remembers your project](https://code.claude.com/docs/en/memory) -
  `claude-memory`
- [Agent RuleTrace read boundary](https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model) -
  `ruletrace-security`

## Google Gemini CLI

- [Provide context with GEMINI.md files](https://geminicli.com/docs/cli/gemini-md/) -
  `gemini-context`
- [Gemini CLI memory discovery implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/memoryDiscovery.ts) -
  `gemini-memory-source`
- [Memory Import Processor](https://geminicli.com/docs/reference/memport/) -
  `gemini-imports`
- [Agent RuleTrace read boundary](https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model) -
  `ruletrace-security`

## GitHub Copilot CLI

- [Adding custom instructions for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) -
  `copilot-cli-instructions`
- [Support for different types of custom instructions](https://docs.github.com/en/copilot/reference/custom-instructions-support) -
  `copilot-instruction-support`
- [Agent RuleTrace read boundary](https://github.com/amarakramali/agent-ruletrace/blob/main/docs/ARCHITECTURE.md#security-model) -
  `ruletrace-security`
