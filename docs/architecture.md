# Workspace Linker Architecture

The product boundary is defined in [product-spec.md](product-spec.md). This
architecture should serve that spec: a local computer MCP service for controlled
file access, commands, Codex, screenshots, computer info, and audit history.
ChatGPT-specific setup is a client helper, not the product axis.

## Product Name

The product is named **Workspace Linker**. It intentionally does not reuse DevSpace.

## Mental Model

One computer runs one Workspace Linker MCP server.
The runtime target is Node.js on macOS, Linux, and Windows. The default GitHub
Actions product gate is manual and runs on `windows-latest` with Node 22 to
keep routine Actions usage bounded. Broader OS or Node coverage should be run
manually before a wider release. The local and CI release gate is
`npm run product:check`, which runs release metadata validation, typecheck,
the progress-reporting test runner, build, and package smoke.
The package smoke uses `npm pack --dry-run` to verify packed files, CLI bins,
SDK exports, release docs, security policy, and the published
`computer_operation` schema, then creates a real `.tgz`, installs it into a
temporary consumer project, runs the installed `workspace-linker` bin, verifies
installed `self-test`, `setup`, and `status` against isolated config
directories, and imports the installed SDK entrypoint. The package build uses
`tsconfig.build.json` so tests are typechecked but are not emitted into the
runtime package.

```text
ChatGPT / Claude / MCP host
  -> Workspace Linker: desktop-pc
       workspaces: ~/work/app-a, ~/open-source/lib-b
  -> Workspace Linker: laptop-pc
       workspaces: ~/client-a/site, ~/notes/dev
```

The user chooses the target connector by machine name. Each connector also has
a stable `machineId` so clients can distinguish two computers even if the
display name changes. Inside that connector, the model calls
`get_computer_info`, chooses one reported scope, and then sends stable
`computer_operation` envelopes.

When no config file exists, Workspace Linker writes a loopback-only default config on
first load so the `machineId` is durable even before explicit initialization.
`workspace-linker init` adds an owner token to that existing config when needed.
`workspace-linker config token rotate` replaces the owner token for routine
credential rotation; `--show-token` is required before the raw token is printed.

`workspace-linker client setup` exports MCP setup guidance with redacted auth by
default; `client setup --show-token` includes the owner token only for trusted
local setup screens. `workspace-linker profile` exports a lower-level
per-computer connection profile with machine ID, machine name, stdio command,
local/public MCP URLs, local/public JSON API URLs, and the same redaction
default. Capabilities also expose the redacted profile so clients can identify
which computer they are connected to.

The previous prototype name was LocalPort. New installs expose only the
`workspace-linker` CLI. `LOCALPORT_*` and `x-localport-token` remain config and
HTTP auth compatibility aliases while the product moves to `WORKSPACE_LINKER_*`
and `x-workspace-linker-token`.

`get_computer_info` is the public MCP introspection entrypoint. The local
`/api/v1/capabilities` endpoint and compatibility `get_capabilities` tool
expose the fuller implementation diagnostics for local tools, config, security,
release readiness, and tunnel state. Together they expose OS/runtime facts,
coding capability flags, local tool availability, executable paths, versions,
install hints, workspace permissions, operation catalog, config diagnostics,
security findings, release readiness, tunnel diagnostics, and the redacted
connection profile. This lets a client choose whether to use fast search,
shell, Codex, package scripts, or tunnel setup without probing many separate
endpoints. The `toolReadiness` block separates required, recommended, and
optional local tools so GPT-style clients can explain missing `rg`, `git`,
`codex`, or package tooling without guessing platform-specific installation
steps.

