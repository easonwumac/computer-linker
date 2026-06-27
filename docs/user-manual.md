# User Manual

This manual covers the daily Computer Linker workflow: install, expose one
folder, connect an MCP client, choose permissions, inspect history, and stop
the server.

For the shortest path, use [Getting Started](getting-started.md). For agents,
use [Agent Instructions](agent-instructions.md).

## Core Idea

Computer Linker runs on your computer and exposes selected folders as
permissioned MCP scopes. A client must first inspect the computer, choose a
scope, then call one operation at a time.

```text
MCP client
  -> get_computer_info
  -> computer_operation { scope, op, target, input, options }
  -> get_operation_history
```

The CLI is the human interface. MCP and the JSON API are protocol surfaces for
clients and smoke checks.

## Install And Check

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
```

`check` creates a temporary config and workspace, starts a loopback server,
verifies MCP and JSON health, then removes the temporary files.

## Expose One Folder

Open a terminal in the folder you want to expose:

```powershell
cd C:\Projects\my-app
computer-linker here
```

Or pass the folder explicitly:

```powershell
computer-linker start C:\Projects\my-app
```

Both commands:

- create config and owner token when missing
- add or update the folder as a workspace scope
- use the folder name as the default scope name
- start the MCP server at `http://127.0.0.1:3939/mcp`
- run startup checks

Keep this terminal running while the MCP client is connected.

## Choose Permissions

Use the least capability that fits the session.

| Mode | Command | Allows |
| --- | --- | --- |
| Read-only | `computer-linker here --read-only` | inspect files, search, git status/diff/log/show |
| Coding | `computer-linker here` | read/write files plus approved package and command policy |
| Full trust | `computer-linker here --full-trust` | coding plus Codex workflows and screen capture |

For normal product work, start with the default coding mode. Use full trust only
for folders where local agent execution and screen capture are intended.

## Connect A Local MCP Client

In another terminal:

```powershell
computer-linker client setup
computer-linker diagnose client --local
```

Typical local client settings:

- URL: `http://127.0.0.1:3939/mcp`
- Auth: bearer token shown by `computer-linker client setup --show-token`
- Agent prompt: [agent-instructions.md](agent-instructions.md)

Use `--show-token` only on a trusted local screen.

## Connect A Cloud MCP Client

Cloud clients cannot reach `127.0.0.1`, so use a tunnel only when needed.

OpenAI Secure MCP Tunnel:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

This mode does not create a public URL. In the client, choose Tunnel mode and
select or paste the `tunnel_...` id. Do not paste the Computer Linker bearer
token into OpenAI Tunnel mode; the local tunnel client forwards it to the
loopback MCP server.

Tailscale Funnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

Computer Linker detects the Funnel HTTPS origin and prints the MCP URL. Plain
Tailscale DNS or Tailscale Serve is tailnet-only; Funnel is the public mode.

Cloudflare:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

With a hostname you own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Public tunnel mode exposes only `/mcp` to public-host requests. Local `/api`
and `/healthz` remain loopback diagnostics.

## Daily CLI Commands

| Task | Command |
| --- | --- |
| Start current folder | `computer-linker here` |
| Start explicit folder | `computer-linker start C:\Projects\my-app` |
| Show status | `computer-linker status` |
| Show detailed status | `computer-linker status --details` |
| List scopes | `computer-linker workspace list` |
| Show client setup | `computer-linker client setup` |
| Run client diagnostics | `computer-linker diagnose client` |
| Inspect tunnel state | `computer-linker tunnel status` |
| Inspect recent history | `computer-linker history --view last` |
| Inspect connections | `computer-linker history --view connections` |
| Rotate owner token | `computer-linker config token rotate` |
| Advanced help | `computer-linker help advanced` |

## Agent Operation Flow

Agents should use the three-tool MCP surface:

1. Call `get_computer_info`.
2. Choose a returned `scope`.
3. Call `computer_operation` with `{ scope, op, target, input, options }`.
4. Call `get_operation_history` when debugging recent activity.

Example operation:

```json
{
  "scope": "my-app",
  "op": "file.search",
  "target": ".",
  "input": {
    "query": "TODO"
  },
  "options": {
    "maxResults": 20
  }
}
```

Prefer read-only context, search, and git inspection before write, command, or
Codex operations.

## Safety Boundaries

- Path-based file, search, patch, and direct Git operations stay inside the
  configured scope.
- Sensitive direct reads and text searches are blocked by default for common
  secret files such as `.env*`, private keys, credential JSON files, and cloud
  CLI credential folders.
- Git diff/show/status output redacts sensitive diff blocks before returning
  content to clients.
- Delete and move operations refuse to target the scope root itself.
- Shell, package, managed process, and Codex operations start inside the scope
  but are not OS-level sandboxes.
- Shell metacharacters and command chaining are blocked by default by command
  policy, so broad patterns such as `npm *` and `git *` do not permit
  `npm test && ...` or `git status; ...`.
- Public HTTP exposure should always use an owner token plus a tunnel or
  network access-control layer.

## Troubleshooting

Run these first:

```powershell
computer-linker status --details
computer-linker diagnose client
computer-linker history --view connections
```

If a command is denied, inspect the scope and policy:

```powershell
computer-linker workspace list
computer-linker config policy <workspace-id> --json
```

For command policy tuning, see [Command Policy](command-policy.md).

If OpenAI tunnel mode returns an organization-context 401, check the API key's
Platform organization, Tunnels Read + Use permission, and ChatGPT workspace
association.

Shell, package, process, and Codex operations run as host processes. Computer
Linker checks scope, command policy, runtime, and output bounds, but it does
not block host network access; use OS, container, firewall, proxy, or network
controls when network isolation matters.

For low-level server diagnostics:

```powershell
computer-linker help advanced
computer-linker serve --transport http
```

For normal use, prefer `computer-linker here` or
`computer-linker start <workspace-path>`.
