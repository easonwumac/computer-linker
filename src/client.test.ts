import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "./config.js";
import { ComputerLinkerClient, WorkspaceLinkerClient } from "./client.js";
import { serveHttp } from "./server.js";

const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "computer-linker-client-test-"));
const configRoot = join(root, "config");
const workspaceRoot = join(root, "workspace");

try {
  process.env.LOCALPORT_CONFIG_DIR = configRoot;
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "hello from client\n", "utf8");
  writeConfig({
    machineName: "client-test",
    host: "127.0.0.1",
    port: 3961,
    ownerToken: "client-token",
    workspaces: [
      {
        id: "app",
        name: "App",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
      {
        id: "writer",
        name: "Writer",
        path: workspaceRoot,
        permissions: { read: true, write: true, shell: false, codex: false },
      },
    ],
  });

  const server = serveHttp();
  try {
    assert.equal(WorkspaceLinkerClient, ComputerLinkerClient);

    const client = new ComputerLinkerClient({
      baseUrl: "http://127.0.0.1:3961/api/v1",
      ownerToken: "client-token",
    });
    const workspaces = await client.listWorkspaces();
    assert.equal(workspaces.machineName, "client-test");
    assert.equal(workspaces.workspaces[0].id, "app");
    assert.ok(workspaces.workspaces[0].allowedOperations.includes("read"));
    assert.ok(workspaces.workspaces[0].capabilityPolicy?.capabilities.includes("fs:read"));

    const registry = await client.operationRegistry({ category: "search", query: "ripgrep" });
    assert.equal(registry.kind, "computer-operation-registry");
    assert.equal(registry.contract.jsonApi.action, "computer_operation");
    assert.ok(registry.operations.every((operation) => operation.op === "file.search"));
    assert.ok(registry.operations.some((operation) => operation.backendOperation === "search_text"));

    const workspaceRegistry = await client.workspaceOperationRegistry({ category: "search", query: "ripgrep" });
    assert.equal(workspaceRegistry.kind, "operation-registry");
    assert.equal(workspaceRegistry.contract.jsonApi.action, "operation");
    assert.ok(workspaceRegistry.operations.every((operation) => operation.category === "search"));
    assert.ok(workspaceRegistry.operations.some((operation) => operation.operation === "search_text"));

    const connectReadiness = await client.connectReadiness({ registry: { category: "search" } });
    assert.equal(connectReadiness.kind, "computer-linker-connect-readiness");
    assert.equal(connectReadiness.ready, true);
    assert.equal(connectReadiness.status, "ready");
    assert.equal(connectReadiness.machine?.machineName, "client-test");
    assert.equal(connectReadiness.recommendedWorkspace?.id, "app");
    assert.equal(connectReadiness.clientSetup.kind, "computer-linker-mcp-client-setup");
    assert.equal(connectReadiness.clientSetup.localReady, true);
    assert.equal(connectReadiness.clientSetup.remoteReady, false);
    assert.ok(connectReadiness.clientSetup.remoteBlockingReasons.some((reason) => reason.includes("No public MCP URL")));
    assert.ok(connectReadiness.warnings.some((warning) => warning.includes("No public MCP URL")));
    assert.deepEqual(connectReadiness.discovery.primary.mcpFlow, [
      "get_computer_info",
      "computer_operation",
      "get_operation_history",
    ]);
    assert.equal(connectReadiness.discovery.primary.jsonApi.preferredAction, "computer_operation");
    assert.equal(connectReadiness.discovery.primary.jsonApi.actions.includes("workspace_operation"), false);
    assert.ok(connectReadiness.discovery.compatibility.mcpTools.includes("workspace_operation"));
    assert.equal(connectReadiness.operationRegistry.kind, "computer-operation-registry");
    assert.ok(connectReadiness.operationRegistry.operations.some((operation) => operation.op === "file.search"));
    assert.ok(connectReadiness.operationRegistry.operations.some((operation) => operation.op === "code.search_symbols"));

    const smoke = await client.smoke({ timeoutMs: 10000 });
    assert.equal(smoke.kind, "computer-linker-client-smoke");
    assert.equal(smoke.ready, true, JSON.stringify(smoke, null, 2));
    assert.equal(smoke.baseUrl, "http://127.0.0.1:3961/");
    assert.equal(smoke.apiBaseUrl, "http://127.0.0.1:3961/api/v1/");
    assert.equal(smoke.mcpServerUrl, "http://127.0.0.1:3961/mcp");
    assert.equal(smoke.authHeader, "Authorization: Bearer <ownerToken>");
    assert.deepEqual(smoke.blockingReasons, []);
    assert.ok(smoke.checks.some((check) => check.id === "healthz" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "api-capabilities" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "api-computer-info" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "api-read-only-operation" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "mcp-initialize" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "mcp-list-tools" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "mcp-get-computer-info" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "mcp-read-only-operation" && check.status === "pass"));
    assert.ok(smoke.checks.some((check) => check.id === "mcp-operation-history" && check.status === "pass"));

    const read = await client.read("app", "hello.txt", { maxBytes: 5 }) as { content: string; truncated: boolean };
    assert.equal(read.content, "hello");
    assert.equal(read.truncated, true);

    const readViaOperation = await client.operation({
      workspace: "app",
      op: "read",
      target: "hello.txt",
      options: { maxBytes: 5 },
    }) as { content: string; truncated: boolean };
    assert.equal(readViaOperation.content, "hello");
    assert.equal(readViaOperation.truncated, true);

    const listed = await client.listFiles("app", ".") as { entries: Array<{ name: string }> };
    assert.ok(listed.entries.some((entry) => entry.name === "hello.txt"));

    const search = await client.search("app", "client", { glob: "*.txt", maxResults: 5 }) as { matches: string[] };
    assert.match(search.matches.join("\n"), /hello\.txt/);

    const written = await client.write("writer", "direct-write.txt", "direct write\n") as { path: string };
    assert.equal(written.path, "direct-write.txt");
    assert.equal(await readFile(join(workspaceRoot, "direct-write.txt"), "utf8"), "direct write\n");

    const historyInsight = await client.historyInsight({ view: "timeline", workspaceId: "app", limit: 20 }) as {
      view: string;
      summary: { totalEvents: number };
      timeline: Array<{ operation?: string }>;
    };
    assert.equal(historyInsight.view, "timeline");
    assert.ok(historyInsight.summary.totalEvents >= 1);
    assert.ok(historyInsight.timeline.some((event) => event.operation === "search_text" || event.operation === "read"));

    const historyLast = await client.historyLast({ workspaceId: "app", limit: 20 }) as {
      view: string;
      last: { event?: { operation?: string }; workspaceOperation?: { operation?: string }; suggestedNextActions: string[] };
    };
    assert.equal(historyLast.view, "last");
    assert.ok(historyLast.last.event);
    assert.ok(historyLast.last.workspaceOperation);
    assert.ok(Array.isArray(historyLast.last.suggestedNextActions));

    const historySessions = await client.historySessions({ workspaceId: "app", limit: 20 }) as {
      view: string;
      sessions: Array<{ workspaceId?: string; operations: Record<string, number> }>;
    };
    assert.equal(historySessions.view, "sessions");
    assert.ok(historySessions.sessions.some((session) => (
      session.workspaceId === "app" &&
      (session.operations.search_text >= 1 || session.operations.read >= 1)
    )));

    const historyConnections = await client.historyConnections({ workspaceId: "app", limit: 20 }) as {
      view: string;
      connections: Array<{ scope: string; totalEvents: number }>;
    };
    assert.equal(historyConnections.view, "connections");
    assert.ok(historyConnections.connections.some((connection) => (
      connection.scope === "workspace" &&
      connection.totalEvents >= 1
    )));

    await assert.rejects(
      () => client.run("writer", "write", { path: "replayed.txt" }),
      /content is required/,
    );
    const replayItems = await client.failedReplay({ workspaceId: "writer", limit: 20 });
    const writeReplay = replayItems.find((item) => (
      item.request?.workspace === "writer" &&
      item.request.input.op === "write"
    ));
    assert.ok(writeReplay);
    assert.equal(writeReplay.replayable, false);
    assert.ok(writeReplay.requiresInput?.includes("content"));
    await assert.rejects(
      () => client.replayFailed(writeReplay),
      /requires input: content/,
    );
    const replayed = await client.replayFailed(writeReplay, {
      input: { content: "written from replay\n" },
    }) as { path: string };
    assert.equal(replayed.path, "replayed.txt");
    assert.equal(await readFile(join(workspaceRoot, "replayed.txt"), "utf8"), "written from replay\n");
  } finally {
    server.close();
  }

  await assertClientBaseUrlValidation();
  await assertMinimalMcpClientExample();
  await assertClientContractShape();
  await assertComputerHelperPayloads();
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;
  await rm(root, { recursive: true, force: true });
}