`releaseReadiness` is the productization summary for CLI, API, smoke checks, and
CI handoff. It combines Node runtime support, config diagnostics, security
diagnostics, tool readiness, startup readiness, workspace scope presence, and
command policy coverage. A release is blocked when
`releaseReadiness.status === "blocked"`; `needs_attention` keeps the local
service usable but should be reviewed before tagging an alpha release.
`workspace-linker config validate` exposes this release-focused subset for
local release scripts, while the manual GitHub Actions `Release Package`
workflow runs the product gate and uploads the packed npm artifact.
The local `alpha:evidence` release tool captures one manually verified external
MCP client/tunnel pass in a gitignored JSON file, with `record` commands for
marking individual checks as passed without hand-editing JSON. `init` and
`record` reject common secret-shaped values before writing evidence. `alpha:check
--require-evidence` validates that evidence against the current package version,
Git HEAD, age, concrete client/exposure/tunnel target, `/mcp` path, required
generic MCP tool flow, MCP-only public surface, history review, and common
secret-shaped values before a public alpha announcement.
`workspace-linker status` is the short daily readiness command for humans and
scripts. Its text output uses user-facing readiness labels; release-focused
`releaseReadiness` details stay in `doctor`, `config validate`, and JSON
outputs, while verbose status rows stay behind `status --details`.
`workspace-linker doctor --fix` applies local, deterministic config
repairs only: bootstrap scope cleanup, exact duplicate folder-scope cleanup,
and missing execution policy defaults. It does not guess tunnel URLs or mutate
external services.
Config diagnostics warn when multiple scopes point at the same folder, but this
is auto-fixed only when the duplicate scopes have identical permissions and
policy. Differently permissioned duplicates may be intentional and remain a
manual cleanup decision.

## Scope And Permission Model

The product spec uses **scope** as the public term. A current workspace is a
folder-backed scope kept for compatibility while the implementation moves toward
the generic computer-control contract.

Permissions live on predefined scopes, not on individual tool calls. The
current compatibility flags are:

- `read`: read files, list directories, search files
- `write`: write, edit, create, move, and delete paths
- `shell`: run local shell commands in a workspace
- `codex`: invoke the local `codex` CLI in a workspace
- `screen`: capture screen pixels through the platform screenshot provider

The default MCP surface is the spec-defined `get_computer_info`,
`computer_operation`, and `get_operation_history`. Compatibility tools
`get_capabilities`, `list_workspaces`, `open_workspace`,
`workspace_operation`, `read`, `ls`, `grep`, `glob`, and `create_file` are
hidden unless `WORKSPACE_LINKER_MCP_TOOL_SURFACE=compatibility` is set for an
older client. Those tools call the same workspace operation dispatcher.
Operations inherit the scope's policy, and file path resolution cannot leave
configured roots.
Capability, workspace-list, and open-workspace responses include
`allowedOperations` and a derived `capabilityPolicy` for each workspace so
clients can pick valid operations without reimplementing permission rules.
`allowedOperations` is the concrete call allowlist; `capabilityPolicy` is the
more semantic contract for clients, with capabilities such as `git:read`,
`git:write`, `package:run`, `process:manage`, `codex:readOnly`,
`codex:write`, `screen:capture`, `network:false`, and `maxRuntimeSeconds`.
Clients can also call `explain_operation` inside an opened workspace to
preflight one operation and receive its required permission, missing permission
when blocked, required capabilities, missing capabilities, catalog entry, and
safety boundary metadata. `allowedOperations` is the intersection of the legacy
workspace permission flag and the derived capability policy.
Workspace ids are unique. When exposed paths overlap, direct path matching uses
the deepest matching configured path; explicit workspace opens by id, name, or
exact configured path remain exact.
Capability discovery includes `computerOperationContract` and
`computerOperationRegistry` so new clients can use the generic
`computer_operation` envelope without hardcoding operation names. It also
includes an `exposure` summary that tells clients whether this machine is
loopback-only, which tunnel tools are available, whether the server is ready for
tunnel exposure, and which blocking reasons or warnings remain.
`computer_operation` returns the product-level result envelope with `ok`,
`operationId`, `scope`, `op`, timing fields, `data` on success, and `error` on
failure. Compatibility `workspace_operation` continues to return the legacy
operation data shape directly.
`operation_registry` now defaults to the generic `computer_operation` registry
so raw JSON clients can discover dotted ops such as `file.read`,
`code.context`, `git.diff`, `package.run`, `command.run`, and `history.last`
without parsing the full capabilities payload. Compatibility clients can still
request the old workspace-operation
registry with `workspace_operation_registry` or
`operation_registry` plus `contract: "workspace"`; that legacy registry is
built through `registerOperation(...)` and combines operation category,
permission, schema, run/audit metadata, examples, boundary metadata, required
capabilities, and runtime limits in one list. Internally,
`runWorkspaceOperation` resolves the registry entry first and calls its
registered runner, so the registry is part of the execution path rather than
only documentation. Older operation groups still share the legacy dispatcher,
while file/search operations use `runFileSearchOperation`, metadata and history
operations use `runMetadataOperation`, Codex operations use `runCodexOperation`,
and screen operations use `runScreenOperation`; future provider groups should
follow that pattern instead of adding more switch cases. The registry builder
validates that every known operation is registered exactly once and rejects
unknown or duplicate operation names, so catalog, capability, audit, and
execution metadata cannot silently drift apart.

