# Computer Linker

Computer Linker is a small local MCP server for controlling a computer through
an AI client.

It does two things:

1. Tell the client what this computer can do.
2. Run approved computer operations such as file access, search, commands,
   Codex, screenshots, and history lookup.

It is designed for macOS, Windows, and Linux. The service runs on your own
computer; Cloudflare, Tailscale, or OpenAI tunnel exposure is optional.

## Quick Start

Install the CLI, expose one folder, and keep the server running:

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
cd C:\Projects\my-app
computer-linker here
```

macOS/Linux:

```bash
npm install -g @easonwumac/computer-linker
computer-linker check
cd ~/projects/my-app
computer-linker here
```

Leave that terminal running. In another terminal, copy the MCP client settings
and verify the connection:

```powershell
computer-linker client setup
computer-linker diagnose client
```

`here` exposes the current folder. From another folder, use
`computer-linker start C:\Projects\my-app` instead. Both commands create
config, owner token, and a workspace entry when needed. The workspace name
defaults to the folder name. By default it enables file edits plus approved
project commands. Use `--read-only` for inspection only or `--full-trust` only
for folders where Codex and screen capture are intended.

From this source checkout, use the same flow through the development runner:

```powershell
npm install
npm run dev -- quickstart C:\Projects\my-app
npm run dev -- start C:\Projects\my-app
```

Use `client setup --show-token` only on a trusted local setup screen when the
client needs the bearer token.

What `here` and `start <folder>` do:

- creates config, owner token, and workspace entry when needed
- uses the folder name as the workspace name by default
- updates an existing workspace for the same folder instead of duplicating it
- starts the local MCP server at `http://127.0.0.1:3939/mcp`
- runs a startup check against health, JSON API, MCP initialize, tools/list,
  `get_computer_info`, `computer_operation`, and operation history

`here`, `start <folder>`, and `setup <folder>` default to normal coding access: file
edits plus approved project commands. Use `--read-only` for inspection-only
access, or `--full-trust` only where Codex and screen capture are intended. Add
`--codex` or `--screen` only for folders where those abilities are intended.
When shell or Codex access is enabled, Computer Linker also creates a default
execution policy with command allowlists and runtime/output limits.
File content reads and text searches block common sensitive files by default,
including `.env*`, private keys, credential JSON files, and cloud CLI credential
directories. Keep real secrets outside exposed folders.

`check` is safe to run before exposing real folders. It creates a temporary
config and workspace, starts a loopback HTTP MCP server, verifies `/healthz`,
the local JSON API, MCP initialize, tools/list, `get_computer_info`, and one
read-only `computer_operation`, then removes the temporary files.

`quickstart --json` exposes `commands.check` for the optional isolated install
check. `commands.selfTest` remains as a compatibility alias for older agents
that already consumed the previous JSON field.

There is no web dashboard in the product path. Human setup and management are
CLI-first; MCP and the JSON API are only protocol surfaces for clients,
automation, and smoke checks. The default help output is intentionally short;
use `computer-linker help advanced` for service, config, API, and compatibility
commands. ChatGPT-specific setup exports are compatibility helpers under
`computer-linker help chatgpt`; prefer the generic MCP client commands first.

`here` and `start <folder>` are local-only unless you pass `--tunnel
cloudflare`, `--tunnel tailscale`, or `--tunnel openai`.

## Expose To Cloud Clients

ChatGPT and other cloud MCP clients cannot connect to `127.0.0.1`. Expose the
local server only when you need cloud access.

OpenAI Secure MCP Tunnel does not create a public URL. Create a tunnel in the
OpenAI Platform tunnel settings, set an API key with Tunnels Read+Use
permission, then run:

PowerShell:

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

In ChatGPT connector settings, choose the tunnel option and select or paste the
`tunnel_...` id. The target MCP path remains the local server path `/mcp`.
Do not paste the Computer Linker bearer token into ChatGPT Tunnel mode; the
local `tunnel-client` forwards the owner token to the private local MCP server.
`status` reports this as an active OpenAI Secure MCP Tunnel with no public URL;
`publicBaseUrl` is not required for this tunnel mode.
If the tunnel reports an active organization context 401, verify the API key's
Platform organization, Tunnels Read + Use permission, and ChatGPT workspace
association before changing Computer Linker config.

On first use, Computer Linker downloads the official OpenAI `tunnel-client`
release from `openai/tunnel-client`, verifies it against `SHA256SUMS.txt`, and
stores it under `~/.computer-linker/tools/openai-tunnel-client/`. It never scans
your Desktop for executables. To use a pinned binary instead, set
`COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT` or pass `--tunnel-client`.

Tailscale Funnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

