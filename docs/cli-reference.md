# CLI Quick Reference

Use this page when you already understand the product and need the shortest
copyable command path. For a guided tutorial, start with
[Getting Started](getting-started.md).

## Install Check

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
```

`check` uses a temporary config and workspace. It does not expose your real
folders.

## Start One Folder

Current folder:

```powershell
cd C:\Projects\my-app
computer-linker here
```

Explicit folder:

```powershell
computer-linker start C:\Projects\my-app
```

Leave that terminal running. In another terminal, inspect the client setup:

```powershell
computer-linker client setup
computer-linker diagnose client --local
```

## Permission Modes

| Need | Command |
| --- | --- |
| Inspect only | `computer-linker here --read-only` |
| Normal coding | `computer-linker here` |
| Codex plus screen capture | `computer-linker here --full-trust` |

The workspace name defaults to the folder name. Use `--read-only` for review
sessions and `--full-trust` only for folders where local agent execution and
screen capture are intended.

## Tunnel Modes

OpenAI Secure MCP Tunnel:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

Tailscale Funnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

Cloudflare quick tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Cloudflare hostname:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Public tunnel modes expose `/mcp` only to public-host requests. Local `/api`
and `/healthz` remain loopback diagnostics.

## Daily Checks

```powershell
computer-linker status
computer-linker status --details
computer-linker workspace list
computer-linker history --view last
computer-linker history --view connections
computer-linker tunnel status
```

Use `status` for the short human view. Use `status --details` when a tunnel,
workspace, or readiness warning needs inspection.

## Token Maintenance

```powershell
computer-linker client setup --show-token
computer-linker config token rotate
computer-linker config token rotate --show-token
```

Show raw tokens only on a trusted local screen.

## Command Policy

```powershell
computer-linker config policy <workspace-id> --json
computer-linker config policy <workspace-id> --allow "npm *" --allow "git *" --max-runtime-seconds 600 --max-output-bytes 200000
computer-linker config policy <workspace-id> --block-shell-metacharacters
```

Shell metacharacters and command chaining are blocked by default. Use
[Command Policy](command-policy.md) before enabling advanced shell syntax.

## Advanced Commands

```powershell
computer-linker help advanced
computer-linker serve --transport http
computer-linker config validate
computer-linker doctor --fix --dry-run
computer-linker doctor --fix
```

For normal use, prefer `here` or `start <folder>`. `serve`, low-level config,
and compatibility commands are for diagnostics and automation.