async function assertClientBaseUrlValidation(): Promise<void> {
  const requests: string[] = [];
  const fetchMock: typeof fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      ok: true,
      data: {
        kind: "computer-linker-computer-info",
        machineName: "url-test",
        scopes: [],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const originClient = new ComputerLinkerClient({
    baseUrl: "https://computer-linker.example.com",
    fetch: fetchMock,
  });
  await originClient.getComputerInfo();
  assert.equal(requests.at(-1), "https://computer-linker.example.com/api/v1/control");

  const trailingApiClient = new ComputerLinkerClient({
    baseUrl: "https://computer-linker.example.com/api/v1/",
    fetch: fetchMock,
  });
  await trailingApiClient.getComputerInfo();
  assert.equal(requests.at(-1), "https://computer-linker.example.com/api/v1/control");

  await assert.rejects(
    async () => new ComputerLinkerClient({ baseUrl: "http://127.0.0.1:3939/mcp" }).getComputerInfo(),
    /baseUrl points to the MCP endpoint.*JSON API.*\/api\/v1/s,
  );
  await assert.rejects(
    async () => new ComputerLinkerClient({ baseUrl: "not a url" }).getComputerInfo(),
    /baseUrl must be an absolute JSON API URL/,
  );
}

async function assertMinimalMcpClientExample(): Promise<void> {
  const example = await readFile(join(process.cwd(), "examples", "minimal-mcp-client.mjs"), "utf8");
  assert.doesNotMatch(example, /\?\?\s*process\.argv\[3\]/);
  assert.match(example, /Do not pass the owner token as a command argument/);
  assert.doesNotMatch(example, /op:\s*"file\.list"[\s\S]*maxEntries/);
  assert.match(example, /op:\s*"file\.tree"/);
  assert.match(example, /options:\s*\{\s*maxDepth:\s*1,\s*maxEntries:\s*20\s*\}/);
  assert.match(example, /name:\s*"get_computer_info"/);
  assert.match(example, /name:\s*"computer_operation"/);
  assert.match(example, /name:\s*"get_operation_history"/);
  assert.match(example, /scope,\s*\n\s*view:\s*"last"/);
  assert.doesNotMatch(example, /allowedOperations\?\.includes\("read"\)/);
  assert.doesNotMatch(example, /allowedOperations\?\.includes\("search_text"\)/);
}

async function assertClientContractShape(): Promise<void> {
  const requests: Array<{ url: string; method?: string; body?: Record<string, unknown>; authorization?: string; mcpSessionId?: string }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    const requestUrl = new URL(String(input));
    requests.push({
      url: String(input),
      method: init?.method,
      body,
      authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      mcpSessionId: new Headers(init?.headers).get("mcp-session-id") ?? undefined,
    });
    if (requestUrl.pathname === "/healthz") {
      return new Response(JSON.stringify({
        ok: true,
        name: "computer-linker",
        machineName: "shape-machine",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/api/v1/capabilities" && init?.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          name: "computer-linker",
          machineName: "shape-machine",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/mcp" && init?.method === "POST") {
      const method = String(body?.method ?? "");
      if (method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }
      if (method === "tools/list") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id,
          result: {
            tools: [
              { name: "get_computer_info", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" } },
              { name: "computer_operation", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" } },
              { name: "get_operation_history", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" } },
            ],
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "tools/call") {
        const params = body?.params && typeof body.params === "object"
          ? body.params as { name?: string; arguments?: Record<string, unknown> }
          : {};
        const structuredContent = params.name === "get_computer_info"
          ? {
              kind: "computer-linker-computer-info",
              machineName: "shape-machine",
              scopes: [
                {
                  id: "app",
                  type: "folder",
                  permissions: { read: true, write: true, shell: false, codex: false },
                  allowedOperations: ["read", "list_details", "search_text", "coding_context"],
                },
              ],
            }
          : params.name === "get_operation_history"
            ? {
                view: "last",
                summary: {
                  totalEvents: 2,
                  successfulEvents: 2,
                  failedEvents: 0,
                },
                last: { event: { tool: "computer_operation" } },
              }
          : {
              ok: true,
              operationId: "op_mcp_shape",
              scope: params.arguments?.scope,
              op: params.arguments?.op,
              data: { entries: [] },
              warnings: [],
            };
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(structuredContent) }],
            structuredContent,
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body?.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "computer-linker", version: "0.1.0" },
        },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "shape-smoke-session",
        },
      });
    }
    if (requestUrl.pathname === "/mcp" && init?.method === "DELETE") {
      return new Response("", { status: 202 });
    }
    const action = String(body?.action ?? "");
    if (action === "get_computer_info") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          kind: "computer-linker-computer-info",
          machineName: "shape-machine",
          scopes: [
            {
              id: "app",
              type: "folder",
              permissions: { read: true, write: true, shell: false, codex: false },
              allowedOperations: ["read", "list_details", "search_text", "coding_context"],
            },
          ],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "client_setup") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          kind: "computer-linker-mcp-client-setup",
          schemaVersion: 1,
          machineName: "shape-machine",
          localReady: true,
          ready: true,
          remoteReady: false,
          tools: ["get_computer_info", "computer_operation", "get_operation_history"],
          blockingReasons: [],
          remoteBlockingReasons: ["No public MCP URL is configured or detected"],
          warnings: ["No public MCP URL is configured or detected; local stdio/loopback clients can still connect."],
          nextActions: ["For local clients, use stdio or the loopback MCP URL."],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "get_operation_history") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          view: body?.input && typeof body.input === "object" ? (body.input as { view?: string }).view : "last",
          last: { event: { tool: "computer_operation" } },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "chatgpt_setup") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          kind: "chatgpt-setup-status",
          ready: true,
          mode: body?.input && typeof body.input === "object" ? (body.input as { mode?: string }).mode : "coding",
          blockingReasons: [],
          warnings: [],
          nextActions: ["Connect ChatGPT with the MCP URL."],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "list_workspaces") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          machineId: "machine-1",
          machineName: "shape-machine",
          workspaces: [
            {
              id: "app",
              name: "App",
              path: "/workspace/app",
              permissions: { read: true, write: true, shell: false, codex: false },
              allowedOperations: ["read", "search_text", "coding_context"],
            },
          ],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "operation_registry") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          kind: "computer-operation-registry",
          schemaVersion: 1,
          contract: { jsonApi: { action: "computer_operation" } },
          filters: { contract: "computer", ...(body?.input ?? {}) },
          count: 1,
          operations: [
            {
              op: "file.search",
              category: "file",
              permission: "read",
              description: "Search text quickly, preferring ripgrep when available.",
              boundary: "workspace-path-enforced",
              capabilities: ["search:read"],
              target: "path",
              requiredInput: ["query"],
              optionalInput: ["glob"],
              options: ["maxResults"],
              backendOperation: "search_text",
              legacyWorkspaceOperation: "search_text",
            },
          ],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "computer_operation") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          ok: true,
          operationId: "op_shape",
          scope: body?.scope,
          op: body?.op,
          startedAt: "2026-06-23T00:00:00.000Z",
          durationMs: 1,
          data: { entries: [] },
          warnings: [],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "workspace_operation_registry") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          kind: "operation-registry",
          schemaVersion: 1,
          contract: { jsonApi: { action: "operation" } },
          filters: { contract: "workspace", ...(body?.input ?? {}) },
          count: 1,
          operations: [
            {
              operation: "search_text",
              name: "search_text",
              category: "search",
              permission: "read",
              description: "Search text",
              boundary: "workspace-path-enforced",
              capabilities: ["search:read"],
              requiredFields: ["query"],
              optionalFields: ["glob"],
            },
          ],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, data: { accepted: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new ComputerLinkerClient({
    baseUrl: "https://computer-linker.example.com/api/v1",
    ownerToken: "shape-token",
    fetch: fetchMock,
  });

  const computerInfo = await client.getComputerInfo<{ kind: string; machineName: string }>();
  assert.equal(computerInfo.kind, "computer-linker-computer-info");
  assert.equal(computerInfo.machineName, "shape-machine");
  const clientSetup = await client.clientSetup<{ kind: string; tools: string[] }>();
  assert.equal(clientSetup.kind, "computer-linker-mcp-client-setup");
  assert.ok(clientSetup.tools.includes("computer_operation"));
  await client.computerOperation({
    scope: "app",
    op: "file.read",
    target: "README.md",
    options: { maxBytes: 100 },
  });
  const operationHistory = await client.getOperationHistory<{ view: string }>({ scope: "app", view: "last", limit: 10 });
  assert.equal(operationHistory.view, "last");
  await client.chatGptSetup("coding");
  await client.operationRegistry({ category: "search", permission: "read", query: "text" });
  await client.workspaceOperationRegistry({ category: "search", permission: "read", query: "text" });
  await client.operation({
    workspace: "app",
    op: "search_text",
    target: "src",
    input: { query: "TODO" },
    options: { maxResults: 3 },
  });
  await client.workspaceOperation("app", {
    op: "read",
    target: "README.md",
    options: { maxBytes: 100 },
  });
  await client.command("app", "npm test", { timeoutSeconds: 30 }, "packages/api");
  await client.screenList("app");
  await client.git("app", "git_diff", { paths: ["src/client.ts"] }, { maxBytes: 1000 }, ".");
  await client.historySessions({ workspaceId: "app", limit: 10 });
  await client.workspaceHistorySessions("app", { maxResults: 10 });
  const readiness = await client.connectReadiness({ registry: { category: "search" } });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.machine?.machineName, "shape-machine");
  assert.equal(readiness.recommendedWorkspace?.id, "app");
  assert.deepEqual(readiness.discovery.primary.mcpTools, [
    "get_computer_info",
    "computer_operation",
    "get_operation_history",
  ]);
  assert.equal(readiness.discovery.primary.jsonApi.actions.includes("workspace_operation"), false);
  assert.ok(readiness.discovery.compatibility.jsonApi.actions.includes("workspace_operation"));
  const smoke = await client.smoke({ timeoutMs: 1000 });
  assert.equal(smoke.ready, true);
  assert.equal(smoke.baseUrl, "https://computer-linker.example.com/");
  assert.equal(smoke.apiBaseUrl, "https://computer-linker.example.com/api/v1/");
  assert.equal(smoke.mcpServerUrl, "https://computer-linker.example.com/mcp");
  assert.deepEqual(smoke.blockingReasons, []);
  assert.ok(smoke.checks.some((check) => check.id === "api-computer-info" && check.status === "pass"));
  assert.ok(smoke.checks.some((check) => check.id === "api-read-only-operation" && check.status === "pass"));
  assert.ok(smoke.checks.some((check) => check.id === "mcp-list-tools" && check.status === "pass"));
  assert.ok(smoke.checks.some((check) => check.id === "mcp-get-computer-info" && check.status === "pass"));
  assert.ok(smoke.checks.some((check) => check.id === "mcp-read-only-operation" && check.status === "pass"));
  assert.ok(smoke.checks.some((check) => check.id === "mcp-operation-history" && check.status === "pass"));

  assert.equal(requests.length, 29);
  assert.deepEqual(requests[0].body, {
    action: "get_computer_info",
  });
  assert.deepEqual(requests[1].body, {
    action: "client_setup",
  });
  assert.deepEqual(requests[2].body, {
    action: "computer_operation",
    scope: "app",
    op: "file.read",
    target: "README.md",
    input: {},
    options: { maxBytes: 100 },
  });
  assert.deepEqual(requests[3].body, {
    action: "get_operation_history",
    input: { scope: "app", view: "last", limit: 10 },
  });
  assert.equal(requests[4].url, "https://computer-linker.example.com/api/v1/control");
  assert.equal(requests[4].authorization, "Bearer shape-token");
  assert.deepEqual(requests[4].body, {
    action: "chatgpt_setup",
    input: { mode: "coding" },
  });
  assert.deepEqual(requests[5].body, {
    action: "operation_registry",
    input: { category: "search", permission: "read", query: "text" },
  });
  assert.deepEqual(requests[6].body, {
    action: "workspace_operation_registry",
    input: { category: "search", permission: "read", query: "text" },
  });
  assert.deepEqual(requests[7].body, {
    action: "operation",
    workspace: "app",
    op: "search_text",
    target: "src",
    input: { query: "TODO" },
    options: { maxResults: 3 },
  });
  assert.deepEqual(requests[8].body, {
    action: "workspace_operation",
    workspace: "app",
    input: {
      op: "read",
      target: "README.md",
      options: { maxBytes: 100 },
    },
  });
  assert.deepEqual(requests[9].body, {
    action: "operation",
    workspace: "app",
    op: "command",
    target: "packages/api",
    input: { command: "npm test" },
    options: { timeoutSeconds: 30 },
  });
  assert.deepEqual(requests[10].body, {
    action: "computer_operation",
    scope: "app",
    op: "screen.list",
    input: {},
    options: {},
  });
  assert.deepEqual(requests[11].body, {
    action: "operation",
    workspace: "app",
    op: "git_diff",
    target: ".",
    input: { paths: ["src/client.ts"] },
    options: { maxBytes: 1000 },
  });
  assert.deepEqual(requests[12].body, {
    action: "history_insight",
    filters: {
      workspaceId: "app",
      limit: 10,
      view: "sessions",
    },
  });
  assert.deepEqual(requests[13].body, {
    action: "operation",
    workspace: "app",
    op: "history_insight",
    input: {},
    options: {
      maxResults: 10,
      view: "sessions",
    },
  });
  assert.deepEqual(requests[14].body, {
    action: "client_setup",
  });
  assert.deepEqual(requests[15].body, {
    action: "list_workspaces",
  });
  assert.deepEqual(requests[16].body, {
    action: "operation_registry",
    input: { category: "search" },
  });
  assert.equal(requests[17].url, "https://computer-linker.example.com/healthz");
  assert.equal(requests[17].method, "GET");
  assert.equal(requests[18].url, "https://computer-linker.example.com/api/v1/capabilities");
  assert.equal(requests[18].method, "GET");
  assert.equal(requests[18].authorization, "Bearer shape-token");
  assert.equal(requests[19].url, "https://computer-linker.example.com/api/v1/control");
  assert.equal(requests[19].method, "POST");
  assert.equal(requests[19].authorization, "Bearer shape-token");
  assert.deepEqual(requests[19].body, {
    action: "get_computer_info",
  });
  assert.equal(requests[20].url, "https://computer-linker.example.com/api/v1/control");
  assert.equal(requests[20].method, "POST");
  assert.equal(requests[20].authorization, "Bearer shape-token");
  assert.deepEqual(requests[20].body, {
    action: "computer_operation",
    scope: "app",
    op: "file.list",
    target: ".",
    input: {},
    options: { maxEntries: 1 },
  });
  const mcpRequests = requests.slice(21);
  assert.equal(mcpRequests[0].url, "https://computer-linker.example.com/mcp");
  assert.equal(mcpRequests[0].method, "POST");
  assert.equal(mcpRequests[0].authorization, "Bearer shape-token");
  assert.equal(mcpRequests[0].body?.method, "initialize");
  assert.equal((mcpRequests[0].body?.params as { clientInfo?: { name?: string } }).clientInfo?.name, "computer-linker-sdk-smoke");
  assert.equal(mcpRequests[1].body?.method, "notifications/initialized");
  assert.equal(mcpRequests[1].mcpSessionId, "shape-smoke-session");
  assert.equal(mcpRequests[2].method, "GET");
  assert.equal(mcpRequests[2].mcpSessionId, "shape-smoke-session");
  assert.equal(mcpRequests[3].body?.method, "tools/list");
  assert.equal(mcpRequests[3].mcpSessionId, "shape-smoke-session");
  assert.equal(mcpRequests[4].body?.method, "tools/call");
  assert.equal((mcpRequests[4].body?.params as { name?: string }).name, "get_computer_info");
  assert.equal(mcpRequests[4].mcpSessionId, "shape-smoke-session");
  assert.equal(mcpRequests[5].body?.method, "tools/call");
  assert.deepEqual(mcpRequests[5].body?.params, {
    name: "computer_operation",
    arguments: {
      scope: "app",
      op: "file.list",
      target: ".",
      input: {},
      options: { maxEntries: 1 },
    },
  });
  assert.equal(mcpRequests[5].mcpSessionId, "shape-smoke-session");
  assert.equal(mcpRequests[6].body?.method, "tools/call");
  assert.deepEqual(mcpRequests[6].body?.params, {
    name: "get_operation_history",
    arguments: {
      view: "last",
      limit: 5,
    },
  });
  assert.equal(mcpRequests[6].mcpSessionId, "shape-smoke-session");
  assert.equal(mcpRequests[7].url, "https://computer-linker.example.com/mcp");
  assert.equal(mcpRequests[7].method, "DELETE");
  assert.equal(mcpRequests[7].authorization, "Bearer shape-token");
  assert.equal(mcpRequests[7].mcpSessionId, "shape-smoke-session");
}