Capabilities also include `operationSafety`. This machine-readable list marks
each operation as `workspace-path-enforced`, `workspace-scoped-metadata`,
`workspace-cwd-only`, or `mixed`. File, search, patch, and direct Git operations
validate workspace paths before running. Shell, long-running process, and Codex
operations start in the workspace but are cwd-bound local execution rather than
an OS filesystem sandbox. Clients that need hard boundaries should prefer the
path-enforced operations and require explicit user trust before using cwd-only
execution.

## Why Separate `shell` And `codex`

Shell access is broad local execution. Codex access is also broad, but it is a
specific workflow with its own user expectations. Keeping it separate lets a
user allow normal tests, package scripts, and long-running dev processes while
blocking local agent loops, or allow Codex only for selected repos.

`command`, raw `codex`, and Codex workflow operations return structured process
results, including non-zero `exitCode`, `stdout`, `stderr`, signal, and timeout
status. A failed test command is still a successful Workspace Linker operation
because the diagnostic output is the useful result. `process_start`,
`codex_start`, `process_list`, `process_read`, and `process_stop` provide
workspace-scoped in-memory management for dev servers, watch tests,
long-running shell tasks, and long-running Codex jobs. Managed processes are
tagged as `shell` or `codex`;
workspaces can only read or stop process kinds allowed by their current
permissions. On Unix-like systems, managed processes are started in a process
group so stop and timeout can terminate child processes started by commands
such as `npm run dev` or `codex exec`. HTTP server shutdown also stops all
managed processes to avoid leaving detached tasks behind. If a managed process
does not exit after the requested stop signal, Workspace Linker follows up with
`SIGKILL`.

Workspace config can add an optional `policy` block per scope. Command,
package, managed process, and Codex execution check `allowedCommands` and
`deniedCommands` wildcard patterns before launch, cap runtime with
`maxRuntimeSeconds`, and bound command stdout/stderr with `maxOutputBytes`.
`workspace-linker start <folder>` and `workspace-linker setup <folder>` attach
a default execution policy when `--shell` or `--codex` is enabled. Manual
`workspace add/update` flows keep policy management explicit. Absent policy
keeps the existing permission-flag behavior.
Config diagnostics and security diagnostics warn when shell or Codex execution
is enabled without an `allowedCommands` policy, because those operations remain
cwd-bound local execution rather than a filesystem sandbox.

These operations are intentionally flagged by security diagnostics. Workspace Linker
sets the working directory to the workspace, but a normal OS shell or Codex
process is not a filesystem sandbox. Read/write/search operations enforce path
boundaries directly; shell/codex should only be enabled for workspaces where
that broader local execution is acceptable.

## HTTP Mode

Workspace Linker supports stdio, a Streamable HTTP MCP endpoint, and a small JSON API
for non-MCP clients. Tunnel commands start the HTTP server and then shell out to
the provider CLI:

- Cloudflare Quick Tunnel: `cloudflared tunnel --url http://127.0.0.1:<port>`
- Tailscale Funnel: `tailscale funnel --yes <port>`
- OpenAI Secure MCP Tunnel: `tunnel-client run --control-plane.tunnel-id tunnel_... --mcp.server-url url=http://127.0.0.1:<port>/mcp`

Tailscale Serve is intentionally not part of the short-term public ChatGPT
flow because it is tailnet-scoped; Funnel is the public Tailscale path.
OpenAI Secure MCP Tunnel is different from the public URL providers: ChatGPT
uses the OpenAI tunnel id, and the local server remains private behind outbound
HTTPS from `tunnel-client`.

