# Computer Linker

Computer Linker is a local MCP server that lets an AI client work with one
approved folder on your computer.

It is CLI-first. You install it, start it in a folder, then connect an MCP
client. The server runs on your own machine; tunnels are optional and only
needed for cloud clients.

## Quick Start

### 1. Install

Computer Linker requires Node.js 20.12 or newer.

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
```

`check` starts a temporary local server and removes the temporary files after
the test. It does not expose your real projects.

### 2. Start One Folder

Run this inside the folder you want the MCP client to access:

```powershell
cd C:\Projects\my-app
computer-linker here
```

Or pass the folder path from anywhere:

```powershell
computer-linker start C:\Projects\my-app
```

Leave that terminal running. In another terminal, run client setup or
diagnosis commands.

`here` and `start <folder>` automatically create the local config, owner token,
workspace entry, and default coding policy when needed. The workspace name
defaults to the folder name, so you usually do not need `--name`.

The local MCP URL is:

```text
http://127.0.0.1:3939/mcp
```

### 3. Connect Your MCP Client

Open another terminal:

```powershell
computer-linker client setup
computer-linker diagnose client
```

If the client needs a bearer token, print it only on a trusted local screen:

```powershell
computer-linker client setup --show-token
```

Use these local client settings:

| Setting | Value |
| --- | --- |
| MCP URL | `http://127.0.0.1:3939/mcp` |
| Auth header | `Authorization: Bearer <ownerToken>` |
| Agent prompt | [docs/agent-instructions.md](docs/agent-instructions.md) |

## Common Commands

| Task | Command |
| --- | --- |
| Start the current folder | `computer-linker here` |
| Start another folder | `computer-linker start C:\Projects\my-app` |
| Start read-only | `computer-linker here --read-only` |
| Start with Codex and screenshots | `computer-linker here --full-trust` |
| Show connection settings | `computer-linker client setup` |
| Run client diagnostics | `computer-linker diagnose client` |
| Show server status | `computer-linker status` |
| Show detailed status | `computer-linker status --details` |
| Show tunnel state | `computer-linker tunnel status` |
| Show recent connections | `computer-linker history --view connections` |
| Rotate the owner token | `computer-linker config token rotate --show-token` |

## Permission Modes

Normal coding is the default for `here` and `start <folder>`.

| Mode | Command | Allows |
| --- | --- | --- |
| Normal coding | `computer-linker here` | File read/write and approved project commands. |
| Read-only | `computer-linker here --read-only` | Inspect files, search, and review Git state. |
| Full trust | `computer-linker here --full-trust` | Normal coding plus Codex operations and screen capture. |

Use read-only for review. Use full trust only for folders where Codex and
screen capture are intended.

## Cloud Clients

Cloud MCP clients cannot reach `127.0.0.1`. Add a tunnel only when you need a
cloud client to reach your local server.

### OpenAI Secure MCP Tunnel

This mode uses a `tunnel_...` id instead of a public URL.

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

In ChatGPT or another OpenAI tunnel-aware client, choose Tunnel mode and select
or paste the `tunnel_...` id. Do not paste the Computer Linker bearer token
into OpenAI Tunnel mode; the local tunnel client forwards it to the private
loopback MCP server.

On first use, Computer Linker downloads the official OpenAI `tunnel-client`
from `openai/tunnel-client`, verifies it against `SHA256SUMS.txt`, and stores
it under `~/.computer-linker/tools/openai-tunnel-client/`. The cached managed
binary is reused until you explicitly refresh it:

```powershell
computer-linker tunnel openai-client status
computer-linker tunnel openai-client install --refresh
```

If first-use download is unavailable, use your own pinned binary by setting
`COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT` or passing `--tunnel-client`.

If you see:

```text
401 Access denied: this tunnel requires an active organization context.
```

check the API key's Platform organization, Tunnels Read + Use permission, and
the ChatGPT workspace or organization that owns the tunnel.

### Tailscale Funnel

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

