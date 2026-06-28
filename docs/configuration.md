# Configuration

Normal setup commands manage `~/.computer-linker/config.json` for you:

```bash
computer-linker here
computer-linker start /path/to/project
computer-linker config policy app --json
computer-linker config validate
```

Edit `config.json` by hand only for advanced service deployments or scripted
workstation setup. Validate manual edits before starting the server:

```bash
computer-linker config validate
computer-linker config validate --json
```

The published JSON Schema is:

```text
docs/config.schema.json
```

Use it in editors or scripts that support JSON Schema.

`scopes[]` is the primary config model. Today every scope is `type:"folder"`.
Computer Linker also writes `workspaces[]` as a `0.x` compatibility mirror for
older tools. When both fields are present, `scopes[]` is the source of truth.

## Read-Only Scope

```json
{
  "machineName": "office",
  "scopes": [
    {
      "type": "folder",
      "id": "app",
      "name": "App",
      "path": "C:\\Projects\\my-app",
      "permissions": {
        "read": true,
        "write": false,
        "shell": false,
        "codex": false,
        "screen": false
      }
    }
  ]
}
```

## Coding Scope

```json
{
  "machineName": "office",
  "ownerToken": "replace-with-generated-token",
  "scopes": [
    {
      "type": "folder",
      "id": "app",
      "name": "App",
      "path": "C:\\Projects\\my-app",
      "permissions": {
        "read": true,
        "write": true,
        "shell": true,
        "codex": false,
        "screen": false
      },
      "policy": {
        "allowedCommands": ["npm *", "pnpm *", "yarn *", "bun *", "node *", "npx *", "git *"],
        "deniedCommands": ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"],
        "allowedPackageScripts": ["*"],
        "deniedPackageScripts": ["deploy", "deploy:*", "publish", "publish:*", "release", "release:*"],
        "maxRuntimeSeconds": 600,
        "maxOutputBytes": 200000,
        "allowShellMetacharacters": false
      }
    }
  ]
}
```

## Codex And Screen Scope

```json
{
  "machineName": "office",
  "scopes": [
    {
      "type": "folder",
      "id": "codex-app",
      "name": "Codex App",
      "path": "C:\\Projects\\my-app",
      "permissions": {
        "read": true,
        "write": true,
        "shell": true,
        "codex": true,
        "screen": true
      },
      "policy": {
        "allowedCommands": ["npm *", "node *", "git *", "codex *"],
        "deniedCommands": ["npm publish *", "git push *"],
        "allowedPackageScripts": ["test", "build", "lint"],
        "deniedPackageScripts": ["deploy", "publish", "release"],
        "maxRuntimeSeconds": 1800,
        "maxOutputBytes": 500000,
        "allowSensitivePathMetadata": false,
        "allowSensitivePathWrites": false
      }
    }
  ]
}
```

## Public MCP Tunnel

```json
{
  "machineName": "office",
  "ownerToken": "replace-with-generated-token",
  "publicMcpOnly": true,
  "publicBaseUrl": "https://mcp.example.com",
  "scopes": [
    {
      "type": "folder",
      "id": "app",
      "name": "App",
      "path": "C:\\Projects\\my-app",
      "permissions": {
        "read": true,
        "write": true,
        "shell": true,
        "codex": false,
        "screen": false
      }
    }
  ]
}
```

Do not commit real `ownerToken` values or credentials. Keep secrets outside
exposed folders; sensitive path content, metadata, and mutation are conservative
by default.

## Legacy Workspaces

Existing `workspaces[]`-only configs keep working during `0.x`:

```json
{
  "machineName": "office",
  "workspaces": [
    {
      "id": "app",
      "name": "App",
      "path": "C:\\Projects\\my-app",
      "permissions": {
        "read": true,
        "write": false,
        "shell": false,
        "codex": false,
        "screen": false
      }
    }
  ]
}
```

After any Computer Linker CLI write, the config is saved with both `scopes[]`
and `workspaces[]` synchronized.