HTTP mode exposes OAuth metadata, dynamic client registration, owner-token
approval, access tokens, and refresh tokens. It also accepts the owner token as
a direct bearer token for simpler clients that support custom headers.

OAuth registered clients, access tokens, and refresh tokens are persisted in
`~/.workspace-linker/oauth-state.json` with `0600` permissions. Short-lived
authorization codes stay in memory and expire quickly; they are not persisted
across restarts.

When running behind a tunnel, `publicBaseUrl` or `WORKSPACE_LINKER_PUBLIC_BASE_URL`
must match the reachable origin so OAuth issuer and resource metadata are
correct. OpenAI Secure MCP Tunnel does not use `publicBaseUrl`; connector setup
uses the `tunnel_...` id instead. Daily status output should treat a running
OpenAI tunnel as active exposure without a public URL, not as a missing
`publicBaseUrl` problem.

## JSON API

The JSON API lives under `/api/v1` and mirrors the core MCP model with a small
surface. The preferred shape for simple clients is `POST /api/v1/control` with
an `action` value: `get_computer_info`, `client_setup`,
`computer_operation`, or `get_operation_history`. Compatibility actions include
`get_capabilities`, `doctor`, `list_workspaces`, `history`, `history_insight`,
`operation_registry`, `workspace_operation`, and the shorter `operation` alias.
For new clients, `computer_operation` accepts the flat envelope
`{ action, scope, op, target, input, options }`. Its `op` value should come from
`computerOperationRegistry`, for example `file.read`, `file.search`,
`code.context`, `git.diff`, `package.run`, `command.run`, `codex.run`,
`screen.capture`, or `history.last`.
The older workspace/action shape and direct legacy operation names remain
supported during migration.
The JSON API is a local or trusted-private automation surface. Public tunnel
commands default to MCP-only exposure, so public hosts expose `/mcp` and block
`/api/v1` unless the operator deliberately places the JSON API behind a private
route.
This gives non-MCP clients one universal command-style endpoint while keeping
dedicated compatibility endpoints for normal REST usage. `doctor` is a compact
readiness summary for clients that need to decide whether tunnel exposure is
safe without parsing the full capabilities payload.

The workspace operation path covers single and multi-file read,
compare-and-write, write/edit, directory listing, bounded recursive tree
listing, path metadata, directory creation, path move/delete, project
instruction loading, workspace-scoped audit history, coding-oriented project
overview, read-only git status/diff inspection, workspace-bounded Git index and
commit updates, bounded Git worktree creation for parallel coding sessions,
workspace-validated unified diff patching, fast file/text search, ordered batch
execution, command execution, long-running process management, and Codex
execution, including background Codex jobs. It is intended for scripts and
simple local integrations that do not speak MCP. Screen operations report
provider readiness, list known capture targets, and advertise only the capture
target types the current platform provider can run.
The current screenshot providers are macOS `screencapture` for display/window
capture and Windows PowerShell for primary-display capture in an interactive
desktop session. Linux reports capability status until a desktop/session
provider is added. Window and process capture remain provider-specific; generic
clients should follow `computerOperationRegistry`, while legacy direct calls
return clear unsupported errors when the platform cannot supply that target.

Workspace operations support both the original direct-field payload and a
generic envelope for clients that want a stable outer shape:

```json
{
  "workspace": "app",
  "op": "read",
  "target": "README.md",
  "input": {},
  "options": { "maxBytes": 65536 }
}
```

`op` is a registered operation name. `target` maps to the natural target for
that operation, while `input` carries required data and `options` carries
limits or modifiers. The server normalizes both shapes before permission checks,
execution, and audit logging.

API calls use configured workspace references instead of MCP session
`workspaceId` values. Each request resolves the configured workspace, checks the
same permissions, resolves paths inside the same boundary, and writes the same
audit log events. This keeps the API simpler without creating a second security
model or a long list of public endpoints.

## Search

Search is a first-class coding API:

- `tree`: bounded recursive workspace structure listing
- `explain_operation`: explain whether one operation is allowed in the current
  workspace, including required permission and safety boundary metadata
