# Computer Linker Product Spec

## Status

This is the product boundary for Computer Linker.
When implementation details conflict with this document, the product should be
changed back toward this spec instead of expanding around accidental features.

## Product Goal

Computer Linker is a local MCP service installed on a user's computer.
It gives an AI client a controlled way to inspect and operate that computer.

The core product is not a ChatGPT dashboard, a web app, a tunnel manager, or a
workspace document system. Human setup and management should be CLI-first; MCP
and the JSON API are client protocol surfaces. The primary runtime is:

```text
AI client
  -> MCP
     -> Computer Linker running on this computer
        -> files, commands, Codex, screenshots, computer facts
```

## Core Jobs

Computer Linker must make these jobs reliable and easy:

1. Let a client ask what this computer can do.
2. Let a client read, write, list, and search files within configured bounds.
3. Let a client run commands under a clear local execution policy.
4. Let a client operate the local Codex CLI as a first-class workflow.
5. Let a client capture screenshots of the screen, a display, a window, or a
   process when the platform supports it.
6. Record what happened so the user can inspect and debug actions later.

## Non-Goals

These are not the core product:

- A dashboard or browser-first management app.
- A ChatGPT-specific product with many special endpoints.
- A general remote desktop replacement.
- A full OS sandbox. Computer Linker enforces its own policy, but shell,
  Codex, and screenshot operations still rely on local OS behavior.
- A cloud service. The service runs on the user's computer; tunnels only expose
  it when the user chooses to.

## Client Positioning

ChatGPT is a client, not the product axis.

Computer Linker should expose a generic MCP contract that works for ChatGPT,
Claude, Codex, a custom web UI, or any other MCP-capable client. ChatGPT setup
documentation may exist, but it must not drive the core architecture.

Correct framing:

- Product: local computer MCP service.
- Client: ChatGPT or any other MCP host.
- Setup helper: CLI/API URL, auth token, tunnel status, and smoke test.
- Not core: ChatGPT-specific manifests, model guides, or profile formats unless
  they are thin exports over the generic MCP contract.

## Product Model

One computer runs one Computer Linker service.
Each computer has:

- `machineId`: stable identifier.
- `machineName`: human-readable name.
- `capabilities`: OS, runtime, available tools, screenshot support, command
  policy, Codex availability, and configured file scopes.
- `policy`: what the client is allowed to do.
- `history`: audit log of operations and outcomes.

The product should support Windows, macOS, and Linux. Platform differences are
reported through capabilities instead of hidden behind failed calls.

## Terminology

- **Computer**: the physical or virtual machine running Computer Linker.
- **Client**: any MCP host or automation tool connected to Computer Linker.
- **Scope**: a named permission boundary. A scope can point at a folder, a
  project, a command policy, screenshot permission, or a broader computer
  profile. Existing `workspace` language maps to a folder-backed scope.
- **Operation**: one requested action inside a scope.
- **Provider**: platform-specific implementation for files, commands, Codex,
  screenshots, process lookup, or system facts.
- **Managed process**: a command or Codex session started by Computer Linker
  and tracked for later read/stop/list operations.

Use `scope` in the product contract. Keep `workspace` only as a compatibility
term for existing folder-backed integrations.

## System Architecture

Computer Linker has these runtime components:

1. **Transport adapters**
   - stdio MCP server.
   - HTTP MCP server.
   - optional local JSON API for non-MCP clients.
2. **Tool router**
   - exposes the small public MCP tool surface.
   - validates the outer request shape.
   - forwards operations to the dispatcher.
3. **Policy engine**
   - loads configured scopes.
   - resolves capabilities.
   - denies operations before provider execution.
   - enforces file roots for file operations.
   - applies command/Codex/screenshot policy.
4. **Operation dispatcher**
   - normalizes `{ scope, op, target, input, options }`.
   - selects the provider.
   - applies operation limits.
   - returns the standard result envelope.
5. **Providers**
   - file provider.
   - search provider, preferring `ripgrep`.
   - command/process provider.
   - Codex provider.
   - screenshot provider.
   - computer-info provider.
