# ChatGPT Setup

Computer Linker can be tested from ChatGPT as a remote MCP server when the
ChatGPT workspace supports custom MCP apps / developer mode.

ChatGPT cannot reach a server that only listens on `localhost` from your
computer. For cloud-hosted ChatGPT clients, expose Computer Linker through an
HTTPS URL. Cloudflare custom hostnames should be saved as `publicBaseUrl`
before OAuth client setup; Tailscale Funnel URLs are detected and saved by
`here --tunnel tailscale` or `start C:\Projects\my-app --tunnel tailscale`.

## 1. Install

Commands below use the installed CLI:

```powershell
npm install -g @easonwumac/computer-linker
```

From this checkout, run `npm install` once and replace `computer-linker` with
`npm run dev --`.

## 2. Choose A Workspace

Pass the folder to `start`. Computer Linker creates the config, owner token,
and workspace entry automatically before the server starts:

```powershell
cd C:\Projects\my-app
computer-linker here
```

From another folder, use `computer-linker start C:\Projects\my-app`.

If you want to configure without starting the server yet, use `setup`:

```powershell
computer-linker setup C:\Projects\my-app --show-token
```

Permission meaning:

- `read`: list, read, search, inspect project/git metadata
- `write`: write, edit, patch, move, delete, stage, commit
- `shell`: run package scripts, commands, and managed shell processes
- `codex`: invoke the local `codex` CLI in this workspace

`here`, `start <folder>`, and `setup <folder>` default to normal development
access: file edits plus approved project commands. Use `--read-only` when
ChatGPT should inspect without editing or running project commands. Add
`--write`, `--shell`, or `--codex` separately only when you need finer control.

When `start` or `setup` enables `--shell` or `--codex`, Computer Linker adds a
default execution policy. The default policy allows common project commands
such as `npm *`, `pnpm *`, `yarn *`, `bun *`, `node *`, `npx *`, and `git *`;
`codex *` is added only for Codex-enabled scopes. Runtime and output are capped.

Use `computer-linker status` for a quick check and `computer-linker doctor`
before exposing any workspace with `shell` or `codex`; those operations start
in the workspace but are not OS-level filesystem or network sandboxes. The
`networkAccess` fields in discovery tell clients whether host processes may
use the network; Computer Linker does not block that network path by itself.

## 3. Choose A Tunnel

Cloudflare Quick Tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Tailscale Funnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

You do not need to know `https://<machine>.<tailnet>.ts.net` before setup.
Computer Linker detects that URL from `tailscale funnel` output or Tailscale
status, prints the public MCP URL, and saves the detected origin as
`publicBaseUrl`.
The `*.ts.net` hostname is public only when Tailscale reports Funnel as enabled;
plain Tailscale DNS or Serve remains tailnet-only.

OpenAI Secure MCP Tunnel:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

This mode does not create a public MCP URL and does not need `publicBaseUrl`.
In ChatGPT connector settings, choose **Tunnel** and select or paste the
`tunnel_...` id. Do not paste the Computer Linker bearer token into ChatGPT
Tunnel mode; the local `tunnel-client` forwards the owner token to the private
local MCP server. Computer Linker downloads the official OpenAI
`tunnel-client` release into its config directory on first use, verifies the
asset with `SHA256SUMS.txt`, and then reuses that managed binary. It does not
search the Desktop for `tunnel-client.exe`; pass `--tunnel-client` or set
`COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT` only when you intentionally want a
pinned executable.

If ChatGPT or the tunnel control plane returns `401 Access denied: this tunnel
requires an active organization context`, the local Computer Linker server is
usually not the failing component. Check that the API key belongs to the
Platform organization that owns or can use the tunnel, that the organization
has Tunnels Read + Use permission, and that the tunnel is associated with the
target ChatGPT workspace when testing from ChatGPT. If you are using an API
surface that supports explicit organization selection, send the matching
OpenAI organization context for the tunnel owner.

If you run the HTTP server and tunnel separately:

```powershell
computer-linker start C:\Projects\my-app --url https://your-public-origin.example.com
```

When a running tunnel reports a public URL, persist that HTTPS origin with:

```powershell
computer-linker config set-public-url https://your-public-origin.example.com
```

You can still use `COMPUTER_LINKER_PUBLIC_BASE_URL` as a temporary override,
but `config set-public-url` is easier for repeated ChatGPT testing.

For Cloudflare, Tailscale Funnel, or a custom HTTPS reverse proxy, the public
MCP endpoint is:

```text
https://your-public-origin.example.com/mcp
```

## 4. Verify Readiness

```bash
computer-linker status
computer-linker status --details
computer-linker status --json
computer-linker doctor
computer-linker doctor --json
computer-linker doctor --fix
computer-linker client chatgpt url
computer-linker client chatgpt smoke
computer-linker client chatgpt verify --mode coding
computer-linker client chatgpt verify --mode coding --json
computer-linker client chatgpt profile --mode coding
```

The capabilities endpoint should report:

- `name: computer-linker`
- `exposure.readyForTunnel: true`
- no critical security findings
- `connectionProfile.http.publicMcpUrl` equal to your HTTPS `/mcp` URL

The CLI `status` command prints the short daily readiness view: connection mode,
local MCP URL, workspace/tunnel summary, readiness, and the next few actions.
Use `status --details` when you need the full workspace list, warnings, running
tunnel rows, and all next actions. `doctor` prints the full diagnostic view, including
`publicMcpUrl`, JSON API URLs, security findings, startup readiness, local tool
paths, missing
required/recommended tools, and suggested next actions.
Use `doctor --json` when a script or another model needs to verify readiness
without parsing terminal text. The `toolReadiness` block gives ChatGPT a compact
way to explain whether `rg`, `git`, `codex`, Node package managers, or shell
tools are available and how to install the missing required/recommended ones on
the current platform. The `startup` block lists CLI-first foreground HTTP,
stdio, and OS service startup modes plus service profile and install dry-run
commands.
Use `tunnel status --json` when the setup flow only needs tunnel provider
contracts, available commands, and the currently configured or detected public
URL.

`client chatgpt verify` is the ChatGPT-specific readiness gate. It checks the HTTPS
public base URL, `/mcp` URL, owner-token auth, the default three-tool MCP
surface (`get_computer_info`, `computer_operation`, `get_operation_history`),
workspace availability, security findings, tunnel hints, and whether workspace
permissions match the intended mode:

- `safe`: read/search/history/git-read style access only
- `coding`: write access is acceptable; shell/Codex access is reported as a
  warning that must be reviewed
- `full`: write/shell/Codex are allowed but still called out as warnings

Use `client chatgpt verify --json` for automated setup checks or when another agent
needs a structured report before attempting connection.

`client chatgpt url` is the shortest path when you only need the fields to paste into
ChatGPT. It prints the MCP server URL, the bearer Authorization header shape,
the effective public URL source (`configured` or `running-tunnel`), warnings,
and the next action if no public HTTPS URL is configured. Use
`client chatgpt url --show-token` only on a trusted setup screen.

`client chatgpt smoke` performs a live connection check against the configured
`publicBaseUrl` or a URL passed with `--url`. For public HTTPS URLs it validates
MCP `/mcp` initialize, tools/list, `get_computer_info`, and one read-only
`computer_operation` using the owner token, which matches the default MCP-only
public exposure. For local loopback testing with `--allow-http`, it also
validates `/healthz`, authenticated `/api/v1/capabilities`,
`get_computer_info`, and one read-only `computer_operation` `file.list`. Use
`client chatgpt smoke --json` for scripts. Use `--allow-http` only for local
loopback testing:

```bash
computer-linker client chatgpt smoke --url http://127.0.0.1:3939/mcp --allow-http
```