You do not need to type `https://<machine>.<tailnet>.ts.net` up front.
Computer Linker detects the Funnel URL from `tailscale funnel` output or
Tailscale status, prints the MCP URL, and saves the detected origin as
`publicBaseUrl`. The `*.ts.net` hostname is public only when Tailscale reports
Funnel as enabled; plain Tailscale DNS or Serve remains tailnet-only.

Cloudflare quick tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Cloudflare hostname you already own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Tunnel commands enable `publicMcpOnly` automatically. Public-host requests to
`/api` and `/healthz` return 404 from Computer Linker, leaving `/mcp` as the
exposed product surface. If a Cloudflare hostname is configured, `setup` keeps
the terminal summary short; optional WAF details are available in
`setup --json`.

After exposure, get the current tunnel state:

```powershell
computer-linker tunnel status
computer-linker history --view connections
```

For public URL based tunnels, the MCP URL is the public HTTPS URL plus `/mcp`,
for example:

```text
https://your-public-url.example.com/mcp
```

## MCP Interface

The default MCP surface is intentionally small. New clients only need three
tools:

| Tool | Use it for |
| --- | --- |
| `get_computer_info` | Inspect machine identity, scopes, permissions, readiness, and available ops. |
| `computer_operation` | Run one scoped operation through `{ scope, op, target, input, options }`. |
| `get_operation_history` | Review redacted connection, session, and operation history. |

Use this flow for every MCP client:

1. Call `get_computer_info`.
2. Pick a reported `scope`.
3. Call `computer_operation`.
4. Call `get_operation_history` when you need to inspect what happened.

For any MCP client, configure:

- Server URL: `http://127.0.0.1:3939/mcp` for local clients, or the public
  tunnel URL plus `/mcp` for cloud clients.
- Auth: bearer token for public URL tunnels. OpenAI Secure MCP Tunnel is the
  exception: choose Tunnel mode and the `tunnel_...` id; do not paste the
  Computer Linker bearer token into ChatGPT Tunnel mode.

Use the generic CLI setup summary when configuring a client:

```powershell
computer-linker client setup
computer-linker client setup --details
computer-linker client setup --show-token
computer-linker diagnose client
computer-linker client smoke --allow-http --url http://127.0.0.1:3939/mcp
```

`client setup` prints the short connection summary. Use `--details` for the
tool list, first prompt, and copy-pasteable agent instructions. Use
`--show-token` only on a trusted local setup screen. `client smoke` initializes
`/mcp`, lists tools, calls `get_computer_info`, and runs one read-only
`computer_operation`. `diagnose client` combines setup readiness, MCP smoke,
and recent connection history into one troubleshooting summary.

The repository also includes a minimal MCP client example:

```powershell
$env:COMPUTER_LINKER_MCP_URL = "http://127.0.0.1:3939/mcp"
$env:COMPUTER_LINKER_TOKEN = "<ownerToken>"
node examples/minimal-mcp-client.mjs
```

More client-specific recipes are in [docs/client-recipes.md](docs/client-recipes.md).

### Agent Instructions

Paste this into the connected agent when you want it to operate through
Computer Linker:

```text
You are connected to Computer Linker, a local MCP server for this computer.
First call get_computer_info to inspect available scopes, permissions, and safety boundaries.
Call computer_operation with dotted ops from computerOperationRegistry and the stable envelope {scope, op, target, input, options}.
Stay inside configured scopes. Prefer code.context, file.search, file.read, git.diff, and get_operation_history before write.
Use write, shell, command, or codex operations only when the reported permissions allow them.
Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools.
If tunnel or connection behavior is unclear, inspect get_operation_history before changing anything.
```

### Common Operations

Start with these before reaching for the full registry:

| Intent | `computer_operation` input |
| --- | --- |
| Project overview | `{ "scope": "app", "op": "code.context", "target": ".", "options": { "maxDepth": 2, "maxEntries": 100 } }` |
| List files | `{ "scope": "app", "op": "file.list", "target": ".", "options": { "maxEntries": 50 } }` |
| Search text | `{ "scope": "app", "op": "file.search", "target": ".", "input": { "query": "TODO" }, "options": { "maxResults": 20 } }` |
| Read file | `{ "scope": "app", "op": "file.read", "target": "README.md", "options": { "maxBytes": 65536 } }` |
| Review changes | `{ "scope": "app", "op": "git.diff", "target": ".", "options": { "maxBytes": 65536 } }` |

For verification in development scopes, use `package.run` only when the selected
scope allows shell/package execution:

```json
{ "scope": "app", "op": "package.run", "target": ".", "input": { "script": "test" }, "options": { "timeoutSeconds": 600 } }
```

### Operation Shape

Every operation uses the same request envelope:

```json
{
  "scope": "app",
  "op": "file.search",
  "target": ".",
  "input": { "query": "TODO", "glob": "*.ts" },
  "options": { "maxResults": 20 }
}
```