6. **Audit store**
   - records every operation.
   - supports recent history, session timeline, and debug bundle export.
7. **Management UI and CLI**
   - configure scopes and policy.
   - show status.
   - start/stop service helpers.
   - do not define the product API.

## Configuration Model

The durable config should describe one computer and its scopes:

```json
{
  "machineId": "stable-machine-id",
  "machineName": "desktop-pc",
  "host": "127.0.0.1",
  "port": 3939,
  "ownerToken": "secret-or-null",
  "scopes": [
    {
      "id": "app",
      "name": "Main app",
      "type": "folder",
      "roots": ["/Users/me/work/app"],
      "capabilities": [
        "fs:read",
        "fs:write",
        "command:run",
        "process:manage",
        "codex:run"
      ],
      "policy": {
        "maxRuntimeSeconds": 1800,
        "maxOutputBytes": 200000,
        "allowedCommands": ["npm *", "pnpm *", "yarn *", "bun *", "node *", "npx *", "git *", "codex *"],
        "deniedCommands": ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"]
      }
    },
    {
      "id": "screen",
      "name": "Screen capture",
      "type": "computer",
      "capabilities": ["screen:capture"],
      "policy": {
        "allowDisplays": true,
        "allowWindows": true,
        "allowProcesses": true
      }
    }
  ]
}
```

Rules:

- `machineId` must be created once and stay stable.
- `scope.id` is the stable target clients use.
- `roots` are required for folder scopes.
- no operation may silently fall back to unrestricted global access.
- compatibility config may still store `workspaces`, but runtime should expose
  them as folder-backed scopes.

## Public MCP Surface

Keep the MCP tool surface small. Prefer a stable operation envelope over many
specialized tools.

Recommended v1 MCP tools:

- `get_computer_info`: return identity, OS/runtime, capabilities, policy, and
  current readiness.
- `computer_operation`: run file, command, Codex, screenshot, or history
  operations through one stable envelope.
- `get_operation_history`: retrieve recent audit/session history.

Compatibility tools can exist while migrating, but they must be opt-in and new
clients should not need more than the small surface above.

### `get_computer_info`

Input:

```json
{
  "include": ["identity", "platform", "tools", "scopes", "policy", "status"]
}
```

Output:

```json
{
  "machineId": "stable-machine-id",
  "machineName": "desktop-pc",
  "platform": {
    "os": "darwin",
    "arch": "arm64",
    "release": "26.0",
    "shell": "/bin/zsh"
  },
  "service": {
    "version": "0.1.0",
    "transports": ["stdio", "http"],
    "localUrl": "http://127.0.0.1:3939/mcp",
    "publicUrl": null
  },
  "tools": {
    "rg": { "available": true, "path": "/opt/homebrew/bin/rg" },
    "git": { "available": true },
    "codex": { "available": true },
    "screenshot": { "available": true, "modes": ["display", "window"] }
  },
  "scopes": [
    {
      "id": "app",
      "name": "Main app",
      "type": "folder",
      "capabilities": ["fs:read", "fs:write", "command:run"]
    }
  ],
  "status": {
    "ready": true,
    "blockingReasons": [],
    "warnings": []
  }
}
```

### `computer_operation`

Input is the operation envelope defined below.
Output is the standard operation result envelope.

### `get_operation_history`

Input:

```json
{
  "scope": "app",
  "view": "last",
  "limit": 50,
  "query": "npm test"
}
```

Supported views:

- `last`
- `timeline`
- `sessions`
- `connections`
- `failed_replay`
- `debug_bundle`

Output must not include secrets, full file contents, screenshot pixels, or raw
command output unless explicitly requested and permitted.

## Operation Envelope

All operations should fit this shape:

```json
{
  "scope": "default",
  "op": "file.read",
  "target": "src/index.ts",
  "input": {},
  "options": {}
}
```

Field rules:

- `scope`: named policy scope. It can map to a folder, a project, or broader
  computer permission. It must be explicit; no hidden global access.
- `op`: stable operation name.
- `target`: the primary path, command working directory, process id, display id,
  window id, or Codex session id.
