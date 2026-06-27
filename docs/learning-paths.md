# Learning Paths

Use this page as the documentation router. Pick the path that matches what you
are doing, then follow the linked guide instead of reading every document.

## New User: First Local Run

Goal: install Computer Linker, expose one folder, and connect a local MCP
client.

1. Install and verify:

   ```powershell
   npm install -g @easonwumac/computer-linker
   computer-linker check
   ```

2. Start inside the folder you want to expose:

   ```powershell
   cd C:\Projects\my-app
   computer-linker here
   ```

3. In another terminal, get client settings:

   ```powershell
   computer-linker client setup
   computer-linker diagnose client --local
   ```

Read next:

- [Getting Started](getting-started.md) for the full first-run walkthrough.
- [CLI Quick Reference](cli-reference.md) for copyable daily commands.
- [Agent Instructions](agent-instructions.md) for the prompt to paste into an
  MCP-capable agent.

## Local Coding Session

Goal: let an MCP client inspect, edit, and run approved project commands in
one folder.

```powershell
cd C:\Projects\my-app
computer-linker here
```

Normal coding mode is the default for `here` and `start <folder>`. It enables
file edits plus approved project commands with bounded runtime/output policy.
Use `--read-only` when the session is review-only. Use `--full-trust` only
when Codex operations and screen capture are intended.

Read next:

- [Usage Guide](usage-guide.md) for daily operation.
- [Command Policy](command-policy.md) before changing command allowlists.
- [Agent Playbook](agent-playbook.md) for the operation sequence an agent
  should follow.

## Cloud MCP Client With OpenAI Secure MCP Tunnel

Goal: connect a cloud MCP client through an OpenAI tunnel id. This mode does
not create a public URL.

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

In the MCP client, choose Tunnel mode and select or paste the `tunnel_...` id.
Do not paste the Computer Linker bearer token into OpenAI tunnel mode; the
local tunnel client forwards auth to the private loopback MCP server.

Read next:

- [Tutorials](tutorials.md#tutorial-3-openai-secure-mcp-tunnel) for the
  OpenAI tunnel walkthrough.
- [Client Recipes](client-recipes.md) for local, tunnel, and smoke-test setup
  variants.
- [Security](../SECURITY.md) for tunnel and auth boundaries.

## Cloud MCP Client With Public HTTPS URL

Goal: expose only `/mcp` through a public HTTPS URL.

Tailscale Funnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

Cloudflare quick tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Cloudflare hostname you own:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Verify the exposed state:

```powershell
computer-linker tunnel status
computer-linker diagnose client --remote
computer-linker history --view connections
```

Read next:

- [Tutorials](tutorials.md#tutorial-4-public-url-with-tailscale-funnel-or-cloudflare)
  for public URL setup.
- [Usage Guide](usage-guide.md#cloud-access) for daily tunnel commands.
- [Security](../SECURITY.md) for MCP-only public exposure rules.

## Agent Author: First Operations

Goal: make an agent use the stable generic MCP contract instead of legacy
workspace tools.

Required flow:

1. Call `get_computer_info`.
2. Choose one returned `scope`.
3. Call `computer_operation` with `{ scope, op, target, input, options }`.
4. Call `get_operation_history` when debugging recent behavior.

Typical first operation:

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

Read next:

- [Agent Instructions](agent-instructions.md) for a pasteable prompt.
- [Agent Playbook](agent-playbook.md) for operation recipes and failure
  handling.
- [API Compatibility](api-compatibility.md) for the primary and compatibility
  MCP surfaces.

## SDK Or Automation Client

Goal: call Computer Linker from JavaScript or TypeScript automation.

Start with:

```powershell
computer-linker client setup
computer-linker client smoke --allow-http --url http://127.0.0.1:3939/mcp
```

Then inspect:

- [SDK Quickstart](sdk-quickstart.md) for the shortest integration path.
- [Client SDK](client-sdk.md) for exported types and helper methods.
- [examples/minimal-mcp-client.mjs](../examples/minimal-mcp-client.mjs) for a
  minimal MCP SDK client.

## Maintainer: Change The Product

Goal: modify Computer Linker without mixing protocol, CLI, provider, and
release concerns.

Start with:

```powershell
npm ci
npm run typecheck
node scripts/run-tests.mjs --list
```

Before moving code, read:

- [Architecture](architecture.md) for product boundaries and module map.
- [Developer Guide](developer-guide.md) for where new code belongs.
- [Release Checklist](release-checklist.md) for package, public mirror, and
  publish gates.

Local product gate:

```powershell
npm run product:check
```

