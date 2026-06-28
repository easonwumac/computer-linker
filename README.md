# Computer Linker

Computer Linker lets an MCP client work inside one folder on your computer.

The normal path is three commands:

```powershell
npm install -g @easonwumac/computer-linker
cd C:\Projects\my-app
computer-linker here
```

That starts a local MCP server. Computer Linker creates the config, owner
token, workspace entry, folder name, and default coding policy for you.

## Quick Start

### 1. Install

Computer Linker requires Node.js 20.12 or newer.

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
```

`check` uses a temporary folder and does not expose your projects.

### 2. Open One Folder

Run this inside the folder you want to expose:

```powershell
cd C:\Projects\my-app
computer-linker here
```

Or point to a folder from anywhere:

```powershell
computer-linker start C:\Projects\my-app
```

Leave that terminal running. In another terminal, run client setup or
diagnosis commands.

By default, the workspace name is the folder name. Normal mode allows file
edits plus approved project commands such as test/build scripts.

### 3. Connect Your MCP Client

Use this MCP URL for local clients:

```text
http://127.0.0.1:3939/mcp
```

If your client asks for an auth header, print the setup values on a trusted
local screen:

```powershell
computer-linker client setup --show-token
```

The auth header format is:

```text
Authorization: Bearer <ownerToken>
```

To verify the connection path:

```powershell
computer-linker diagnose client
```

## Most Useful Commands

| Need | Command |
| --- | --- |
| Start current folder | `computer-linker here` |
| Start another folder | `computer-linker start C:\Projects\my-app` |
| Read-only access | `computer-linker here --read-only` |
| Full local trust | `computer-linker here --full-trust` |
| Show MCP client settings | `computer-linker client setup --show-token` |
| Check status | `computer-linker status` |
| Diagnose client setup | `computer-linker diagnose client` |
| See recent connections | `computer-linker history --view connections` |
| See tunnel status | `computer-linker tunnel status` |

Use `--read-only` when the agent should inspect but not edit. Use
`--full-trust` only when you intentionally want Codex operations and screen
capture for that folder.

## Cloud MCP Clients

Cloud clients cannot reach `127.0.0.1`, so start with a tunnel only when you
need cloud access.

### OpenAI Secure MCP Tunnel

Use this when your MCP client supports OpenAI tunnel mode:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

This mode does not print a public URL. In the client, choose Tunnel mode and
use the `tunnel_...` id. Do not paste the Computer Linker bearer token into
OpenAI Tunnel mode.

Computer Linker downloads and verifies the official OpenAI `tunnel-client`
automatically when needed.

### Tailscale Funnel

Use this when you want a public HTTPS URL from Tailscale:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

### Cloudflare

Quick temporary URL:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Hostname you own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Public tunnel mode exposes only `/mcp` to public-host requests. Local `/api`
and `/healthz` stay local diagnostics.

## What The Agent Should Do

Tell the MCP agent to start with:

```text
First call get_computer_info. Then use computer_operation with {scope, op, target, input, options}. Stay inside the configured scope. Prefer code.context, file.search, file.read, git.diff, and get_operation_history before making changes.
Call computer_operation with dotted ops from computerOperationRegistry.
Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools.
```

The main MCP tools are:

| Tool | Purpose |
| --- | --- |
| `get_computer_info` | Inspect scopes, permissions, URLs, policy, and available operations. |
| `computer_operation` | Run one operation inside an approved scope. |
| `get_operation_history` | Read redacted recent activity and connection history. |

For the full prompt, use [docs/agent-instructions.md](docs/agent-instructions.md).

## Safety Defaults

- One command exposes one folder.
- Tokens are redacted unless you pass `--show-token`.
- Sensitive file content is blocked by default, including `.env*`, private
  keys, credential JSON files, and cloud CLI credentials.
- Public tunnel mode exposes MCP only, not the local diagnostic API.
- Package release scripts such as `deploy`, `publish`, and `release` are
  denied by default in normal coding scopes.
- Shell, package, process, and Codex operations run as local host processes.
  Use OS, container, firewall, proxy, or network controls when network
  isolation matters.

## Develop From Source

```powershell
git clone https://github.com/easonwumac/computer-linker.git
cd computer-linker
npm install
npm run dev -- check
npm run dev -- here
```

Before pushing code changes:

```powershell
npm run product:check
npm run public:audit -- --strict-history
```

GitHub Actions intentionally runs the main CI gate on Windows with Node 22 to
keep public CI usage small. It runs on pushes to `main`
and pull requests targeting `main`.

## More Documentation

- [Documentation Map](docs/README.md)
- [Learning Paths](docs/learning-paths.md)
- [Getting Started](docs/getting-started.md)
- [Usage Guide](docs/usage-guide.md)
- [CLI Reference](docs/cli-reference.md)
- [Client Recipes](docs/client-recipes.md)
- [Agent Instructions](docs/agent-instructions.md)
- [Agent Playbook](docs/agent-playbook.md)
- [SDK Quickstart](docs/sdk-quickstart.md)
- [Command Policy](docs/command-policy.md)
- [Configuration](docs/configuration.md)
- [Config Schema](docs/config.schema.json)
- [API Compatibility](docs/api-compatibility.md)
- [Architecture](docs/architecture.md)
- [Developer Guide](docs/developer-guide.md)
- [Release Checklist](docs/release-checklist.md)
- [Security](SECURITY.md)
