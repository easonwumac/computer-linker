# Command Policy

Command policy applies to shell-enabled scopes. It is checked before raw shell
commands, managed processes, package scripts, and Codex operations launch.

Computer Linker is not an OS sandbox. Shell, package, process, and Codex
operations start in the configured scope, but the host process can still use
normal OS and network access unless external controls block it.

## Default Rule

For normal coding scopes, Computer Linker creates a policy like this:

```json
{
  "maxRuntimeSeconds": 600,
  "maxOutputBytes": 200000,
  "allowedCommands": ["npm *", "pnpm *", "yarn *", "bun *", "node *", "npx *", "git *"],
  "deniedCommands": ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"],
  "allowShellMetacharacters": false
}
```

`allowedCommands` and `deniedCommands` use simple wildcard matching against the
normalized command text. `deniedCommands` wins over `allowedCommands`.

Shell metacharacters are blocked unless `allowShellMetacharacters` is explicitly
enabled. This keeps broad patterns such as `npm *` and `git *` from permitting
chained commands.

Blocked by default:

```text
npm test && echo unsafe
git status; echo unsafe
npm test | more
npm test > out.txt
npm test $(echo unsafe)
```

Allowed when the allowlist matches:

```text
npm test
git status
node scripts/check.mjs
```

## Inspect Or Update Policy

Read the current policy:

```powershell
computer-linker config policy app --json
```

Set a compact coding policy:

```powershell
computer-linker config policy app --allow "npm *" --allow "git *" --allow "node scripts/*" --deny "rm -rf *" --max-runtime-seconds 600 --max-output-bytes 200000
```

Keep shell metacharacters blocked:

```powershell
computer-linker config policy app --block-shell-metacharacters
```

Only for a fully trusted scope, allow advanced shell syntax:

```powershell
computer-linker config policy app --allow-shell-metacharacters
```

## Recommended Pattern For Complex Commands

Prefer a checked-in script over raw shell chaining:

```json
{
  "scripts": {
    "verify": "npm run lint && npm test"
  }
}
```

Then ask agents to call `package.run`:

```json
{
  "scope": "app",
  "op": "package.run",
  "target": ".",
  "input": {
    "script": "verify"
  },
  "options": {
    "timeoutSeconds": 600
  }
}
```

This keeps the MCP operation simple while the repository owns the exact command
sequence.

## Safety Checklist

- Enable `shell` only on folders you trust.
- Keep `allowedCommands` narrow.
- Keep `maxRuntimeSeconds` and `maxOutputBytes` finite.
- Leave `allowShellMetacharacters` disabled unless a trusted scope genuinely
  needs raw shell syntax.
- Prefer `package.run`, Git operations, search operations, and file operations
  before `command.run`.