Computer Linker detects the Funnel URL and prints the public MCP URL. Plain
Tailscale DNS or Serve is tailnet-only; Funnel is the public mode.

### Cloudflare Tunnel

Quick tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Your own Cloudflare hostname:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Public tunnel mode exposes only `/mcp` to public-host requests. Local `/api`
and `/healthz` remain loopback diagnostics.

## What Agents Should Do

The recommended MCP surface has three tools:

| Tool | Purpose |
| --- | --- |
| `get_computer_info` | Inspect scopes, permissions, URLs, status, and available operations. |
| `computer_operation` | Run one scoped operation through `{ scope, op, target, input, options }`. |
| `get_operation_history` | Inspect redacted recent activity and connection history. |

Paste this into the connected agent when needed:

```text
You are connected to Computer Linker, a local MCP server for this computer.
First call get_computer_info to inspect available scopes, permissions, and safety boundaries.
Call computer_operation with dotted ops from computerOperationRegistry and the stable envelope {scope, op, target, input, options}.
Stay inside configured scopes. Prefer code.context, file.search, file.read, git.diff, and get_operation_history before write.
Use write, shell, command, or codex operations only when the reported permissions allow them.
Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools.
If tunnel or connection behavior is unclear, inspect get_operation_history before changing anything.
```

Example read-only operation:

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

Example package script operation:

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

## Config And Safety

Config lives at:

```text
~/.computer-linker/config.json
```

You usually do not need to edit it by hand. Use the CLI:

```powershell
computer-linker workspace list
computer-linker config validate
computer-linker config policy <workspace-id> --json
computer-linker config token rotate --show-token
```

Safety defaults:

- The owner token is redacted unless you pass `--show-token`.
- Public tunnel mode exposes only `/mcp` on public-host requests.
- Sensitive file content is blocked by default. Direct reads and searches
  block common secret files such as `.env*`, private keys, credential JSON
  files, and cloud CLI credential directories.
- Metadata operations hide sensitive path names by default.
- Write operations block sensitive path mutation by default.
- Shell and Codex operations run as normal local host processes inside the
  configured scope. Use OS, container, firewall, proxy, or network controls
  when network isolation matters.

## Develop From Source

```powershell
git clone https://github.com/easonwumac/computer-linker.git
cd computer-linker
npm install
npm run dev -- check
npm run dev -- start C:\Projects\my-app
```

Before pushing code changes:

```powershell
npm run product:check
npm run public:audit -- --strict-history
```

GitHub Actions intentionally runs the main CI gate on Windows with Node 22 to
keep public CI usage small. It runs on pushes to `main`
and pull requests targeting `main`; broader coverage is manual.

## More Documentation

- [Documentation Map](docs/README.md): all product and development docs.
- [Learning Paths](docs/learning-paths.md): choose the right path for your use case.
- [Getting Started](docs/getting-started.md): shortest first setup.
- [Usage Guide](docs/usage-guide.md): daily operation and troubleshooting.
- [CLI Reference](docs/cli-reference.md): compact command lookup.
- [Agent Instructions](docs/agent-instructions.md): prompt for MCP agents.
- [Agent Playbook](docs/agent-playbook.md): operation recipes for agents.
- [Client Recipes](docs/client-recipes.md): local, tunnel, and minimal client examples.
- [SDK Quickstart](docs/sdk-quickstart.md): short TypeScript/JavaScript integration.
- [Command Policy](docs/command-policy.md): command execution safety.
- [Configuration](docs/configuration.md): config file and schema details.
- [Config Schema](docs/config.schema.json): published config JSON Schema.
- [API Compatibility](docs/api-compatibility.md): public MCP compatibility policy.
- [Architecture](docs/architecture.md): module boundaries.
- [Developer Guide](docs/developer-guide.md): development workflow.
- [Release Checklist](docs/release-checklist.md): release and npm publishing rules.
- [Security](SECURITY.md): security model and reporting.
