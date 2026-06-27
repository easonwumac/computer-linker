# Getting Started

This tutorial starts one local Computer Linker server, exposes one folder, and
connects an MCP client.

## 1. Install

Computer Linker requires Node.js 20.12 or newer.

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
```

`check` uses a temporary config and temporary workspace. It is safe to run
before exposing real folders.

## 2. Start In A Project Folder

Open a terminal in the folder you want the client to access.

Windows PowerShell:

```powershell
cd C:\Projects\my-app
computer-linker here
```

macOS/Linux shell:

```bash
cd ~/projects/my-app
computer-linker here
```

Leave that terminal running. The command creates config, owner token, workspace
entry, and a default coding policy if they do not already exist. The workspace
name defaults to the folder name.

From another folder, use the explicit path form:

```powershell
computer-linker start C:\Projects\my-app
```

```bash
computer-linker start ~/projects/my-app
```

Use read-only mode when the client should inspect without editing:

```powershell
computer-linker here --read-only
```

Use full trust only for folders where Codex operations and screen capture are
intended:

```powershell
computer-linker here --full-trust
```

## 3. Configure A Local MCP Client

In a second terminal:

```powershell
computer-linker client setup
```

For local clients that need the bearer token, show it only on a trusted local
screen:

```powershell
computer-linker client setup --show-token
```

Typical local settings:

- URL: `http://127.0.0.1:3939/mcp`
- Auth header: `Authorization: Bearer <ownerToken>`
- Agent instructions: [agent-instructions.md](agent-instructions.md)

Verify the client path:

```powershell
computer-linker diagnose client --local
```

## 4. Expose To A Cloud MCP Client

Cloud MCP clients cannot reach `127.0.0.1`. Start with a tunnel only when you
need cloud access.

OpenAI Secure MCP Tunnel:

Windows PowerShell:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

macOS/Linux shell:

```bash
export CONTROL_PLANE_API_KEY="sk-..."
cd ~/projects/my-app
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

Computer Linker detects the Funnel HTTPS origin, saves it as `publicBaseUrl`,
and prints the MCP URL.

Cloudflare quick tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Cloudflare hostname you own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

After starting a public tunnel, inspect the exposed state:

```powershell
computer-linker tunnel status
computer-linker history --view connections
computer-linker client setup
```

Public tunnel mode exposes only `/mcp` to public-host requests. Local `/api`
and `/healthz` remain available for local diagnostics.

## 5. What Agents Should Call

The main MCP tools are:

- `get_computer_info`: inspect computer identity, scopes, policy, URLs, and
  available operations.
- `computer_operation`: run one operation using the generic envelope
  `{ "scope": "...", "op": "...", "target": "...", "input": {}, "options": {} }`.
- `get_operation_history`: inspect redacted recent activity.

Use [agent-instructions.md](agent-instructions.md) as the client prompt. It
keeps agents on the generic `computer_operation` contract instead of older
compatibility tools.

## 6. Daily Commands

```powershell
computer-linker status
computer-linker status --details
computer-linker workspace list
computer-linker history --view last
computer-linker config token
computer-linker help advanced
```

`status` is the short human check. Use `--details` only when investigating a
warning.

## Troubleshooting

If a client cannot connect:

```powershell
computer-linker diagnose client
computer-linker tunnel status
computer-linker history --view connections
```

If the terminal shows an OpenAI tunnel organization 401, verify the API key's
Platform organization, Tunnels Read + Use permission, and client workspace
association before changing Computer Linker config.

If a command is denied, inspect the workspace policy:

```powershell
computer-linker workspace list
computer-linker config policy <workspace-id> --json
```

Shell, package, process, and Codex operations run as host processes. Computer
Linker checks scope, command policy, runtime, and output bounds, but it does
not block host network access; use OS, container, firewall, proxy, or network
controls when network isolation matters.

If you need the low-level server mode, use:

```powershell
computer-linker help advanced
computer-linker serve --transport http
```

For normal use, prefer `computer-linker here` or
`computer-linker start <workspace-path>`.

## Next Documents

- [Client recipes](client-recipes.md) for MCP client setup variants.
- [User manual](user-manual.md) for daily commands, permission choices, tunnel
  setup, safety boundaries, and troubleshooting.
- [Agent instructions](agent-instructions.md) for pasteable client guidance.
- [Service mode](service-mode.md) for installed background services.
- [Developer guide](developer-guide.md) for module boundaries and extension
  workflow.
