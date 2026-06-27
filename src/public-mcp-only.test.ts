import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "./config.js";
import { serveHttp } from "./server.js";

const originalConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalLocalPortConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "computer-linker-public-mcp-test-"));
const workspaceRoot = join(root, "workspace");
const configRoot = join(root, "config");
const port = await getAvailablePort();
const publicHost = "mcp-only.example.com";

try {
  process.env.COMPUTER_LINKER_CONFIG_DIR = configRoot;
  delete process.env.LOCALPORT_CONFIG_DIR;
  await mkdir(workspaceRoot, { recursive: true });
  writeConfig({
    machineName: "public-mcp-only-test",
    host: "127.0.0.1",
    port,
    ownerToken: "test-token",
    publicBaseUrl: `https://${publicHost}`,
    publicMcpOnly: true,
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

    const localHealth = await get("/healthz");
    assert.equal(localHealth.status, 200);

    const localApi = await get("/api/v1/capabilities", authHeaders());
    assert.equal(localApi.status, 200);

    const publicApi = await get("/api/v1/capabilities", {
      ...authHeaders(),
      host: publicHost,
    });
    assert.equal(publicApi.status, 404);
    assert.match(publicApi.bodyText, /public MCP-only mode exposes \/mcp only/);

    const publicLegacyDashboard = await get("/dashboard", {
      ...authHeaders(),
      host: `${publicHost}:443`,
    });
    assert.equal(publicLegacyDashboard.status, 404);

    const publicHealth = await get("/healthz", {
      "x-forwarded-host": publicHost,
    });
    assert.equal(publicHealth.status, 404);

    const spoofedLocalApi = await get("/api/v1/capabilities", {
      ...authHeaders(),
      host: "127.0.0.1",
      "x-forwarded-host": publicHost,
    });
    assert.equal(spoofedLocalApi.status, 404);
    assert.match(spoofedLocalApi.bodyText, /public MCP-only mode exposes \/mcp only/);

    const spoofedLocalHealth = await get("/healthz", {
      host: "localhost",
      "x-forwarded-for": "203.0.113.10",
    });
    assert.equal(spoofedLocalHealth.status, 404);
    assert.match(spoofedLocalHealth.bodyText, /public MCP-only mode exposes \/mcp only/);

    const quickTunnelLegacyDashboard = await get("/dashboard", {
      ...authHeaders(),
      host: "temporary.trycloudflare.com",
    });
    assert.equal(quickTunnelLegacyDashboard.status, 404);

    const publicMcp = await get("/mcp", {
      ...authHeaders(),
      host: "temporary.trycloudflare.com",
    });
    assert.notEqual(publicMcp.status, 404);
    assert.doesNotMatch(publicMcp.bodyText, /public MCP-only mode exposes \/mcp only/);
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
      const response = await get("/healthz");
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Public MCP-only test server did not start");
}

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          bodyText: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function authHeaders(): Record<string, string> {
  return { authorization: "Bearer test-token" };
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
