# API Compatibility

Computer Linker is still `0.x`, but the public MCP surface is intentionally
small and treated as the product contract.

## Stable MCP Surface

Default MCP clients should use only these tools:

- `get_computer_info`
- `computer_operation`
- `get_operation_history`

The stable `computer_operation` request envelope is:

```json
{
  "scope": "workspace-id",
  "op": "file.list",
  "target": ".",
  "input": {},
  "options": {}
}
```

The stable operation result envelope includes:

- `ok`
- `operationId`
- `scope`
- `op`
- `startedAt`
- `durationMs`
- `data`
- `error`
- `warnings`

New dotted operations, new optional fields, and additional diagnostic metadata
are non-breaking additions.

## Compatibility Tools

Tools such as `list_workspaces`, `open_workspace`, and `workspace_operation`
exist for older clients and migration. New clients should not depend on them
unless a specific MCP client cannot use the generic `computer_operation`
contract.

Removing or renaming a default MCP tool, removing required envelope fields, or
changing operation semantics is a breaking change and must be called out in the
changelog.

## JSON API

The JSON API under `/api/v1` is for local and trusted-private diagnostics,
SDK usage, and health checks. Public cloud exposure should route only `/mcp`
unless an operator intentionally exposes more.
