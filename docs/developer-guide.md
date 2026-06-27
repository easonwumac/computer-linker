# Developer Guide

Computer Linker should stay modular around product responsibilities, not around
individual MCP clients. Use this guide when adding or moving code.

## Module Boundaries

- CLI commands live in `src/cli.ts`. Keep command dispatch and human output
  there, but move reusable behavior into focused modules.
- CLI support modules are `src/cli-format.ts` for command display,
  `src/cli-options.ts` for flag parsing, and `src/cli-permissions.ts` for
  permission presets plus default execution policy.
- Config and workspace scope rules live in `src/config.ts`,
  `src/permissions.ts`, `src/workspaces.ts`, and `src/workspace-roots.ts`.
- Protocol shape lives in `src/computer-contract.ts`,
  `src/computer-operation-registry.ts`, `src/mcp-surface.ts`, and
  `src/server.ts`.
- Local operation providers live in focused modules such as `src/search.ts`,
  `src/processes.ts`, `src/codex-runs.ts`, `src/screenshot.ts`, and
  `src/sensitive-files.ts`. Keep output filtering in provider helpers such as
  `src/git-output.ts` instead of embedding parsing/redaction logic in the
  workspace operation dispatcher.
- Public exposure belongs in `src/tunnels.ts`, OAuth/auth modules, and public
  MCP-only tests.
- Release and package checks belong in `scripts/*.mjs`.

When a new behavior is used by both the CLI and the MCP server, create a small
module instead of putting the behavior in `src/cli.ts`.

When a CLI-only helper starts being reused by multiple commands, move it to one
of the existing `src/cli-*.ts` support modules or create a similarly focused
module. Avoid adding more cross-cutting helpers to the bottom of `src/cli.ts`.

## Provider Extraction Rules

`src/workspace-operations.ts` should stay responsible for permission checks,
path resolution, and dispatch. When an operation needs protocol-independent
parsing, redaction, process management, search behavior, screenshot handling, or
tool installation, put that behavior in a focused provider module and call it
from the dispatcher.

Tests should cover the public operation boundary and the extracted provider
logic when the provider has non-trivial parsing or safety behavior.

## Adding An Operation

1. Define the operation metadata in `src/computer-operation-registry.ts`.
2. Implement provider behavior in the most specific provider module. Create a
   new module only when no existing provider owns the behavior.
3. Route it from `src/workspace-operations.ts` or the computer operation
   dispatcher.
4. Add tests at the contract boundary first, then provider-focused tests when
   there is policy, filesystem, command, or redaction risk.
5. Update [agent-instructions.md](agent-instructions.md),
   [api-compatibility.md](api-compatibility.md), and the JSON schema when the
   public MCP contract changes.

## Adding A CLI Flow

Prefer one human command for the common path and keep lower-level commands in
focused help topics. For example, `here` and `start <folder>` own daily setup;
`serve`, `workspace`, `config`, and `service` remain diagnostic or advanced
commands.

CLI flows that create local state should call shared helpers. For workspace
roots, use `ensureWorkspaceRootDirectory` only in explicit setup commands. MCP
read/open paths should validate configured roots without creating directories.

## Documentation Updates

Update docs in the same change as behavior:

- README for quick path changes.
- `docs/getting-started.md` for install and first-use changes.
- `docs/client-recipes.md` for MCP client setup changes.
- `docs/architecture.md` or this guide for module or boundary changes.
- `docs/release-checklist.md` and `CHANGELOG.md` for release gate changes.

Keep examples cross-platform when a command is likely to be copied by Windows
and macOS/Linux users.