- `instructions`: load `AGENTS.md` and `CLAUDE.md` files from the workspace
  root to a target path
- `agent_skills`: discover workspace-scoped agent skills from `.codex/skills`,
  `.claude/skills`, and `skills` without reading global user skill folders
- `coding_context`: return the normal session-start context in one call:
  overview, instructions, skills, tree, and change summary
- `project_overview`: summarize package scripts, package managers, config
  files, language hints, instruction files, git presence, and suggested next
  operations for coding work
- `history`: return recent audit events for the opened workspace
- `history_insight`: return an agent-friendly last-operation view, history
  summary, chronological timeline, session/connection summaries, failed replay
  templates, or redacted debug bundle for the opened workspace
- `change_summary`: return branch, changed-file counts, entries, and diff
  stats in one read-only call
- `repo_status`: read git status and optional diff without shell permission
- `git_changes`: return structured changed-file entries and counts for staged,
  unstaged, untracked, ignored, and renamed files
- `git_diff`: return bounded staged or unstaged diffs for the whole repository
  or selected workspace-validated pathspecs without shell permission
- `git_log`: return recent commits for the repository or selected
  workspace-validated pathspecs without shell permission
- `git_show`: return a bounded commit or object view for the repository or
  selected workspace-validated pathspecs without shell permission
- `git_stage` / `git_unstage`: update the Git index for selected
  workspace-validated paths without shell permission; these require `write`
  permission because they mutate repository state
- `git_commit`: create a Git commit from currently staged files after
  verifying every staged path is inside the workspace
- `git_worktree_list`: list Git worktrees for a repository path inside the
  workspace
- `git_worktree_create`: create an isolated Git worktree at a target path that
  must stay inside the workspace; this requires `write` permission and runs
  `git` directly rather than through the shell
- `read`: read a UTF-8 file with optional `startLine`, `lineCount`, and
  `maxBytes` bounds for large-file inspection; returns a full-file `sha256`.
  Common sensitive files are blocked by default.
- `read_many`: read several files in one bounded workspace-scoped call; each
  file includes a full-file `sha256`
- `create_file`: create a new UTF-8 file and fail if the target path already
  exists; intended for first-run probes and new files where overwriting would
  be unsafe
- `write_if_unchanged`: overwrite a file only when its current `sha256` still
  matches a value returned by a prior read
- `patch`: apply a unified diff after validating all touched paths stay inside
  the workspace
- `find_files`: fast file discovery
- `search_text`: line-based text search with glob, case, fixed-string, and
  before/after context options; common sensitive files are excluded from search
  by default
- `search_symbols`: structured symbol discovery for common programming
  languages, including functions, classes, interfaces, types, and enums
- `batch`: run up to 25 operations in order and return per-operation results
  without bypassing the permissions of each item
- `package_run`: run an existing `package.json` script through the detected
  package manager; this requires `shell` permission because package scripts can
  execute arbitrary local commands
- `package_start`: start an existing `package.json` script as a managed process
  for dev servers and watch tasks
- `process_start` / `process_list` / `process_read` / `process_stop`: manage
  long-running workspace shell processes such as dev servers and watch tasks
- `codex_start`: start a long-running managed Codex job that can be inspected
  or stopped with the same process operations
- `codex_plan` / `codex_review` / `codex_fix` / `codex_test` /
  `codex_continue`: higher-level Codex workflows that wrap `codex exec -` with
  stable prompts, workflow metadata, history/change context, and structured
  stdout/stderr results
- `codex_runs`: list persisted Codex workflow records for the workspace, or
  inspect one workflow id with bounded stdout/stderr previews, exit metadata,
  pre/post change summaries, and continuation history references

File, text, and symbol search prefer `rg` for fast candidate discovery and fall
back to built-in scanners if `rg` is missing. Future versions can back
`search_symbols` with language servers, ctags, or project indexes without
changing the workspace permission boundary.

## CLI/API Management

Workspace Linker is CLI-first. The CLI and JSON API are the administrative
surface for the same config file used by the MCP server:

- `workspace-linker status` shows the short daily readiness view: connection
  mode, local MCP URL, auth summary, workspace/tunnel summary, user-facing
  readiness, and the next few actions. `status --details` prints the full
  workspace rows, warnings, running tunnel rows, and all next actions.
- `workspace-linker self-test` creates an isolated temporary config/workspace,
  starts the loopback HTTP MCP server, runs the generic MCP SDK smoke flow, and
  exits non-zero when the installed CLI/server/tool flow is not working.
- `workspace-linker doctor` shows full runtime diagnostics, startup readiness,
  local MCP/API URLs, security findings, tool availability, release readiness,
  and next actions.
- `workspace-linker doctor --fix` applies deterministic local config repairs.
- `workspace-linker setup` and `workspace-linker start <folder>` initialize
  machine identity, owner token, workspace scopes, permissions, and default
  command policy.
- `workspace-linker config ...` shows and edits config values such as
  `publicBaseUrl` and per-workspace execution policy.
- `workspace-linker process list/read/stop` talks to the running local HTTP
  server and manages background command/Codex processes started through MCP.
- `workspace-linker screen status` reports screenshot provider readiness,
  permission status, supported modes, and screen-enabled workspaces without
  capturing pixels.
- `workspace-linker tunnel status` shows provider status, public URL detection,
  and managed tunnel process state.
- `workspace-linker history ...` reads recent events, sessions, failed replay
  templates, connection summaries, and redacted debug bundles.
- `workspace-linker client setup` prints a short generic MCP connection summary
  without using ChatGPT-specific profile formats. `client setup --details`
  prints tool names, first-prompt guidance, and copy-pasteable agent
  instructions. `--show-token` prints bearer headers only when explicitly
  requested on a trusted local setup screen. OpenAI Secure MCP Tunnel is treated
  as remote-ready without a public URL because the local tunnel client forwards
  the owner token to the private loopback MCP server.
- `workspace-linker client smoke` runs a generic HTTP/MCP reachability check.
  Local loopback smoke validates `/healthz`, authenticated JSON API
  capabilities, `get_computer_info`, one read-only `computer_operation`
  `file.list`, and an MCP SDK flow over `/mcp`: initialize, tools/list,
  `get_computer_info`, and one read-only `computer_operation`. Public HTTPS
  smoke skips JSON API checks but still runs the MCP SDK tool flow, matching
  the default MCP-only tunnel exposure.
- `workspace-linker diagnose client` is the product troubleshooting wrapper:
  it combines generic setup readiness, the same MCP SDK smoke flow, and
  redacted connection history into one local or remote diagnosis payload.
- `workspace-linker client chatgpt ...` exports profile/manifest/connector
  setup data; its smoke command is a thin compatibility wrapper over the same
  generic client smoke core.
- `/api/v1/control` exposes the same management/introspection contracts for
  local automation and compatibility connectors.

The management surface does not grant new capabilities by itself. It only
writes config or reports state; MCP tools still enforce workspace paths and
permissions at runtime.

Active sessions are tracked in memory and shown with auth type, client/user
agent, remote address, last seen time, and request count. A revoked session is
closed at the HTTP transport layer and removed from the active list. Audit
events remain the durable history.

## Tunnel Diagnostics

Workspace Linker treats tunnel providers as local CLIs rather than hidden services.
Each provider implements `detect`, `status`, `expose`, `getPublicUrl`, and
`stop`. The product-mode CLI entrypoint is `workspace-linker start`, which starts
local HTTP mode by default and starts a tunnel only when `--tunnel` is explicit.
When a tunnel is selected, `workspace-linker start --tunnel ...` and
`workspace-linker expose ...` enable `publicMcpOnly` before the HTTP server
listens so public-host requests expose `/mcp` only; local `/api/v1` and
`/healthz` remain available for CLI smoke checks.
Tailscale product-mode startup uses Funnel by default once selected;
`workspace-linker expose <provider>` remains as a lower-level compatibility
entrypoint:

- Cloudflare Quick Tunnel uses `cloudflared tunnel --url http://127.0.0.1:<port>`.
- Tailscale Funnel uses `tailscale funnel --yes <port>`.
- OpenAI Secure MCP Tunnel uses OpenAI's official `tunnel-client` with
  `--mcp.server-url url=http://127.0.0.1:<port>/mcp`.
