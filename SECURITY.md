# Security Policy

Computer Linker is local-first software that exposes a user's computer to an
MCP client. Treat every configured scope as a trust boundary.

## Supported Versions

Computer Linker is currently pre-1.0. Security fixes are targeted at the
latest published version only until a stable release line exists.

## Reporting A Vulnerability

Please report vulnerabilities through GitHub Security Advisories on the
repository. If advisories are unavailable, open a minimal issue that does not
include exploit details and request a private disclosure path.

Include:

- affected version or commit
- operating system and Node version
- whether the server was loopback-only or exposed through a tunnel
- configured workspace permissions relevant to the issue
- concise reproduction steps

## Security Model

- Read, write, search, patch, and direct Git operations resolve paths inside the
  configured workspace before touching the filesystem.
- Shell, package script, managed process, and Codex operations start with the
  workspace as the current directory, but they are not OS filesystem sandboxes.
- Do not enable `shell` or `codex` on folders you do not trust.
- Use workspace `policy.allowedCommands`, `policy.deniedCommands`,
  `policy.maxRuntimeSeconds`, and `policy.maxOutputBytes` for shell-enabled
  scopes.
- Do not expose HTTP mode outside loopback without an owner token and an
  appropriate tunnel or network access-control layer.
- Tokens, file contents, write payloads, and screenshot image bytes are not
  intentionally written to the audit log, but command output can contain
  sensitive data if a command prints it.
- Screenshot capture history is not directly replayable; request a fresh
  explicit capture instead.

Before sharing a build outside local dogfooding, run:

```bash
npm run public:check
node dist/cli.js config validate
```