async function assertComputerHelperPayloads(): Promise<void> {
  const requests: Array<Record<string, unknown> | undefined> = [];
  const fetchMock: typeof fetch = async (_input, init) => {
    requests.push(init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined);
    return new Response(JSON.stringify({
      ok: true,
      data: {
        ok: true,
        operationId: "op_helper",
        scope: "app",
        op: "file.read",
        startedAt: "2026-06-23T00:00:00.000Z",
        durationMs: 1,
        data: {},
        warnings: [],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new ComputerLinkerClient({
    baseUrl: "https://computer-linker.example.com/api/v1",
    ownerToken: "helper-token",
    fetch: fetchMock,
  });

  await client.computer.file.read("app", "README.md", { maxBytes: 100 });
  await client.computer.file.search("app", "TODO", { glob: "*.ts" }, { maxResults: 20 }, "src");
  await client.computer.command.run("app", "npm test", { timeoutSeconds: 120 }, ".");
  await client.computer.git.diff("app", { paths: ["src/client.ts"], staged: false }, { maxBytes: 1000 }, ".");
  await client.computer.package.run("app", "test", { scriptArgs: ["--watch=false"] }, { timeoutSeconds: 120 }, ".");
  await client.computer.codex.run("app", "Fix the failing tests", { timeoutSeconds: 1800 }, ".");

  assert.deepEqual(requests, [
    {
      action: "computer_operation",
      scope: "app",
      op: "file.read",
      target: "README.md",
      input: {},
      options: { maxBytes: 100 },
    },
    {
      action: "computer_operation",
      scope: "app",
      op: "file.search",
      target: "src",
      input: { query: "TODO", glob: "*.ts" },
      options: { maxResults: 20 },
    },
    {
      action: "computer_operation",
      scope: "app",
      op: "command.run",
      target: ".",
      input: { command: "npm test" },
      options: { timeoutSeconds: 120 },
    },
    {
      action: "computer_operation",
      scope: "app",
      op: "git.diff",
      target: ".",
      input: { paths: ["src/client.ts"], staged: false },
      options: { maxBytes: 1000 },
    },
    {
      action: "computer_operation",
      scope: "app",
      op: "package.run",
      target: ".",
      input: { script: "test", scriptArgs: ["--watch=false"] },
      options: { timeoutSeconds: 120 },
    },
    {
      action: "computer_operation",
      scope: "app",
      op: "codex.run",
      target: ".",
      input: { prompt: "Fix the failing tests" },
      options: { timeoutSeconds: 1800 },
    },
  ]);
}
