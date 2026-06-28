# Usage Guide

This guide is the practical daily path for running Computer Linker after it is
installed. Use [Getting Started](getting-started.md) for the shortest first
setup and [CLI Reference](cli-reference.md) for compact command lookup.

## Daily Startup

Start in the folder you want to expose:

```powershell
cd C:\Projects\my-app
computer-linker here
```

macOS/Linux:

```bash
cd ~/projects/my-app
computer-linker here
```

Leave that terminal running. Computer Linker creates the local config, owner
token, workspace entry, and default command policy if they do not already
exist. The workspace name defaults to the folder name.

From another directory, pass the folder explicitly:

```powershell
computer-linker start C:\Projects\my-app
```

## Permission Modes

| Mode | Command | Use when |
| --- | --- | --- |
| Normal coding | `computer-linker here` | The client can edit files and run approved project commands. |
| Read-only | `computer-linker here --read-only` | The client should inspect without writing or running commands. |
| Full trust | `computer-linker here --full-trust` | Codex operations and screen capture are intended for this folder. |

Normal coding mode is the default for `here`, `start <folder>`, and
`setup <folder>`. It is intended to be useful without asking the user to choose
many flags.

## MCP Client Setup

In another terminal:

```powershell
computer-linker client setup
computer-linker diagnose client
```

If the MCP client needs a bearer header, print it only on a trusted local
screen:

```powershell
computer-linker client setup --show-token
```

Default local settings:

- MCP URL: `http://127.0.0.1:3939/mcp`
- Auth header: `Authorization: Bearer <ownerToken>`
- Agent instructions: [agent-instructions.md](agent-instructions.md)

## Cloud Access

Cloud MCP clients cannot reach `127.0.0.1`. Use a tunnel only when cloud access
is required.

OpenAI Secure MCP Tunnel:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

The managed OpenAI `tunnel-client` is downloaded once, verified, and reused
from the Computer Linker config directory. It is not updated implicitly on
every start:

```powershell
computer-linker tunnel openai-client status
computer-linker tunnel openai-client install --refresh
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

With a Cloudflare hostname you own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Public tunnel mode exposes only `/mcp` to public-host requests. Local `/api`
and `/healthz` stay loopback diagnostics.

## Agent Flow

Agents should use the generic three-tool MCP flow:

1. Call `get_computer_info`.
2. Choose one returned scope.
3. Call `computer_operation` with `{ scope, op, target, input, options }`.
4. Call `get_operation_history` when debugging recent activity.

Example file tree request:

```json
{
  "scope": "my-app",
  "op": "file.tree",
  "target": ".",
  "input": {},
  "options": {
    "maxDepth": 2,
    "maxEntries": 80
  }
}
```

Example package script request:

```json
{
  "scope": "my-app",
  "op": "package.run",
  "target": ".",
  "input": {
    "script": "test"
  },
  "options": {
    "timeoutSeconds": 600
  }
}
```

Prefer `package.run`, Git operations, file operations, and search operations
before raw `command.run`. They are easier to constrain and easier for agents to
explain.

## Daily Checks

```powershell
computer-linker status
computer-linker workspace list
computer-linker history --view last
computer-linker history --view connections
computer-linker tunnel status
```

Use detailed status only when investigating a warning:

```powershell
computer-linker status --details
```

## Troubleshooting

If a client cannot connect:

```powershell
computer-linker diagnose client
computer-linker tunnel status
computer-linker history --view connections
```

If a command is denied:

```powershell
computer-linker workspace list
computer-linker config policy <workspace-id> --json
```

For command policy details, including default shell metacharacter blocking, see
[Command Policy](command-policy.md).
