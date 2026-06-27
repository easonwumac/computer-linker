# MCP Client Recipes

Use `computer-linker client setup` as the source of truth for the current
connection details. Use `--show-token` only on a trusted local screen.

## Local MCP Clients

Start Computer Linker:

```powershell
cd C:\Projects\my-app
computer-linker here
```

From another folder, use `computer-linker start C:\Projects\my-app`.

Configure the client:

- URL: `http://127.0.0.1:3939/mcp`
- Auth: bearer header printed by `computer-linker client setup --show-token`
- Agent instructions: [agent-instructions.md](agent-instructions.md)

Verify:

```powershell
computer-linker diagnose client --local
computer-linker client smoke --allow-http --url http://127.0.0.1:3939/mcp
```

## OpenAI Secure MCP Tunnel

Create the tunnel in OpenAI Platform, then start Computer Linker:

```powershell
$env:CONTROL_PLANE_API_KEY = "sk-..."
cd C:\Projects\my-app
computer-linker here --tunnel openai --tunnel-id tunnel_...
```

In the client, choose Tunnel mode and select or paste the `tunnel_...` id. Do
not paste the Computer Linker bearer token into OpenAI Tunnel mode; the local
tunnel client forwards it to the local MCP server.

Verify:

```powershell
computer-linker diagnose client
computer-linker history --view connections
```

## Tailscale Funnel

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel tailscale
```

Computer Linker detects the Funnel HTTPS origin and saves it as
`publicBaseUrl`. Configure the client with the printed HTTPS URL plus `/mcp`
and the bearer header from:

```powershell
computer-linker client setup --show-token
```

## Cloudflare

Quick tunnel:

```powershell
cd C:\Projects\my-app
computer-linker here --tunnel cloudflare
```

Owned hostname:

```powershell
cd C:\Projects\my-app
computer-linker here --url https://mcp.your-domain.com --tunnel cloudflare
```

Configure the client with `https://mcp.your-domain.com/mcp` and the bearer
header from `computer-linker client setup --show-token`.

## Minimal SDK Client

With Computer Linker already running:

```powershell
$env:COMPUTER_LINKER_MCP_URL = "http://127.0.0.1:3939/mcp"
$env:COMPUTER_LINKER_TOKEN = "<ownerToken>"
node examples/minimal-mcp-client.mjs
```

The example initializes MCP, lists tools, calls `get_computer_info`, and runs a
read-only `computer_operation`. It reads the bearer token from environment
variables and rejects positional token arguments.

## Agent Prompt

Use [agent-instructions.md](agent-instructions.md) when the client accepts a
system or instruction prompt. The short version:

```text
First call get_computer_info. Use computer_operation with {scope, op, target, input, options}. Stay inside configured scopes. Prefer read-only context/search/diff before write or command operations.
```