- `input`: operation-specific data.
- `options`: limits, filters, output format, timeout, and safety controls.

The outer envelope should stay stable even when individual operations evolve.

## Operation Result Envelope

Every operation returns the same outer shape:

```json
{
  "ok": true,
  "operationId": "01J...",
  "scope": "app",
  "op": "file.read",
  "startedAt": "2026-06-23T00:00:00.000Z",
  "durationMs": 12,
  "data": {},
  "warnings": []
}
```

Failures return:

```json
{
  "ok": false,
  "operationId": "01J...",
  "scope": "app",
  "op": "command.run",
  "error": {
    "code": "permission_denied",
    "message": "Scope app does not allow command:run.",
    "retryable": false,
    "details": {}
  }
}
```

Required error codes:

- `invalid_request`
- `unknown_scope`
- `unknown_operation`
- `permission_denied`
- `path_out_of_scope`
- `unsupported_platform`
- `provider_unavailable`
- `timeout`
- `process_not_found`
- `os_permission_required`
- `execution_failed`

Non-zero command or Codex exit codes are `ok: true` when the operation executed
successfully and the diagnostic output is returned. Use `data.exitCode` to
represent the command result.

## Core Operations

### Computer Info

Required:

- machine identity.
- OS, architecture, shell, current user context where safe.
- Node/runtime version.
- available tools: `rg`, `git`, package managers, `codex`.
- configured scopes.
- command policy summary.
- screenshot capability summary.
- current service URLs and exposure state when available.

### File Operations

Required:

- `file.stat`
- `file.list`
- `file.tree`
- `file.read`
- `file.read_many`
- `file.write`
- `file.create`
- `file.patch`
- `file.move`
- `file.delete`
- `file.find`
- `file.search`

File operations must enforce configured bounds before touching the filesystem.
Fast search should use `ripgrep` when available, with a safe fallback.

Contract details:

- `target` is always scope-relative for folder scopes.
- `options.maxBytes` limits returned content.
- `options.encoding` defaults to `utf8`; binary reads return base64 only when
  requested.
- `file.write` creates parent directories only when `options.createParents` is
  true.
- `file.create` creates a new file only and must fail without overwriting when
  the target already exists.
- `file.patch` accepts unified diff or structured replacement input.
- `file.delete` requires `options.recursive` for directories.
- `file.find` supports `input.pattern` and `options.maxResults`.
- `file.search` supports `input.query`, `options.glob`, `options.maxResults`,
  and `options.ignoreCase`.

Representative result shapes:

```json
{
  "path": "src/index.ts",
  "content": "...",
  "sha256": "hex",
  "truncated": false
}
```

```json
{
  "matches": [
    {
      "path": "src/index.ts",
      "line": 12,
      "column": 4,
      "preview": "const value = ..."
    }
  ],
  "engine": "rg"
}
```

### Coding And Repository Operations

Computer Linker also exposes coding-oriented dotted ops over the same stable
`computer_operation` envelope:

- `code.context`: bounded project orientation for coding tasks.
- `code.search_symbols`: symbol discovery for common source languages.
- `git.status`: repository status and optional bounded diff.
- `git.changes`: structured changed-file entries.
- `git.diff`: bounded staged or unstaged diff.
- `git.log`: recent commits.
- `git.show`: bounded commit or object view.
- `git.stage` / `git.unstage`: mutate the index for scoped paths.
- `git.commit`: commit already staged scoped files.
- `package.run`: run an existing `package.json` script.
- `package.start`: start an existing `package.json` script as a managed
  process.

These are product-level generic names. Compatibility workspace operation names
such as `coding_context`, `repo_status`, `git_diff`, and `package_run` remain
accepted while older clients migrate.

### Command Operations

Required:

- `command.run`: run and wait for completion.
- `command.start`: start a managed long-running process.
- `command.read`: read process output.
- `command.stop`: stop a managed process.
- `command.list`: list managed processes.
- `process.start`: domain alias for starting managed processes.
- `process.read`: domain alias for reading managed process output.
- `process.stop`: domain alias for stopping managed processes.
- `process.list`: domain alias for listing managed processes.

