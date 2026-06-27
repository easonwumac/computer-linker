# Contributing

Workspace Linker is pre-1.0 local-first MCP software. It can expose local
files, command execution, Codex runs, screenshots, and audit metadata through a
configured MCP server, so changes should be reviewed with security boundaries
in mind.

## Before Opening An Issue

- Search existing issues first.
- Do not paste owner tokens, OAuth tokens, API keys, tunnel IDs, private
  hostnames, full config files, command output with secrets, or private file
  contents.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
  opening a detailed public issue.

Useful issue context:

- Workspace Linker version or commit.
- Node version and operating system.
- Command you ran and the redacted output.
- Whether the server was loopback-only, Tailscale Funnel, Cloudflare, OpenAI
  Secure MCP Tunnel, or another reverse proxy.
- The relevant workspace permission mode: read-only, write, shell, Codex, or
  full.

## Development

From a checkout:

```bash
npm ci
npm run product:check
```

For public-release readiness:

```bash
npm run public:check
```

Use the narrower checks while iterating:

```bash
npm run typecheck
npm test
npm run build
npm run pack:smoke
npm run public:audit
```

`npm test` uses `scripts/run-tests.mjs`, which prints one line per test file so
long Windows runs do not look stuck. For focused iteration, pass a label or
path fragment:

```bash
node scripts/run-tests.mjs cli
node scripts/run-tests.mjs --list
```

## Pull Requests

- Keep changes scoped to one product behavior or release concern.
- Update docs when CLI behavior, MCP/API contracts, release gates, security
  posture, or setup flow changes.
- Include tests for behavior changes when the change can be exercised
  deterministically.
- Run `npm run release:validate` and the narrow relevant checks before opening
  the PR.
- Explain any security impact, especially changes involving command execution,
  tunnel exposure, auth, logging, file writes, or Codex operations.

## Release Changes

Do not publish from an ad-hoc state. The publish lifecycle is guarded by
`prepublishOnly`, which runs `npm run publish:guard`. That guard requires a
clean worktree, a matching `v<package.version>` tag on `HEAD`, a dated
changelog heading, and `npm run public:check`.
