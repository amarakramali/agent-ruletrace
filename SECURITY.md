# Security policy

Agent RuleTrace reads instruction and configuration files, so boundary and
privacy defects are treated seriously.

## Supported versions

| Version                | Supported |
| ---------------------- | --------- |
| Latest `0.1.x` release | Yes       |
| Older releases         | No        |
| Unreleased forks       | No        |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's
[private vulnerability reporting](https://github.com/amarakramali/agent-ruletrace/security/advisories/new)
and include:

- affected version and platform;
- minimal reproduction with synthetic files;
- expected and observed trust boundary;
- whether file content, paths, or credentials could be exposed;
- any known workaround.

Remove real credentials and private instruction text. Acknowledgement is
targeted within five business days. Valid reports will receive a severity
assessment, remediation plan, and coordinated disclosure timeline.

## Security design

- Runtime operation is read-only and local.
- User-scope files are opt-in.
- Directory symlinks are not followed.
- File symlinks and imports escaping an allowed root are blocked.
- YAML is parsed as data without custom tags.
- Repository code and imported instruction references are never executed.
- Runtime networking and telemetry are absent.

See the full [security model](docs/ARCHITECTURE.md#security-model).