Use `status`, `doctor`, `tunnel status`, `history`, and `client chatgpt smoke`
for local readiness checks. Use `client chatgpt profile`, `manifest`,
`connector`, or `files` to export the exact fields to paste into ChatGPT: app
name, server URL, connection type, auth type, bearer-token guidance, OAuth
metadata URLs, model instructions, and workflow recipes.

`client chatgpt profile` prints a stable JSON setup profile for ChatGPT or
another hosted MCP client. It includes the MCP server URL, auth options,
recommended tool flow, operation envelope example, `modelGuide`,
`workflowRecipes`, model instructions, and warnings when the current config is
not reachable from ChatGPT.

Raw JSON clients should use the generic setup action before selecting client-
specific exports:

```json
{
  "action": "client_setup"
}
```

The ChatGPT profile export includes `connectProfile`, a redacted ready-to-paste
setup block with `appName`, `serverUrl`, auth guidance, smoke commands, export
commands, and the first prompt. It also includes `wizard.overallStatus`, `wizard.currentStepId`,
`wizard.effectiveMcpServerUrl`, `wizard.detectedPublicUrl`, and ordered setup
steps so a UI or hosted model can show the next required action without
reimplementing readiness checks. `wizard.detectedPublicUrl` is populated from
currently running Computer Linker tunnel processes, even before that URL is
saved as `publicBaseUrl`. A detected HTTPS tunnel URL can make bearer-token
ChatGPT setup ready immediately; OAuth discovery remains disabled until the
same origin is saved as `publicBaseUrl`.

Use the same mode in `client chatgpt verify` and `client chatgpt profile`:

- `safe`: generated instructions stay read-only, even if a workspace exposes
  elevated operations
- `coding`: generated instructions allow file edits and coding workflows, while
  treating shell/Codex as higher-risk operations
- `full`: generated instructions allow write/shell/process/package/git/Codex
  workflows when `allowedOperations` permits them, with warnings for destructive
  or external actions

Local JSON API check:

```bash
curl http://127.0.0.1:3939/api/v1/capabilities \
  -H "Authorization: Bearer <ownerToken>"
```

## 6. Add To ChatGPT

Generate the connector profile:

```bash
computer-linker client chatgpt url
computer-linker client chatgpt profile --mode coding
computer-linker client chatgpt profile --mode coding --url https://your-public-origin.example.com
computer-linker client chatgpt manifest --mode coding
computer-linker client chatgpt connector --mode coding
computer-linker client chatgpt files ./chatgpt-config --mode coding
```

The output directory contains `chatgpt-profile.json`,
`chatgpt-app-manifest.json`, `chatgpt-connector-config.json`,
`operation-registry.json`, and `chatgpt-index.json`. Give GPT-style clients the
operation registry when they need exact operation names, permissions, payload
fields, and safety boundaries instead of guessing function shapes.

Use `--url https://...` when `tunnel status` detected a running tunnel URL but
you do not want to write it to config yet. This changes the exported MCP URL
only; save the same origin as `publicBaseUrl` before relying on OAuth discovery
metadata. When a Computer Linker-managed tunnel is running, the CLI exports use
the detected tunnel origin for the exported MCP URL and include a warning if the
origin is not saved.

Use these fields in ChatGPT developer mode / custom MCP app setup:

- App name: `appManifest.appName`, or `appName` from `--format manifest`
- MCP server URL: `mcpServerUrl`
- Auth: OAuth when the client supports MCP OAuth discovery, or bearer token
  from `auth.bearer.header` / `auth.bearerHeader` when the client allows custom
  headers
- Model instructions: use `modelGuide` for the entrypoint and operation-choice
  rules, and `workflowRecipes` for common coding flows

For bearer-token clients:

```text
Authorization: Bearer <ownerToken>
```

or:

```text
x-computer-linker-token: <ownerToken>
```

The default output redacts the owner token. For a trusted local setup screen,
print the full token explicitly:

```bash
computer-linker client chatgpt profile --mode coding --show-token
computer-linker client chatgpt connector --mode coding --show-token
```

## First Prompt To Test