Command execution is dangerous and should be policy-driven:

- allowed scopes and working directories.
- timeout and max output.
- environment filtering.
- optional allowlist/denylist.
- explicit indication that commands are not filesystem-sandboxed unless an
  external sandbox is configured.

Contract details:

- `target` is the working directory, relative to a folder-backed scope unless
  the scope explicitly allows broader command execution.
- `input.command` is the command string or argv array.
- `options.timeoutSeconds` must default to a finite value.
- `options.maxOutputBytes` must default to a finite value.
- stdout/stderr are captured separately.
- managed processes get a stable `processId`.
- process output is retained in a bounded ring buffer.

`command.run` result:

```json
{
  "exitCode": 0,
  "signal": null,
  "timedOut": false,
  "stdout": "...",
  "stderr": "...",
  "durationMs": 1200
}
```

`command.start` result:

```json
{
  "processId": "proc_...",
  "status": "running",
  "commandPreview": "npm run dev",
  "startedAt": "2026-06-23T00:00:00.000Z"
}
```

### Codex Operations

Required:

- `codex.run`: run a prompt in a scope.
- `codex.start`: start a managed Codex process/session.
- `codex.read`: read session output/status.
- `codex.stop`: stop a session.
- `codex.list`: list recent sessions.

Higher-level workflows such as plan, review, fix, and test are allowed, but
they should remain wrappers around the core Codex operations rather than
expanding the public surface.

Contract details:

- `target` is the working directory or existing Codex session id, depending on
  the operation.
- `input.prompt` is required for `codex.run` and `codex.start`.
- Codex runs inherit command policy plus `codex:run`.
- Codex must run with the configured current working directory.
- all Codex stdout/stderr and final status are stored in history.
- writes made by Codex are not separately trusted; clients should inspect diffs
  after Codex runs.

`codex.run` result:

```json
{
  "sessionId": "codex_...",
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "diffSummary": {
    "changedFiles": 2,
    "insertions": 20,
    "deletions": 4
  }
}
```

### Screenshot Operations

Required:

- `screen.capture`: capture full screen or selected display.
- `screen.list`: list displays and capturable windows/processes when available.
- `screen.capture_window`: capture a specific window when supported.
- `screen.capture_process`: capture the visible window for a process when
  supported.

Screenshot results should return metadata and either image bytes or a temporary
file reference, depending on transport limits.

Safety requirements:

- report platform permission state.
- fail clearly when the OS blocks screen recording.
- allow future redaction/masking before returning images.
- audit every screenshot request.

Contract details:

- `screen.list` returns displays, windows, and process/window mappings when
  available.
- `screen.capture` uses `target` as display id or `primary`.
- `screen.capture_window` uses `target` as window id.
- `screen.capture_process` uses `target` as process id or process name and
  captures that process's active visible window when possible.
- `options.format` supports `png` first. `jpeg` is optional.
- `options.maxWidth` and `options.maxHeight` can downscale before returning.
- `options.return` is `bytes`, `base64`, or `fileRef`.

`screen.list` result:

```json
{
  "permission": {
    "status": "granted",
    "detail": null
  },
  "displays": [
    { "id": "display-1", "primary": true, "width": 3024, "height": 1964 }
  ],
  "windows": [
    {
      "id": "window-1",
      "title": "Terminal",
      "processId": 123,
      "processName": "Terminal"
    }
  ]
}
```

`screen.capture` result:

```json
{
  "format": "png",
  "width": 1512,
  "height": 982,
  "bytesBase64": "...",
  "source": {
    "type": "display",
    "id": "display-1"
  }
}
```

Platform expectations:

- macOS: use Screen Recording permission; report `os_permission_required` when
  not granted.
- Windows: use a Windows capture provider for display/window capture; process
  capture resolves to the best matching visible window.
- Linux: support depends on desktop/session. Wayland may require portal
  permission; X11 support may be broader but less secure.

## Policy Model

Policy should be capability-based, not only booleans.

Examples:

- `fs:read`
- `fs:write`
- `command:run`
- `process:manage`
- `codex:run`
- `screen:capture`
- `network:false`
- `maxRuntimeSeconds`
- `maxOutputBytes`
- `allowedRoots`
- `allowedCommands`
- `deniedCommands`

Default policy should be conservative:

- loopback-only service.
- no public exposure without owner token.
- file access limited to configured scopes.
- command, Codex, and screenshot disabled unless explicitly enabled.
- first-run product setup with an explicit folder should remove the bootstrap
  `current` scope and expose only the requested folder.
- when product setup enables command or Codex execution, attach a default
  command policy with allowlisted project commands plus runtime and output caps.

Policy evaluation order:

1. Resolve `scope`.
2. Check operation exists.
3. Check required capability.
4. Check scope type supports the operation.
5. Check path, command, process, Codex, or screenshot-specific policy.
6. Apply runtime limits.
7. Execute provider.
8. Audit result.

Capability requirements:

- `file.stat`, `file.list`, `file.tree`, `file.read`, `file.read_many`,
  `file.find`, `file.search`, `code.context`, `code.search_symbols`,
  `git.status`, `git.changes`, `git.diff`, `git.log`, and `git.show` require
  read-oriented capabilities such as `fs:read`, `search:read`, `history:read`,
  or `git:read`.
- `file.write`, `file.create`, `file.patch`, `file.move`, `file.delete`
  require `fs:write`.
- `git.stage`, `git.unstage`, and `git.commit` require `git:write`.
- `package.run`, `package.start`, `command.run`, and `process.start` require
  `command:run` or `package:run` according to scope policy.
- `command.start` requires `command:run` and `process:manage`.
- `command.read`, `command.stop`, `command.list`, `process.read`,
  `process.stop`, and `process.list` require `process:manage`.
- `codex.run`, `codex.start` require `codex:run`.
- `codex.read`, `codex.stop`, `codex.list` require `codex:run`.
- `screen.list`, `screen.capture`, `screen.capture_window`,
  `screen.capture_process` require `screen:capture`.
- `history.*` requires `history:read`.

Path checks are mandatory for file operations. Command and Codex operations are
working-directory scoped, not filesystem sandboxed, unless an external sandbox
provider is explicitly configured and reported in capabilities.

## History And Audit

Every operation should write an audit event:

- timestamp.
- machine id.
- scope.
- operation.
- target preview.
- permission/capability used.
- success/failure.
- duration.
- output summary.
- redacted error details.

History must support:

- last operation.
- session timeline.
- managed process/Codex session history.
- failed operation replay templates when safe.
- debug bundle export without secrets or file contents by default.

History views:

- `last`: most recent operation plus suggested next actions.
- `timeline`: chronological event list.
- `sessions`: grouped by client session, scope, command process, or Codex
  session.
- `connections`: grouped tunnel and MCP connection summaries with session and
  request IDs where the tunnel provider exposes them.
- `failed_replay`: failed operations that can be retried with missing sensitive
  input supplied by the caller.
- `debug_bundle`: redacted support bundle.

Redaction rules:

- never store owner tokens.
- never store full file write payloads by default.
- never store screenshot image bytes by default.
- command/Codex output is bounded and may be redacted in debug bundles.
- screenshot capture replay templates must not be directly replayable because a
  replay would capture the current screen, not the historical pixels.
- replay templates must omit sensitive fields such as file content, command
  secrets, and Codex prompts when marked sensitive.

## Transports And Exposure

Required transports:

- stdio MCP for local clients.
- HTTP MCP for remote/tunnel clients.

Exposure helpers are allowed but secondary:

- Cloudflare Tunnel.
- Tailscale Funnel.
- manual reverse proxy.

The product should always make clear which URL a client should use, whether it
is local or public, and what auth is required.
Public URL providers and OpenAI Secure MCP Tunnel are different exposure
models: OpenAI tunnel setup uses a `tunnel_...` id and should not require or
warn about `publicBaseUrl` in daily status unless another public URL provider is
being used.

Auth rules:

- stdio transport relies on local process/user trust.
- HTTP loopback may run without owner token only when bound to loopback.
- any non-loopback HTTP exposure requires owner token or stronger auth.
- bearer token is acceptable for v1.
- OAuth metadata can exist as compatibility, but must wrap the same generic MCP
  contract and must not add ChatGPT-specific semantics.

Smoke tests:

- installed CLI check using a temporary config and workspace.
- local MCP initialize, tools/list, `get_computer_info`, and read-only
  `computer_operation` through the MCP SDK.
- HTTP `/healthz`.
- authenticated `get_computer_info`.
- one read-only operation in a configured scope.
- screenshot capability probe without capturing pixels unless explicitly
  requested.

## Management Surface

The human management surface is CLI-first:

- service status.
- policy/scopes.
- tool readiness.
- tunnel/exposure status.
- history.
- active processes.
- screenshot permission diagnostics.

The product should not rely on a local browser dashboard for setup or
operations. The JSON API remains a protocol surface for MCP clients,
automation, and smoke checks rather than a human-facing management UI.
The default CLI help should stay short and focused on first-run `here`,
explicit-path start, tunnel selection, client setup, status, and quickstart
preview. Self-test, smoke, repair, service/config/API, history, and
compatibility commands remain available through advanced or focused help topics
rather than the first-run surface.

Required management actions:

- initialize machine identity.
- create/edit/remove scopes.
- enable/disable capabilities per scope.
- show exact MCP URLs.
- generate/rotate owner token.
- run local smoke tests.
- display screenshot permission status.
- list/stop managed command and Codex processes.
- inspect/export redacted history.

## Platform Requirements

### Windows

Required:

- file operations.
- command/process management.
- Codex invocation when installed.
- computer info.
- display screenshot capability probe.
- primary-display screenshot capture in an interactive desktop session.

Target:

- active-window screenshot.
- process-to-window screenshot when a visible window can be resolved.

### macOS

Required:

- file operations.
- command/process management.
- Codex invocation when installed.
- computer info.
- screenshot permission probe.

Target:

- display screenshot.
- window screenshot.
- process-to-window screenshot through visible window metadata.

### Linux

Required:

- file operations.
- command/process management.
- Codex invocation when installed.
- computer info.
- screenshot capability probe.

Target:

- screenshot through the active desktop/session provider where available.
- clear unsupported/permission errors under Wayland or headless environments.

## Implementation Priority

Implement in this order:

1. Normalize product language around computer, scope, operation, and policy.
2. Expose the small MCP surface while keeping existing tools as compatibility.
3. Implement `get_computer_info` from current capabilities.
4. Implement `computer_operation` as the generic dispatcher.
5. Map existing file/search/command/Codex operations into dotted operation
   names.
6. Add screenshot capability probe and full-screen capture.
7. Add window/process screenshot support by platform.
8. Tighten history/debug bundle around the new operation envelope.
9. Trim ChatGPT-specific code paths to thin setup exports over the generic MCP
   contract.

## First Product Milestone

The first productized milestone is complete only when these are true:

1. A user can install/run one local MCP service on Windows/macOS/Linux.
2. A client can call a small MCP surface and discover computer capabilities.
3. File read/write/list/search works inside configured scopes.
4. Commands can run under policy with timeout/output limits.
5. Codex can be run and inspected as a managed workflow.
6. Full-screen screenshot works on at least one platform and reports capability
   status on the others.
7. History shows every operation and can export a redacted debug bundle.
8. Local and HTTP transports are documented and smoke-testable.
9. `status` exposes short daily readiness for humans and scripts, while
   `status --details` keeps diagnostic rows out of the default view. `doctor`
   exposes release readiness, config diagnostics, and security diagnostics that
   can block an alpha release before packaging or exposure, and `doctor --fix`
   can apply deterministic local config repairs.
10. The default CI gate is cost-capped but automatic: it runs the product gate
    on Windows with the primary supported Node line for `main` pushes and pull
    requests. Broader OS or Node coverage is a wider-release check, not the
    routine gate. Release packaging remains a manually dispatched workflow.

Anything outside this list should be treated as supporting work, not the center
of the product.
