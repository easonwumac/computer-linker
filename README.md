# Computer Linker

Computer Linker exposes one approved local folder to an MCP client.

Most users only need three commands:

```powershell
npm install -g @easonwumac/computer-linker
cd C:\Projects\my-app
computer-linker here
```

Then connect your MCP client to:

```text
http://127.0.0.1:3939/mcp
```

The server runs on your computer. It creates the config, owner token, workspace
entry, and default coding policy automatically. The workspace name defaults to
the folder name.

## Quick Start

### 1. Check The Install

Computer Linker requires Node.js 20.12 or newer.

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
```

`check` starts a temporary local server and deletes the temporary files after
the test. It does not expose your real projects.

### 2. Start A Folder

From the folder you want to expose:

```powershell
cd C:\Projects\my-app
computer-linker here
```

From anywhere:

```powershell
computer-linker start C:\Projects\my-app
```

Leave that terminal running. In another terminal, run client setup or
diagnosis commands.

### 3. Connect The Client

In another terminal:

```powershell
computer-linker client setup
computer-linker diagnose client
```

If your client asks for a bearer token, print it only on a trusted local screen:

```powershell
computer-linker client setup --show-token
```

Use these client settings:

| Setting | Value |
| --- | --- |
| MCP URL | `http://127.0.0.1:3939/mcp` |
| Auth header | `Authorization: Bearer <ownerToken>` |
| Agent prompt | [docs/agent-instructions.md](docs/agent-instructions.md) |

## Common Commands

| Task | Command |
| --- | --- |
| Start current folder | `computer-linker here` |
| Start another folder | `computer-linker start C:\Projects\my-app` |
| Inspect only | `computer-linker here --read-only` |
| Full local trust | `computer-linker here --full-trust` |
| Show client settings | `computer-linker client setup` |
| Diagnose connection | `computer-linker diagnose client` |
| Show status | `computer-linker status` |
| Show recent activity | `computer-linker history --view connections` |
| Show tunnels | `computer-linker tunnel status` |
| Rotate token | `computer-linker config token rotate --show-token` |

Normal coding is the default: file read/write plus approved project commands.
Use `--read-only` for review. Use `--full-trust` only for folders where Codex
operations and screen capture are intended.

## Cloud Clients

Cloud MCP clients cannot reach `127.0.0.1`, so add a tunnel only when needed.
Public tunnel mode exposes `/mcp` to public-host requests. Local `/api` and
`/healthz` stay loopback diagnostics.

OpenAI Secure MCP Tunnel:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

Use Tunnel mode in ChatGPT or another OpenAI tunnel-aware client. Do not paste
the Computer Linker bearer token into OpenAI Tunnel mode. On first use,
Computer Linker downloads and verifies the official OpenAI `tunnel-client`.

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

## Agent Instructions

Computer Linker's recommended MCP surface has three tools:

| Tool | Purpose |
| --- | --- |
| `get_computer_info` | Inspect scopes, permissions, URLs, policy, and available operations. |
| `computer_operation` | Run one scoped operation through `{ scope, op, target, input, options }`. |
| `get_operation_history` | Inspect redacted recent activity and connection history. |

Paste this into an MCP agent when it needs guidance:

```text
You are connected to Computer Linker, a local MCP server for this computer.
First call get_computer_info to inspect available scopes, permissions, policy, and safety boundaries.
Call computer_operation with dotted ops from computerOperationRegistry and the stable envelope {scope, op, target, input, options}.
Stay inside configured scopes. Prefer code.context, file.search, file.read, git.diff, and get_operation_history before write.
Use write, shell, command, package, or codex operations only when the reported permissions and policy allow them.
Before package.run or package.start, inspect scope.policy.allowedPackageScripts and scope.policy.deniedPackageScripts when present.
Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools.
If tunnel or connection behavior is unclear, inspect get_operation_history before changing anything.
```

Example:

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

Usually use the CLI instead of editing JSON:

```powershell
computer-linker workspace list
computer-linker config validate
computer-linker config policy <workspace-id> --json
```

Safety defaults:

- Tokens are redacted unless you pass `--show-token`.
- Public tunnel mode exposes MCP only, not the local diagnostic API.
- Sensitive file content is blocked by default, including `.env*`, private
  keys, credential JSON files, and cloud CLI credential directories.
- Sensitive path metadata and writes are blocked by default.
- New coding scopes allow common local project commands and deny release-style
  package scripts such as `deploy`, `publish`, and `release`.
- Shell and Codex operations are normal local host processes inside the
  configured folder. Use OS, container, firewall, proxy, or network controls
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
and pull requests targeting `main`.

## More Documentation

- [Documentation Map](docs/README.md)
- [Learning Paths](docs/learning-paths.md)
- [Getting Started](docs/getting-started.md)
- [Usage Guide](docs/usage-guide.md)
- [CLI Reference](docs/cli-reference.md)
- [Agent Instructions](docs/agent-instructions.md)
- [Agent Playbook](docs/agent-playbook.md)
- [Client Recipes](docs/client-recipes.md)
- [SDK Quickstart](docs/sdk-quickstart.md)
- [Command Policy](docs/command-policy.md)
- [Configuration](docs/configuration.md)
- [Config Schema](docs/config.schema.json)
- [API Compatibility](docs/api-compatibility.md)
- [Architecture](docs/architecture.md)
- [Developer Guide](docs/developer-guide.md)
- [Release Checklist](docs/release-checklist.md)
- [Security](SECURITY.md)