Ask ChatGPT:

```text
Call get_computer_info, choose the app scope if present, run computer_operation op=code.context, then call get_operation_history with view=last.
```

Expected flow:

1. `get_computer_info`
2. `computer_operation` with `scope: "app"` and `op: "code.context"`
3. `get_operation_history` with `view: "last"`

The default MCP surface intentionally exposes only `get_computer_info`,
`computer_operation`, and `get_operation_history`. Older clients can opt in to
the legacy workspace tools with
`COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility`; that mode exposes
`get_capabilities`, `list_workspaces`, `open_workspace`,
`workspace_operation`, `read`, `ls`, `grep`, `glob`, and `create_file`.

The generated profile also includes:

- `modelGuide.mcpEntrypoint`: the MCP tool name, currently
  `computer_operation`
- `modelGuide.jsonApiEntrypoint`: the local/trusted-private JSON API fallback,
  `POST /api/v1/control` with `action: "computer_operation"`; default public
  tunnel exposure is MCP-only, so public tunnel URLs block this route unless
  the operator deliberately exposes the JSON API through a private route
- `operation_registry`: optional JSON API discovery action for a smaller,
  filterable generic `computer_operation` contract when a client does not want
  to parse all capabilities. Use `workspace_operation_registry` or
  `operation_registry` with `contract: "workspace"` only for compatibility
  clients that still call `workspace_operation`
- `modelGuide.operationSelection`: short intent-to-op guidance for GPT clients
- `workflowRecipes`: ready-made flows such as `connect_and_orient`,
  `search_and_read`, `implement_and_verify`, and `codex_assisted_change`

For a coding task, ChatGPT can then use `computer_operation` with ops such as
`code.context`, `code.search_symbols`, `file.search`, `file.read`,
`file.patch`, `git.diff`, `package.run`, `command.run`, and, only when enabled
for that workspace, `codex.run` or `codex.start`. When a run fails or the
conversation loses context, ask it to call
`get_operation_history` with `view: "last"` first, then `view: "timeline"`,
`view: "connections"` for tunnel/session/request correlation,
`view: "failed_replay"`, `view: "sessions"` for compact session grouping, or
`view: "debug_bundle"` before retrying. In `failed_replay`, ChatGPT can submit
`replayable: true` request templates directly; when `requiresInput` is present,
it must ask for or reconstruct the missing command or Codex prompt before
retrying. After using `codex.run` or `codex.start`, ChatGPT can call
`codex.read` with the returned workflow id to inspect the stored run summary
later.

If the connector is not reachable yet, use the same history insight locally:

```bash
computer-linker history --view last
computer-linker history --view debug_bundle --workspace app --json --output ./computer-linker-debug-bundle.json
```

Tell GPT-style clients to prefer this generic operation envelope:

```json
{
  "scope": "app",
  "op": "file.search",
  "target": ".",
  "input": { "query": "TODO", "glob": "*.ts" },
  "options": { "maxResults": 20 }
}
```

## Troubleshooting

- If ChatGPT cannot connect, confirm the `/mcp` URL is HTTPS and reachable from
  outside your machine.
- If ChatGPT shows the connector but never calls tools, try a different
  ChatGPT model/lane and check `computer-linker history --view last` or tunnel
  metrics before changing tunnel settings. Some ChatGPT accounts or model lanes
  can show the app while not routing actions to MCP tools.
- If OAuth metadata is wrong, restart HTTP mode after changing `publicBaseUrl`
  or owner-token state.
- If operations are missing, call `get_computer_info`; each scope includes
  `allowedOperations` and the generic `operationRegistry`.
- If a write, shell, or Codex action is blocked, inspect
  `get_computer_info.scopes[].allowedOperations` and
  `get_computer_info.operationRegistry` before retrying.
- If ChatGPT refuses broad writes, shell commands, or remote Git operations,
  treat it as a host safety decision. Prefer `file.create`, `file.patch`, and
  local terminal follow-up for publishing or remote service changes.
