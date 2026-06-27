# SDK Quickstart

Use this when building a local or trusted-private integration in TypeScript or
JavaScript. The SDK talks to the JSON API under `/api/v1`; use a normal MCP
client for `/mcp`.

## 1. Start Computer Linker

```powershell
cd C:\Projects\my-app
computer-linker here
```

Keep that terminal running. In another terminal, inspect the local API setup:

```powershell
computer-linker client setup --show-token
```

## 2. Install In Your Integration

```powershell
npm install @easonwumac/computer-linker
```

## 3. Connect

```ts
import { ComputerLinkerClient } from "@easonwumac/computer-linker";

const client = new ComputerLinkerClient({
  baseUrl: "http://127.0.0.1:3939/api/v1",
  ownerToken: process.env.COMPUTER_LINKER_TOKEN,
});

const info = await client.getComputerInfo();
const setup = await client.clientSetup();
const smoke = await client.smoke();

console.log(info);
console.log(setup);
console.log(smoke.ready);
```

The SDK also accepts the server origin `http://127.0.0.1:3939` and normalizes
it to `/api/v1`. Passing `http://127.0.0.1:3939/mcp` fails intentionally
because `/mcp` is the MCP protocol endpoint, not the JSON API.

## 4. Run Operations

Prefer the namespaced helper surface for new code:

```ts
const scope = "my-app";

await client.computer.code.context(scope, ".", {
  maxDepth: 2,
  maxEntries: 100,
});

await client.computer.file.search(
  scope,
  "TODO",
  { glob: "src/**/*.ts" },
  { maxResults: 20 },
);

await client.computer.file.read(scope, "README.md", {
  maxBytes: 65536,
});

await client.computer.git.diff(scope, {}, {
  maxBytes: 65536,
});
```

Use direct `computerOperation()` when the operation is dynamic:

```ts
await client.computerOperation({
  scope,
  op: "package.run",
  target: ".",
  input: {
    script: "test",
  },
  options: {
    timeoutSeconds: 600,
  },
});
```

## 5. Inspect History

```ts
await client.getOperationHistory({
  scope: "my-app",
  view: "last",
  limit: 20,
});

await client.computer.history.connections("my-app", {
  maxResults: 20,
});
```

## Compatibility Notes

`WorkspaceLinkerClient` and `WorkspaceLinker*` type names remain exported for
older integrations. Top-level helpers such as `read()`, `search()`,
`command()`, `git()`, and `codex()` also remain available, but they are
compatibility helpers for older workspace operation names.

New SDK code should use:

- `getComputerInfo()`
- `clientSetup()`
- `smoke()`
- `computerOperation()`
- `client.computer.*`
- `getOperationHistory()`

See [Client SDK Contract](client-sdk.md) for the complete type and
compatibility contract.
