import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatGptSmoke } from "./chatgpt.js";
import { writeConfig } from "./config.js";
import { serveHttp } from "./server.js";

const originalConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalLocalPortConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "computer-linker-smoke-test-"));
const workspaceRoot = join(root, "workspace");
const configRoot = join(root, "config");
const port = await getAvailablePort();

try {
  process.env.COMPUTER_LINKER_CONFIG_DIR = configRoot;
  delete process.env.LOCALPORT_CONFIG_DIR;
  await mkdir(workspaceRoot, { recursive: true });
  writeConfig({
    machineName: "smoke-test",
    host: "127.0.0.1",
    port,
    ownerToken: "smoke-token",
    publicBaseUrl: "https://computer-linker.example.com",
    workspaces: [
      {
        id: "app",
        name: "App",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
    ],
  });

  const server = serveHttp();
  try {
    await waitForServer();
    const report = await chatGptSmoke({
      machineName: "smoke-test",
      host: "127.0.0.1",
      port,
      ownerToken: "smoke-token",
      workspaces: [],
    }, {
      url: `http://127.0.0.1:${port}`,
      allowHttp: true,
    });
    assert.equal(report.kind, "chatgpt-smoke");
    assert.equal(report.ready, true, JSON.stringify(report, null, 2));
    assert.equal(report.baseUrl, `http://127.0.0.1:${port}/`);
    assert.equal(report.mcpServerUrl, `http://127.0.0.1:${port}/mcp`);
    assert.deepEqual(report.blockingReasons, []);
    assert.ok(report.warnings.some((warning) => warning.includes("HTTP URL")));
    assert.ok(report.checks.some((check) => check.id === "healthz" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "capabilities" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "api-computer-info" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "api-read-only-operation" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "mcp-initialize" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "mcp-list-tools" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "mcp-get-computer-info" && check.status === "pass"));
    assert.ok(report.checks.some((check) => check.id === "mcp-read-only-operation" && check.status === "pass"));

    const publicRequests: string[] = [];
    const publicMcpOnlyReport = await chatGptSmoke({
      machineName: "smoke-test",
      ownerToken: "smoke-token",
      workspaces: [],
    }, {
      url: "https://public-smoke.example.com",
      fetchImpl: async (url, init) => {
        const requestUrl = url instanceof URL ? url.href : String(url);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        const method = String(body?.method ?? "");
        publicRequests.push(`${init?.method ?? "GET"} ${new URL(requestUrl).pathname}${method ? ` ${method}` : ""}`);
        if (new URL(requestUrl).pathname !== "/mcp") {
          return new Response("public MCP-only mode exposes /mcp only", { status: 404 });
        }
        if (init?.method === "GET") {
          return new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
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
                machineName: "smoke-test",
                scopes: [
                  {
                    id: "app",
                    type: "folder",
                    permissions: { read: true, write: false, shell: false, codex: false },
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
                operationId: "op_public_smoke",
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
            "mcp-session-id": "public-smoke-session",
          },
        });
      },
    });
    assert.equal(publicMcpOnlyReport.ready, true, JSON.stringify(publicMcpOnlyReport, null, 2));
    assert.deepEqual(publicMcpOnlyReport.blockingReasons, []);
    assert.ok(publicMcpOnlyReport.checks.some((check) => check.id === "mcp-initialize" && check.status === "pass"));
    assert.ok(publicMcpOnlyReport.checks.some((check) => check.id === "mcp-list-tools" && check.status === "pass"));
    assert.ok(publicMcpOnlyReport.checks.some((check) => check.id === "mcp-get-computer-info" && check.status === "pass"));
    assert.ok(publicMcpOnlyReport.checks.some((check) => check.id === "mcp-read-only-operation" && check.status === "pass"));
    assert.ok(publicMcpOnlyReport.checks.some((check) => check.id === "mcp-operation-history" && check.status === "pass"));
    assert.equal(publicMcpOnlyReport.checks.some((check) => check.id === "healthz"), false);
    assert.equal(publicMcpOnlyReport.checks.some((check) => check.id === "capabilities"), false);
    assert.equal(publicMcpOnlyReport.checks.some((check) => check.id === "api-computer-info"), false);
    assert.equal(publicMcpOnlyReport.checks.some((check) => check.id === "api-read-only-operation"), false);
    assert.deepEqual(publicRequests, [
      "POST /mcp initialize",
      "POST /mcp notifications/initialized",
      "GET /mcp",
      "POST /mcp tools/list",
      "POST /mcp tools/call",
      "POST /mcp tools/call",
      "POST /mcp tools/call",
      "DELETE /mcp",
    ]);

    const badUrlReport = await chatGptSmoke({
      machineName: "smoke-test",
      ownerToken: "smoke-token",
      workspaces: [],
    }, {
      url: "not a url",
    });
    assert.equal(badUrlReport.ready, false);
    assert.ok(badUrlReport.blockingReasons.some((reason) => reason.includes("base-url")));
  } finally {
    server.close();
  }
} finally {
  if (originalConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  else process.env.COMPUTER_LINKER_CONFIG_DIR = originalConfigDir;

  if (originalLocalPortConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalLocalPortConfigDir;

  await rm(root, { recursive: true, force: true });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Smoke test server did not start");
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (!address || typeof address === "string") throw new Error("Could not allocate a local test port");
  return address.port;
}
