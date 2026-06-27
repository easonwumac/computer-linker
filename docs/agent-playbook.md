# Agent Playbook

Use this playbook as the operating guide for an MCP-capable agent connected to
Computer Linker. For a shorter pasteable prompt, use
[Agent Instructions](agent-instructions.md).

## Startup Flow

1. Call `get_computer_info`.
2. Choose one returned `scope` by id or name.
3. Read `computerOperationRegistry` before choosing operation names.
4. Call `computer_operation` with `{ scope, op, target, input, options }`.
5. Call `get_operation_history` when debugging recent actions or connection
   behavior.

Do not require absolute local paths. Default `get_computer_info` intentionally
redacts full roots for privacy.

## First Prompt

```text
Use Computer Linker through the generic MCP contract.
First call get_computer_info and choose one reported scope.
Use computer_operation with dotted operation names from computerOperationRegistry.
Prefer code.context, file.tree, file.search, file.read, git.status, and git.diff before edits.
Use write, command, package, Codex, or screen operations only when the selected scope reports the required permission.
Use get_operation_history when connection or operation behavior is unclear.
Do not call compatibility tools unless the server explicitly exposes them.
```

## Common Workflows

Project orientation:

```json
{
  "scope": "my-app",
  "op": "code.context",
  "target": ".",
  "input": {},
  "options": {
    "maxDepth": 2,
    "maxEntries": 100
  }
}
```

Search before reading:

```json
{
  "scope": "my-app",
  "op": "file.search",
  "target": ".",
  "input": {
    "query": "TODO",
    "glob": "src/**/*.ts"
  },
  "options": {
    "maxResults": 20
  }
}
```

Read one file:

```json
{
  "scope": "my-app",
  "op": "file.read",
  "target": "README.md",
  "input": {},
  "options": {
    "maxBytes": 65536
  }
}
```

Review local changes:

```json
{
  "scope": "my-app",
  "op": "git.diff",
  "target": ".",
  "input": {},
  "options": {
    "maxBytes": 65536
  }
}
```

Run tests when command execution is allowed:

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

Inspect history:

```json
{
  "scope": "my-app",
  "op": "history.last",
  "target": ".",
  "input": {},
  "options": {
    "maxResults": 20
  }
}
```

## Safety Rules

- Stay inside the selected scope.
- Prefer read-only operations before mutation.
- Treat write, shell, package, Codex, and screen operations as explicit trust
  boundaries.
- Do not treat `network:false` as network isolation. Host processes may still
  use the host network unless an external OS, container, firewall, proxy, or
  network policy blocks them.
- Do not ask for secrets. Direct reads and text searches block common
  sensitive files by default, and Git output redacts sensitive diff blocks.
- Do not call `workspace_operation`, `read`, `ls`, `grep`, `glob`, or
  `create_file` unless compatibility tools are explicitly exposed.

## Failure Handling

When an operation is denied, inspect the reported permissions and registry
metadata instead of retrying with broader operations.

When connection behavior is unclear:

1. Call `get_operation_history`.
2. Ask the user to run `computer-linker status --details`.
3. Ask the user to run `computer-linker diagnose client`.

Do not rotate tokens, change tunnel settings, or start new tunnels unless the
user asks for that administrative action.