`computer_operation` returns the same result envelope for success and failure:

```json
{
  "ok": true,
  "operationId": "op_...",
  "scope": "app",
  "op": "file.search",
  "startedAt": "2026-06-23T00:00:00.000Z",
  "durationMs": 12,
  "data": {},
  "warnings": []
}
```

The full operation registry is returned by `get_computer_info`. The stable
request/result schema is documented in
[docs/computer-operation-v1.schema.json](docs/computer-operation-v1.schema.json).
The compatibility policy for the public MCP surface is documented in
[docs/api-compatibility.md](docs/api-compatibility.md), and reusable agent
setup guidance is in [docs/agent-instructions.md](docs/agent-instructions.md).

Compatibility tools such as `get_capabilities`, `list_workspaces`,
`open_workspace`, `workspace_operation`, `read`, `ls`, `grep`, `glob`, and
`create_file` are hidden from the default MCP surface. Set
`COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility` only for older clients that
still need those tool names.

File operations are scoped to configured folders. Command and Codex operations
start in the configured scope, but they are normal local execution, so only
enable them for folders you trust.
Sensitive file content is blocked by default for direct reads and searches;
directory listings may still show file names so the agent can understand project
shape without receiving secret values.

## Configure Scopes

Scopes define what the MCP client can touch.

```bash
computer-linker workspace list
computer-linker workspace add ~/work/app --write --shell --codex --screen
computer-linker workspace add ~/work/app --id app --name "Main app"
computer-linker workspace update app --no-shell --no-screen
computer-linker workspace remove app
```

When `--id` or `--name` is omitted, Computer Linker derives it from the folder
name. Direct `workspace add` scopes default to read-only with screen capture
disabled. Add `--write`, `--shell`, `--codex`, or `--screen` separately only
where needed. For daily setup, prefer `computer-linker here` inside the folder,
or `computer-linker start <folder>` from somewhere else; both create a normal
coding workspace and default execution policy automatically. Advanced
`workspace add/update` flows leave policy management explicit through `config
policy`.

The config lives at:

```text
~/.computer-linker/config.json
```

`config show` redacts the owner token by default; use `--show-token` only on a
trusted local setup screen.

For shell-enabled scopes, `config.json` can set or refine conservative command
policy:

```json
{
  "id": "app",
  "policy": {
    "maxRuntimeSeconds": 600,
    "maxOutputBytes": 200000,
    "allowedCommands": ["npm *", "pnpm *", "yarn *", "bun *", "node *", "npx *", "git *"],
    "deniedCommands": ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"]
  }
}
```

The same policy can be maintained without editing JSON by hand:

```bash
computer-linker config policy app --allow "npm *" --allow "git *" --deny "rm -rf *" --max-runtime-seconds 600 --max-output-bytes 200000
computer-linker config policy app --json
```

Owner-token maintenance is also CLI-managed. Status output redacts the token;
use `--show-token` only on a trusted local setup screen when updating an MCP
client:

```bash
computer-linker init
computer-linker config token
computer-linker client setup --show-token
computer-linker profile --show-token
computer-linker config token rotate --show-token
computer-linker config token rotate --json
```

## Run As A Service

For daily use on Windows, macOS, or Linux, install the background service after
your config works in the foreground:

```bash
computer-linker service install --dry-run
computer-linker service install --yes
computer-linker service start
computer-linker service status
computer-linker service logs
```

Remove it later with:

```bash
computer-linker service stop
computer-linker service uninstall --yes
```

Windows install/uninstall must run from an elevated PowerShell prompt. See
[docs/service-mode.md](docs/service-mode.md) for generated files and platform
notes.

## Check Readiness

```bash
computer-linker status
computer-linker status --details
computer-linker doctor
computer-linker doctor --json
computer-linker doctor --fix --dry-run
computer-linker doctor --fix
computer-linker config validate
computer-linker config validate --json
computer-linker diagnose client
computer-linker process list <workspace-id>
computer-linker process read <workspace-id> proc_...
computer-linker process stop <workspace-id> proc_...
computer-linker screen status
computer-linker screen status --json
computer-linker client chatgpt smoke --url http://127.0.0.1:3939/mcp --allow-http
```

`status` is the short daily check: readiness, connection mode, local MCP URL,
workspace/tunnel summary, and the next few actions. Use `status --details`
when you want the full workspace list, warnings, running tunnel rows, and all
next actions.
`doctor` checks platform info, Node, local tools such as `rg`, `git`, `codex`,
workspace permissions, config diagnostics, auth, tunnel readiness, security
findings, and `releaseReadiness`.
`doctor --fix --dry-run` previews the same repairs without writing the config.
`doctor --fix` applies low-risk config repairs: remove the bootstrap `current`
scope after explicit scopes exist, remove exact duplicate folder scopes that
have the same permissions and policy, and add missing default execution policy
fields for shell/Codex scopes.
`config validate` prints the config/security/release-readiness subset and exits
non-zero when the release status is blocked.
`diagnose client` runs client setup checks, a minimal MCP SDK flow, and redacted
connection-history inspection in one command.
`process list/read/stop` talks to the running local HTTP server, so it manages
active background command and Codex processes that were started through MCP.

