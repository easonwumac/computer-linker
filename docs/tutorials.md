# Tutorials

These tutorials show the common Computer Linker flows from a clean install to
an MCP client doing useful work. Use [Getting Started](getting-started.md) for
the shortest path and [User Manual](user-manual.md) for the full command
reference.

## Tutorial 1: Local Coding Folder

Use this when the MCP client runs on the same machine or can reach
`127.0.0.1`.

```powershell
npm install -g @easonwumac/computer-linker
computer-linker check
cd C:\Projects\my-app
computer-linker here
```

Keep that terminal running. In another terminal:

```powershell
computer-linker client setup
computer-linker diagnose client --local
```

Add the MCP URL from `client setup` to the client. If the client requires an
auth header, show the token only on a trusted local screen:

```powershell
computer-linker client setup --show-token
```

Expected result:

- MCP URL is `http://127.0.0.1:3939/mcp`.
- The exposed scope name defaults to the folder name.
- The default permission mode allows file edits and approved project commands.
- `diagnose client --local` reports the SDK smoke test as successful.

## Tutorial 2: Read-Only Review

Use read-only mode when the client should inspect code without editing files or
running commands.

```powershell
cd C:\Projects\my-app
computer-linker here --read-only
```

Suggested first prompt for the MCP client:

```text
Use Computer Linker. First call get_computer_info, choose the my-app scope,
inspect project context with read/search/git operations only, and summarize
risks without editing files.
```

Expected result:

- File reads, tree listing, search, and Git inspection are allowed.
- File writes, shell commands, package scripts, Codex, and screen capture are
  denied for that scope.

## Tutorial 3: OpenAI Secure MCP Tunnel

Use this when the MCP client supports OpenAI Secure MCP Tunnel. This mode does
not create a public URL; the local tunnel client connects outbound to OpenAI.

Create or choose a tunnel id in the OpenAI Platform tunnel settings. Then run:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

In the MCP client, choose Tunnel mode and select or paste the `tunnel_...` id.
Do not paste the Computer Linker bearer token into OpenAI Tunnel mode; the
local tunnel client forwards auth to the private loopback MCP server.

Verify locally:

```powershell
computer-linker status --details
computer-linker history --view connections
computer-linker client setup
```

Expected result:

- `status` shows an active OpenAI tunnel.
- No public URL is required.
- Public-host requests expose only the MCP surface.

## Tutorial 4: Public URL With Tailscale Funnel Or Cloudflare

Use this when the MCP client needs an HTTPS MCP URL.

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

Then inspect the published state:

```powershell
computer-linker tunnel status
computer-linker client setup
computer-linker diagnose client --remote
```

Expected result:

- The MCP URL ends with `/mcp`.
- Public requests are MCP-only by default.
- Local `/api/v1` and `/healthz` stay loopback diagnostics.

## Tutorial 5: What The Agent Should Do First

Give the MCP client these instructions after connection:

```text
Use Computer Linker through the generic MCP contract.
First call get_computer_info.
Choose one returned scope.
Use computer_operation with dotted operation names from computerOperationRegistry.
Use get_operation_history when debugging recent activity.
Prefer read/search/git inspection before write, command, Codex, or screen operations.
Do not require absolute local roots; default get_computer_info redacts them.
```

Typical first read-only operation:

```json
{
  "scope": "my-app",
  "op": "file.tree",
  "target": ".",
  "input": {},
  "options": {
    "maxDepth": 2,
    "maxEntries": 80
  }
}
```

Typical search operation:

```json
{
  "scope": "my-app",
  "op": "file.search",
  "target": ".",
  "input": {
    "query": "TODO"
  },
  "options": {
    "maxResults": 20
  }
}
```

## Troubleshooting Loop

Run these commands in order:

```powershell
computer-linker status --details
computer-linker diagnose client
computer-linker tunnel status
computer-linker history --view connections
```

Common fixes:

- If no workspace is listed, restart with `computer-linker here` inside the
  folder or `computer-linker start <workspace-path>`.
- If auth fails, rotate the token with `computer-linker config token rotate`
  and reconnect the client.
- If a command is denied, inspect policy with
  `computer-linker config policy <workspace-id> --json`.
- If a broad allow pattern such as `npm *` still blocks a command, check
  whether the command contains shell chaining, pipes, redirects, command
  substitution, or Windows `cmd` escapes. See
  [Command Policy](command-policy.md).
- If OpenAI tunnel returns an organization-context 401, verify the API key
  organization, Tunnels Read + Use permission, and client workspace
  association.
