# Manual Test Plan

Use this plan before sharing an alpha build or when dogfooding a local
checkout. It keeps the first test isolated from your real Workspace Linker
config.

Commands below assume this checkout and use `npm run dev --`. When testing an
installed package instead, replace `npm run dev --` with `workspace-linker`.

## 1. Build Gate

```bash
npm ci
npm run product:check
npm run alpha:check
npm run public:mirror -- --dry-run --remote <github-owner>/<public-repo>
npm run dev -- self-test
```

Expected:

- typecheck, tests, build, release validation, and package smoke pass
- package smoke reports `workspace-linker-<version>.tgz` and verifies a
  temporary consumer install, installed CLI execution, installed self-test,
  isolated setup/status, and SDK import
- alpha readiness reports `status: ready`, or `status: needs_attention` only
  because preserved Git history must be published through `public:mirror`
- `public:mirror -- --dry-run --remote ...` reports the mirror dry-run is
  publishable when the fresh public mirror path is accepted and the other gates
  pass; before a real mirror release, resolve any `release tag check: blocked
  for real run` changelog warning
- `self-test` reports `ready: yes` and verifies the local MCP SDK tool flow
  without touching real user workspaces
- external MCP client/tunnel evidence is still pending until the later tunnel
  smoke step writes `.workspace-linker-alpha-evidence.json`

## 2. Isolated Local Config

Use a disposable config directory for the first manual pass.

PowerShell:

```powershell
$env:WORKSPACE_LINKER_CONFIG_DIR = "$PWD\.workspace-linker-test\config"
npm run dev -- setup . --id app --url https://mcp.example.com --show-token
npm run dev -- status
npm run dev -- doctor --fix --dry-run
npm run dev -- doctor --fix
npm run dev -- config validate
```

Bash:

```bash
export WORKSPACE_LINKER_CONFIG_DIR="$PWD/.workspace-linker-test/config"
npm run dev -- setup . --id app --url https://mcp.example.com --show-token
npm run dev -- status
npm run dev -- doctor --fix --dry-run
npm run dev -- doctor --fix
npm run dev -- config validate
```

Expected:

- `config validate` does not report `blocked`
- `workspace list` shows the `app` scope named from the checkout folder
- first-run `setup` / `start <folder>` does not leave the bootstrap `current`
  scope in the config
- `status` says `doctor --fix` removes the bootstrap `current` scope instead
  of implying it will only add an execution policy
- new workspaces are read-only unless you explicitly add `--write`
- shell remains disabled unless you explicitly add `--shell`
- `--shell` or `--codex` adds a default execution policy with `allowedCommands`,
  `maxRuntimeSeconds`, and `maxOutputBytes`
- `doctor --fix --dry-run` reports planned repairs without writing the config
- `doctor --fix` is idempotent and reports `changed: no` on a second run
- duplicate folder scopes with different permissions are reported for manual
  cleanup without recommending one specific id to remove
- setup output includes `public access: MCP endpoint only`, a concise
  connection summary, and the next start/client setup commands. Full WAF and
  policy details stay in `setup --json`.

Tailscale Funnel variant:

```powershell
npm run dev -- start C:\Projects\my-app --dev --tunnel tailscale
```

Expected:

- start auto-creates the config, owner token, and workspace entry
- start prints `server: running` and `startup check: ready` after verifying
  local HTTP, JSON API, and MCP tool flow
- start does not require a `https://*.ts.net` URL
- start prints `tunnel: tailscale active`, `public MCP:`, and
  `saved public URL:`
- `config show` contains the detected `https://<machine>.<tailnet>.ts.net`
  origin after start

OpenAI Secure MCP Tunnel variant:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
npm run dev -- start C:\Projects\my-app --dev --tunnel openai --tunnel-id tunnel_...
```

Expected:

- start auto-creates the config, owner token, and workspace entry
- start prints `server: running` and `startup check: ready`
- first start downloads OpenAI's official `tunnel-client` into
  `~/.workspace-linker/tools/openai-tunnel-client/`
- start prints `connect: OpenAI Tunnel mode`, `tunnel: OpenAI Secure MCP
  Tunnel active`, and `tunnel id:`
- start tells the user that ChatGPT Tunnel mode uses the tunnel id and should
  not receive a pasted bearer token
- no `publicBaseUrl` is required or saved for this mode
- `status` and `doctor` do not ask for `publicBaseUrl` while an OpenAI Secure
  MCP Tunnel is active

## 3. HTTP, CLI, And API

Terminal A:

```bash
npm run dev -- start . --id app --dev
```

Terminal B:

```bash
npm run dev -- doctor
npm run dev -- status
npm run dev -- self-test
npm run dev -- profile
npm run dev -- client setup
npm run dev -- client setup --details
npm run dev -- client setup --show-token
npm run dev -- client setup --json
npm run dev -- diagnose client
npm run dev -- client smoke --url http://127.0.0.1:3939/mcp --allow-http
WORKSPACE_LINKER_TOKEN=<ownerToken> node examples/minimal-mcp-client.mjs
npm run dev -- process list app
npm run dev -- screen status
npm run dev -- history --view last
```

Expected:

- `/healthz`, authenticated `/api/v1/capabilities`, `get_computer_info`,
  read-only `computer_operation` `file.list`, and local MCP SDK smoke pass
- `status` shows machine identity, local MCP URL, public MCP/tunnel state,
  workspace count, warnings, and next actions
- `doctor` shows full diagnostics, security findings, history commands, and
  setup guidance
- `client setup` reports a short generic MCP connection summary without
  requiring ChatGPT-specific profile formats; `client setup --details` prints
  tool names, first prompt, and agent instructions; `--show-token` prints the
  bearer header only when explicitly requested on a trusted screen
- `diagnose client` reports setup readiness, MCP smoke result, connection
  history count, blockers, and next actions
- `examples/minimal-mcp-client.mjs` can initialize `/mcp`, list tools, call
  `get_computer_info`, run read-only `computer_operation`, and read history
- `process list` reports currently managed background command/Codex processes
  or `none` while the local HTTP server is running
- `screen status` reports provider support, permission status, and
  screen-enabled workspaces without capturing pixels
- On Windows, primary-display capture is available through the PowerShell
  screenshot provider in an interactive desktop session. Test actual capture
  only with a `--screen` workspace and only when local screen contents are safe
  to capture.
- security warnings are understandable and match the configured permissions

## 4. JSON API Contract

Use the owner token returned on a trusted local setup screen by:

```bash
npm run dev -- profile --show-token
npm run dev -- setup . --id app --show-token
npm run dev -- config token rotate --show-token
```

Then call:

```bash
curl -s -H "Authorization: Bearer <ownerToken>" http://127.0.0.1:3939/api/v1/capabilities
```

Generic operation smoke:

```bash
curl -s -H "Authorization: Bearer <ownerToken>" \
  -H "content-type: application/json" \
  -d "{\"action\":\"computer_operation\",\"scope\":\"app\",\"op\":\"file.search\",\"target\":\".\",\"input\":{\"query\":\"Workspace Linker\",\"glob\":\"README.md\"},\"options\":{\"maxResults\":5}}" \
  http://127.0.0.1:3939/api/v1/control
