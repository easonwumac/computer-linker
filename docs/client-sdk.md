# Client SDK Contract

Computer Linker exposes a small TypeScript client for MCP hosts, local
automation, and compatibility connectors. Prefer the generic
computer contract for new integrations:

```ts
import { ComputerLinkerClient } from "@easonwumac/computer-linker";

const client = new ComputerLinkerClient({
  baseUrl: "http://127.0.0.1:3939/api/v1",
  ownerToken: process.env.COMPUTER_LINKER_TOKEN,
});

await client.getComputerInfo();
await client.clientSetup();
await client.smoke();
const result = await client.computerOperation<{ ok: boolean; data?: unknown }>({
  scope: "app",
  op: "file.search",
  target: "src",
  input: { query: "TODO" },
  options: { maxResults: 20 },
});
if (result.ok) console.log(result.data);
```

The SDK talks to the JSON API under `/api/v1`. Treat that API as a local or
trusted-private automation surface. Public tunnels created by `computer-linker
start --tunnel ...` and `computer-linker expose ...` default to MCP-only, so
public hosts expose `/mcp` but return 404 for `/api` and `/healthz`.
Use the SDK against `connectionProfile.http.localApiUrl`, or against a
deliberately private reverse proxy where you have chosen to expose the JSON API.

The outer shape stays stable:

```ts
{
  scope: "app",
  op: "code.context" | "file.read" | "file.search" | "git.diff" | "package.run" | "command.run" | "codex.run" | "screen.list",
  target: "src/index.ts",
  input: {},
  options: {}
}
```

For raw JSON clients using the single control endpoint, use the same envelope at
the top level with `action: "computer_operation"`:

```json
{
  "action": "computer_operation",
  "scope": "app",
  "op": "file.read",
  "target": "README.md",
  "input": {},
  "options": { "maxBytes": 65536 }
}
```

Use `input` for operation data and `options` for limits, filters, and runtime
controls. The response is always a standard operation result envelope with
`ok`, `operationId`, `scope`, `op`, `startedAt`, `durationMs`, `data` on
success, and `error` on failure. Computer Linker still enforces the configured
workspace boundary on the server side.
Use `getComputerInfo()` to discover `computerOperationRegistry`; new clients
should prefer its dotted op names such as `code.context`, `file.read`,
`file.search`, `git.diff`, `package.run`, `command.run`, `process.start`,
`codex.run`, `screen.capture`, and `history.last`.
The registry is current-machine aware for screen capture: it only advertises
display, window, or process capture operations that the local provider reports
as supported.
The stable request/result bundle is also published as JSON Schema at
`docs/computer-operation-v1.schema.json` for clients that validate contracts
outside TypeScript.

Common helpers are wrappers around the same envelope:

```ts
await client.getComputerInfo();
await client.clientSetup();
await client.smoke();
await client.computerOperation({ scope: "app", op: "file.read", target: "README.md" });
await client.getOperationHistory({ scope: "app", view: "last", limit: 20 });
await client.listWorkspaces();
await client.connectReadiness({ registry: { category: "search" } });
await client.chatGptSetup("coding");
await client.read("app", "README.md", { maxBytes: 65536 });
await client.search("app", "runWorkspaceOperation", { glob: "src/**/*.ts" });
await client.write("app", "notes/todo.md", "- ship\n");
await client.command("app", "npm test", { timeoutSeconds: 120 });
await client.screenList("app");
await client.screenCapture("app", "primary", { returnMode: "fileRef" });
await client.git("app", "git_diff", { paths: ["src/client.ts"] });
await client.codex("app", "Fix the failing tests");
await client.operationRegistry({ category: "search", query: "ripgrep" });
await client.workspaceOperationRegistry({ category: "search", query: "ripgrep" });
await client.historyLast({ workspaceId: "app", limit: 20 });
await client.workspaceHistoryInsight("app", { view: "timeline", maxResults: 20 });
await client.historySessions({ workspaceId: "app", limit: 20 });
```

`workspaceOperation()` is kept for older integrations that already send the MCP
style nested envelope. `operation()` is kept for older JSON clients using
workspace operation names. New JSON clients should use `computerOperation()` or
`action: "computer_operation"`.

For generic MCP/client integrations, the recommended flow is:

1. `getComputerInfo()`
2. `clientSetup()` when URL/auth setup details are needed
3. `smoke()` when validating that the local or trusted-private HTTP API and MCP
   endpoint are reachable from the SDK process
4. `computerOperation({ scope, op, target, input, options })`
5. `getOperationHistory({ scope, view })` when auditing actions
6. compatibility only: `getCapabilities()`, `workspaceOperationRegistry()`,
   `operation()`, or `workspaceOperation()`

This keeps clients from learning many endpoints while still covering file
operations, search, git, commands, Codex workflows, and audit history.
`connectReadiness()` is a client-side aggregate over generic MCP client setup,
workspace list, and operation registry contracts. It
returns `ready`, `status`, `blockingReasons`, `warnings`, `nextActions`,
`recommendedWorkspace`, and the source payloads so GPT clients can decide
whether to connect, show setup steps, or continue with coding operations.
`smoke()` is the SDK equivalent of `computer-linker client smoke` for local or
trusted-private integrations. It checks `/healthz`, `/api/v1/capabilities`,
authenticated `get_computer_info`, one read-only `computer_operation`
`file.list` in a readable scope, and an MCP SDK flow on `/mcp`: initialize,
tools/list, `get_computer_info`, and one read-only `computer_operation`.
It then returns a `computer-linker-client-smoke` report with `ready`, `checks`,
`blockingReasons`, `warnings`, and `nextActions`. Public tunnel smoke remains
MCP-only by default because public hosts expose `/mcp` and intentionally block
the JSON API, but the MCP tool flow still runs. The CLI and SDK use the same
generic smoke contract;
ChatGPT-specific smoke helpers remain compatibility commands layered beside it.
`clientSetup()` separates local and remote readiness: `localReady`/`ready` cover
stdio or loopback MCP usage, while `remoteReady` and `remoteBlockingReasons`
describe what remains before a cloud or tunnel client can connect. It also
returns `firstPrompt` and `agentInstructions`, which are the same generic
copy-pasteable MCP agent guidance printed by
`computer-linker client setup --details`.
`operationRegistry()` returns the stable `computer_operation` contract,
filtered dotted operation metadata, required capabilities, permissions,
boundaries, schemas, and examples. `workspaceOperationRegistry()` returns the
older workspace-operation registry for clients that still call
`workspace_operation` or the JSON `operation` compatibility action.
`chatGptSetup()` is a compatibility helper for ChatGPT-specific setup screens.
It returns the same redacted client-specific setup status used by CLI/API clients,
including `connectProfile.serverUrl`, redacted auth guidance, first prompt,
profile commands, smoke commands, `wizard.currentStepId`, and ordered setup
steps for product UIs.

ChatGPT connector profiles add two higher-level guidance fields on top of the
same envelope:

- `modelGuide`: explains that MCP clients call `computer_operation`, while
  local or trusted-private raw JSON clients call `POST /api/v1/control` with
  `action: "computer_operation"`; default public tunnel exposure is MCP-only
  and blocks JSON API routes. Legacy JSON clients can still use
  `action: "operation"` or `workspace_operation`
- `workflowRecipes`: gives ready-made flows for orientation, search/read,
  implementation, verification, history, and Codex-assisted coding
