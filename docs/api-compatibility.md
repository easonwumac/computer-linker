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

## Discovery Split

`get_computer_info`, `/api/v1/capabilities`, and SDK `connectReadiness()`
expose machine-readable discovery with `primary` and `compatibility` sections.
New clients should read `discovery.primary` first:

- `primary.mcpTools`: `get_computer_info`, `computer_operation`,
  `get_operation_history`
- `primary.jsonApi.preferredAction`: `computer_operation` for local or
  trusted-private JSON API clients
- `primary.registries`: the generic `computerOperationRegistry` and
  `get_computer_info.operationRegistry`

`discovery.compatibility` keeps older workspace tools, actions, endpoints, and
registries discoverable for migration. Compatibility entries are not the
recommended product path.

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