- Tailscale Serve still exists at the provider layer for compatibility, but is
  not part of the default public ChatGPT flow.

`workspace-linker tunnel status --json`, `doctor`, capabilities, and ChatGPT
setup helpers all use this provider layer. Diagnostics include a serializable
`providerContracts` list with each provider's modes, commands, lifecycle
capabilities, and public URL sources, plus live provider status and managed
process output. Managed tunnel snapshots are persisted to `tunnels.json` under
the Workspace Linker config directory, which lets a separate CLI process show a
detected public URL in `tunnel status`, `doctor`, `capabilities`, and `client
chatgpt url`. Cloudflare custom hostnames are still configured explicitly as
`publicBaseUrl`. Tailscale Funnel startup can detect the `https://*.ts.net`
origin from the managed tunnel output and save it as `publicBaseUrl` for future
OAuth metadata. OpenAI Secure MCP Tunnel has no public URL source; on first CLI
startup Workspace Linker downloads the official `openai/tunnel-client` release
into its config directory, verifies the selected asset against
`SHA256SUMS.txt`, and runs that managed binary. It never scans user directories
such as Desktop for executables unless a path is explicitly provided with
`--tunnel-client` or `WORKSPACE_LINKER_OPENAI_TUNNEL_CLIENT`.

`workspace-linker start` and `workspace-linker expose` require an owner token
before starting a tunnel. Loopback
HTTP mode can run without a token for local-only development, and `init`,
`setup`, `start <folder>`, or `config token rotate` can generate the token
before exposure. Tunnel mode must not publish a loopback-only unauthenticated
server to the network. The direct bearer owner-token compatibility path reads
current config on each `/mcp` request, so token changes take effect immediately
for clients that send `Authorization: Bearer ...`. OAuth discovery and provider
state are created when HTTP mode starts; restart the server after token-state
changes for full OAuth client setup.

## Audit Log

Workspace Linker writes local JSONL audit events to `~/.workspace-linker/audit.jsonl`.
Events cover MCP sessions, workspace opens, tool calls, auth failures, admin
actions, success/failure, timing, workspace identifiers, operation names,
targets, paths, request paths, remote addresses, and command previews. File
contents, write payloads, screenshot image bytes, and tokens are not logged.
CLI/API history readers use this file directly, so history survives restarts and
can be exported or filtered without changing the permission boundary.
The generic `computer_operation` and compatibility `workspace_operation`
surfaces write into the same audit/history stream. Generic events keep the
dotted op name, resolved scope id/root, target, and mapped path so
`get_operation_history` and debug bundles work even when a client never calls
the older workspace tools.

Compatibility `batch` writes one outer `workspace_operation` event plus one
`workspace_operation.batch_item` event for each child operation. This preserves
the convenience of a single request while keeping the durable history detailed
enough to inspect which read, write, search, command, or Codex step succeeded
or failed.

Compatibility clients can also call `workspace_operation` with
`operation=history` to see recent events for the opened workspace.
Use `operation=history_insight` when an agent needs a compact last-operation
summary, a chronological workspace timeline, grouped session summaries, a
grouped tunnel/MCP connection summary, a failed-operation replay template, or a
redacted debug bundle to attach to a follow-up coding request. Replay
templates are stored as stable `workspace_operation` envelopes. Safe operations
such as package scripts can be retried directly; screenshot captures are marked
non-replayable because they can expose current screen pixels; raw shell commands
and Codex prompts are represented as templates with `requiresInput` because
full sensitive text is not written to the audit log.
For local support/debug workflows, the same redacted views are available through
`workspace-linker history --view last` and
`workspace-linker history --view debug_bundle --json --output <file>`.

Reachability is verified through CLI smoke checks. `workspace-linker doctor`
reports local readiness, `workspace-linker diagnose client` summarizes client
setup, MCP SDK smoke, and recent connection history, `workspace-linker client
smoke` verifies the configured local or public MCP origin,
local/trusted-private smoke also proves the authenticated `get_computer_info`
and read-only `computer_operation` contract, and `/api/v1/control` exposes
machine-readable readiness for automation.