The release readiness block is intended for productization gates:

```bash
computer-linker doctor --json
```

Look for:

```json
{
  "releaseReadiness": {
    "ready": true,
    "status": "ready",
    "recommendedGate": "npm run product:check"
  }
}
```

## Build And Test

```bash
npm run typecheck
npm test
npm run release:validate
npm run build
npm run pack:smoke
npm run product:check
npm run alpha:check
```

`npm test` prints per-file progress and durations. Use
`node scripts/run-tests.mjs --list` to see the test labels, or pass a label/path
fragment such as `node scripts/run-tests.mjs cli` for a focused local run.

The default GitHub Actions CI gate is cost-capped but automatic: it runs
`npm run product:check` on `windows-latest` with Node 22 for pushes to `main`
and pull requests targeting `main`, and it also supports `workflow_dispatch`
reruns. Run broader OS or Node coverage manually only when preparing a wider
release. The release packaging workflow remains manual. `npm run
release:validate` rejects matrix jobs, non-Windows runners, extra Node
versions, background triggers, and accidental automatic release packaging.

## Productization Gate

For normal local development, the main gate is:

```bash
npm ci
npm run product:check
```

For npm publishing, use the local release wrapper instead of hand-running every
step:

```bash
npm run release -- --otp <code>
```

`release` requires a clean main/master worktree, a dated changelog heading, and
npm login. It creates `v<package.version>` on `HEAD` when missing, runs npm's
publish guard, publishes, waits for registry metadata, verifies the npm
dist-tag, runs the published CLI from a clean temporary directory, then pushes
`HEAD` and the release tag. Use `npm run release:check` before the final commit
when you want a non-publishing gate, `npm run release:dry-run` for an npm
dry-run only, or `npm run release:publish -- --create-tag --push --otp <code>`
when debugging the lower-level publish wrapper directly. Use `npm run release:verify`
to repeat the post-publish check for the current `package.json`
version.
On Windows, if `NODE_AUTH_TOKEN` is saved in the User environment but the
current shell has not picked it up yet, the release wrapper loads it only into
the current release process before running `npm whoami` or `npm publish`.

For a public alpha from this private dogfooding checkout, use the fresh public
snapshot path:

```bash
npm run public:release-ready
npm run public:mirror -- --remote <github-owner>/<public-repo>
git -C ../computer-linker-public push -u origin main --follow-tags
```

`public:release-ready` is the final local preflight before publishing the public
mirror. It runs the alpha readiness gate with external evidence required and
also requires the current `CHANGELOG.md` package heading to be dated instead of
`Unreleased`.

`public:mirror` runs public readiness once, accepts the known private-history
warning only for the detached one-commit snapshot path, then creates or updates
the one-commit mirror with a `v<package.version>` release tag for publish and
Release workflow guards. A real publishable mirror requires the matching
changelog heading to be dated instead of `Unreleased`; dry runs print whether
the real run would be blocked. Do not make this existing repo public with
preserved history unless the stricter direct-repo gate passes:

```bash
npm run public:repo-ready
```

Before announcing a public alpha, capture one real external MCP client/tunnel
pass:

```bash
npm run alpha:evidence -- preflight
npm run alpha:evidence -- smoke --redaction-confirmed
npm run alpha:check -- --require-evidence --accept-public-snapshot
```

Paste the preflight prompt into the external MCP client first. The generated
`.computer-linker-alpha-evidence.json` file is gitignored and must not contain
owner tokens, API keys, bearer headers, screenshots, or private file contents.
The stricter release and publish rules live in
[docs/release-checklist.md](docs/release-checklist.md).

## Product Boundary

Computer Linker is not a remote desktop, a cloud service, or a ChatGPT-specific
app. It is a local MCP program that exposes approved computer abilities.

See [docs/README.md](docs/README.md) for the full documentation map,
[docs/getting-started.md](docs/getting-started.md) for the step-by-step
tutorial, [docs/product-spec.md](docs/product-spec.md) for the product spec,
[docs/architecture.md](docs/architecture.md) for implementation notes, and
[docs/developer-guide.md](docs/developer-guide.md) for module boundaries. See
[docs/release-checklist.md](docs/release-checklist.md) for the alpha release
checklist, [docs/manual-test-plan.md](docs/manual-test-plan.md) for dogfooding,
and [SECURITY.md](SECURITY.md) for the current security model. Public
contribution and issue guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).
