# Computer Linker

Computer Linker exposes one folder on your computer as a local MCP server.

It is designed for the common case: install it, open the folder you want the
agent to use, then connect your MCP client.

## Quick Start

```powershell
npm install -g @easonwumac/computer-linker
cd C:\Projects\my-app
computer-linker here
```

That is the normal workflow. `computer-linker here` automatically creates the
local config, owner token, workspace entry, folder name, and default coding
policy when needed.

Leave that terminal running. In another terminal, show the client setup:

```powershell
computer-linker client setup
```

For a local MCP client, the URL is:

```text
http://127.0.0.1:3939/mcp
```

If your client asks for a bearer token, show it only on a trusted local screen:

```powershell
computer-linker client setup --show-token
```

Auth header:

```text
Authorization: Bearer <ownerToken>
```

## Open A Folder

Current folder:

```powershell
cd C:\Projects\my-app
computer-linker here
```

Another folder:

```powershell
computer-linker start C:\Projects\my-app
```

The workspace name defaults to the folder name. You usually do not need
`--name`.

## Permission Modes

| Need | Command |
| --- | --- |
| Normal coding | `computer-linker here` |
| Inspect only | `computer-linker here --read-only` |
| Codex operations and screen capture | `computer-linker here --full-trust` |

Normal coding mode allows file edits plus approved project commands such as
test and build scripts. Use `--full-trust` only for folders where local agent
execution and screen capture are intended.

## Cloud MCP Clients

Cloud MCP clients cannot reach `127.0.0.1`, so start a tunnel only when the
client is not running on the same machine.

OpenAI Secure MCP Tunnel:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

In the MCP client, choose OpenAI Tunnel mode and use the `tunnel_...` id. Do
not paste the Computer Linker bearer token into OpenAI Tunnel mode.

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

Cloudflare hostname you own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Public tunnel mode exposes only `/mcp` to public-host requests. Local `/api`
and `/healthz` stay local diagnostics.

## Useful Commands

| Need | Command |
| --- | --- |
| Start current folder | `computer-linker here` |
| Start another folder | `computer-linker start C:\Projects\my-app` |
| Show MCP client settings | `computer-linker client setup` |
| Show bearer token | `computer-linker client setup --show-token` |
| Check install without exposing a project | `computer-linker check` |
| Check current server state | `computer-linker status` |
| Diagnose client setup | `computer-linker diagnose client` |
| See recent connections | `computer-linker history --view connections` |
| See tunnel status | `computer-linker tunnel status` |
| Advanced help | `computer-linker help advanced` |

## Agent Instructions

Give your MCP agent this short instruction:

```text
First call get_computer_info. Then use computer_operation with {scope, op, target, input, options}. Stay inside the configured scope. Prefer code.context, file.search, file.read, git.diff, and get_operation_history before making changes.
Call computer_operation with dotted ops from computerOperationRegistry.
Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools.
```

Main MCP tools:

| Tool | Purpose |
| --- | --- |
| `get_computer_info` | Inspect scopes, permissions, URLs, policy, and available operations. |
| `computer_operation` | Run one operation inside an approved scope. |
| `get_operation_history` | Read redacted recent activity and connection history. |

Full pasteable guidance: [docs/agent-instructions.md](docs/agent-instructions.md).

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

## Troubleshooting

Client cannot connect:

```powershell
computer-linker diagnose client
computer-linker status --details
computer-linker history --view connections
```

Tunnel does not work:

```powershell
computer-linker tunnel status
computer-linker client setup
```

OpenAI tunnel returns an organization 401:

Verify the API key's OpenAI Platform organization, Tunnels Read + Use
permission, and client workspace association. This is usually an OpenAI tunnel
authorization issue, not a Computer Linker workspace issue.

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
- [CLI Reference](docs/cli-reference.md)
- [Client Recipes](docs/client-recipes.md)
- [Agent Instructions](docs/agent-instructions.md)
- [Agent Playbook](docs/agent-playbook.md)
- [SDK Quickstart](docs/sdk-quickstart.md)
- [User Manual](docs/user-manual.md)
- [Command Policy](docs/command-policy.md)
- [Configuration](docs/configuration.md)
- [Config Schema](docs/config.schema.json)
- [API Compatibility](docs/api-compatibility.md)
- [Architecture](docs/architecture.md)
- [Developer Guide](docs/developer-guide.md)
- [Release Checklist](docs/release-checklist.md)
- [Security](SECURITY.md)
