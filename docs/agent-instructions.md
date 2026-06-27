# Agent Instructions

Use these instructions when connecting an MCP-capable agent to Computer
Linker.

## First Call

Call `get_computer_info` before any workspace action. Read:

- available scopes
- scope ids, names, display paths, and path privacy
- permissions
- `computerOperationRegistry`
- local/public MCP URL status
- safety boundaries

## Normal Flow

1. Choose one scope from `get_computer_info`.
2. Call `computer_operation` with the generic envelope:

```json
{
  "scope": "workspace-id",
  "op": "file.tree",
  "target": ".",
  "input": {},
  "options": {
    "maxDepth": 2,
    "maxEntries": 80
  }
}
```

3. Use dotted operation names from `computerOperationRegistry`.
4. Use write, shell, command, Codex, or screen operations only when the selected
   scope reports the required permission.
5. Call `get_operation_history` when debugging recent actions or connection
   behavior.

## Preferred Operations

- Inspect files: `file.tree`, `file.read`, `file.search`
- Edit files: `file.write`, `file.edit`, `file.patch`
- Git inspection: `git.status`, `git.diff`
- Git mutation: `git.stage`, `git.commit`
- Package commands: `package.run`
- Shell command: `command.run`

The exact list can grow. Always prefer names returned by
`computerOperationRegistry`.

## Sensitive Files

Do not request secrets unless the user explicitly asks outside Workspace
Linker. Direct reads and text searches block common sensitive files by default,
including `.env*`, private keys, credential JSON files, and cloud CLI
credential folders. Git diff/show/status output redacts sensitive diff blocks
before returning content. Treat missing matches or redacted diff blocks in
those files as an intentional safety boundary.

## Avoid By Default

Do not call compatibility tools such as `list_workspaces`, `open_workspace`, or
`workspace_operation` unless the MCP client cannot send the generic
`computer_operation` envelope.

Do not assume shell or write access. Computer Linker may expose read-only,
coding, or full-trust scopes.

Default `get_computer_info` redacts full local folder roots. Choose scopes by
`id` and `name`; do not require absolute local paths before operating. Request
`include:["roots"]` only when the user explicitly needs local owner diagnostics.
