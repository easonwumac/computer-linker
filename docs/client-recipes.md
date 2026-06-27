# MCP Client Recipes

Use `workspace-linker client setup` as the source of truth for the current
connection details. Use `--show-token` only on a trusted local screen.

## Local MCP Clients

Start Workspace Linker:

```powershell
workspace-linker start C:\Projects\my-app --coding
```

Configure the client:

- URL: `http://127.0.0.1:3939/mcp`
- Auth: `Authorization: Bearer <ownerToken>`
- Agent instructions: [agent-instructions.md](agent-instructions.md)

Verify:

```powershell
workspace-linker diagnose client --local
workspace-linker client smoke --allow-http --url http://127.0.0.1:3939/mcp
```

## OpenAI Secure MCP Tunnel

Create the tunnel in OpenAI Platform, then start Workspace Linker:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
workspace-linker start C:\Projects\my-app --coding --tunnel openai --tunnel-id tunnel_...
```

In the client, choose Tunnel mode and select or paste the `tunnel_...` id. Do
not paste the Workspace Linker bearer token into OpenAI Tunnel mode; the local
tunnel client forwards it to the local MCP server.

Verify:

```powershell
workspace-linker diagnose client
workspace-linker history --view connections
```

## Tailscale Funnel

```powershell
workspace-linker start C:\Projects\my-app --coding --tunnel tailscale
```

Workspace Linker detects the Funnel HTTPS origin and saves it as
`publicBaseUrl`. Configure the client with the printed HTTPS URL plus `/mcp`
and the bearer header from:

```powershell
workspace-linker client setup --show-token
```

## Cloudflare

Quick tunnel:

```powershell
workspace-linker start C:\Projects\my-app --coding --tunnel cloudflare
```

Owned hostname:

```powershell
workspace-linker start C:\Projects\my-app --coding --url https://mcp.your-domain.com --tunnel cloudflare
```

Configure the client with `https://mcp.your-domain.com/mcp` and the bearer
header from `workspace-linker client setup --show-token`.

## Minimal SDK Client

With Workspace Linker already running:

```powershell
$env:WORKSPACE_LINKER_MCP_URL = "http://127.0.0.1:3939/mcp"
$env:WORKSPACE_LINKER_TOKEN = "<ownerToken>"
node examples/minimal-mcp-client.mjs
```

The example initializes MCP, lists tools, calls `get_computer_info`, and runs a
read-only `computer_operation`.

## Agent Prompt

Use [agent-instructions.md](agent-instructions.md) when the client accepts a
system or instruction prompt. The short version:

```text
First call get_computer_info. Use computer_operation with {scope, op, target, input, options}. Stay inside configured scopes. Prefer read-only context/search/diff before write or command operations.
```