```

Expected:

- capabilities includes `computerOperationContract` and
  `computerOperationRegistry`
- `computer_operation` returns `{ "ok": true, ... }` with an `operationId`
- path and permission failures return a structured `{ "ok": false, "error": ... }`
  envelope

## 5. MCP Client Smoke

For a local MCP client, use:

```text
http://127.0.0.1:3939/mcp
```

Expected tool flow:

1. `get_computer_info`
2. `computer_operation` with `scope: "app"` and `op: "file.search"`
3. `get_operation_history`

The built-in `client smoke` command already verifies a bounded version of this
through the MCP SDK: initialize, tools/list, `get_computer_info`, and
read-only `computer_operation` `file.list`. Keep this manual step for at least
one external MCP client before announcing a public alpha.

Compatibility clients may still use the older MCP surface after starting with
`WORKSPACE_LINKER_MCP_TOOL_SURFACE=compatibility`:

1. `get_capabilities`
2. `list_workspaces`
3. `open_workspace`
4. `workspace_operation`

## 6. Tunnel Smoke

Only run this after local HTTP smoke passes and an owner token is configured.

```bash
npm run dev -- client chatgpt verify --mode coding
npm run dev -- start
```

Or:

```powershell
npm run dev -- start C:\Projects\my-app --dev --tunnel tailscale
```

Or:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
npm run dev -- start C:\Projects\my-app --dev --tunnel openai --tunnel-id tunnel_...
```

Expected:

- start refuses to open a tunnel if no owner token is configured
- public URL modes: `client chatgpt url` reports a public HTTPS MCP URL
- OpenAI tunnel mode: ChatGPT connector settings use Tunnel plus the
  `tunnel_...` id instead of a public URL
- public `client smoke --url <https-origin>/mcp` passes without `--allow-http`
  using MCP-only SDK checks; it must not require public `/api/v1` access

After one real external MCP client has called `get_computer_info`,
`computer_operation`, and `get_operation_history`, record the smoke pass
without hand-editing JSON:

```bash
npm run alpha:evidence -- preflight
npm run alpha:evidence -- smoke --redaction-confirmed
npm run alpha:check -- --require-evidence
```

`preflight` reads local config, audit history, and tunnel runtime state. Use it
to confirm the history contains the external tool flow before recording
evidence; it also prints a read-only prompt to paste into the external MCP
client. When only one call is missing, `nextExternalClientPrompt` contains a
short prompt for that missing call. When the preflight no longer fails, run the
printed `recordCommand`. `smoke` auto-detects the exposure, tunnel target, and
scope from local preflight state when possible. It does not write the evidence
file until you run `smoke` and confirm redaction with `--redaction-confirmed`.
If an older Workspace Linker alpha evidence file already exists, `smoke`
refreshes it for the current test; unrelated files still require `--force`
before replacement.

Use `npm run alpha:evidence -- init` plus `record-smoke` or `record` only when
you want to split the steps or keep separate notes per required check.

Expected:

- evidence check passes for the current package version and Git HEAD
- evidence is no older than 14 days
- exposure is OpenAI, Cloudflare, Tailscale Funnel, or a manual reverse proxy
- OpenAI evidence records the tested `tunnel_...` id; public URL provider
  evidence records an HTTPS origin or URL
- target MCP path is `/mcp`, and target scope records the workspace scope used
  by the external test
- public alpha evidence confirms `/mcp` works and `/api/v1` / `/healthz` are
  not exposed through the public surface
- `alpha:evidence init` and `record` refuse common secret-shaped values before
  writing the evidence file
- evidence does not contain owner tokens, API keys, bearer headers,
  screenshots, or private file contents

## Cleanup

Stop the HTTP server with `Ctrl+C`.

PowerShell:

```powershell
Remove-Item -Recurse -Force .workspace-linker-test
Remove-Item Env:\WORKSPACE_LINKER_CONFIG_DIR
```

Bash:

```bash
rm -rf .workspace-linker-test
unset WORKSPACE_LINKER_CONFIG_DIR
```
