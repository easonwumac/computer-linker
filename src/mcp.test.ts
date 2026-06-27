import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeConfig } from "./config.js";
import { serveHttp } from "./server.js";

const require = createRequire(import.meta.url);
const tsxCliPath = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const sourcePackageJson = require("../package.json") as { version: string };
const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "localport-mcp-test-"));
const configRoot = join(root, "config");
const workspaceRoot = join(root, "workspace");

try {
  process.env.LOCALPORT_CONFIG_DIR = configRoot;
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "hello from MCP\n", "utf8");
  writeConfig({
    machineName: "mcp-test",
    host: "127.0.0.1",
    port: 3969,
    ownerToken: "test-token",
    workspaces: [
      {
        id: "app",
        name: "MCP app",
        path: workspaceRoot,
        permissions: { read: true, write: true, shell: false, codex: false },
      },
    ],
  });

  await runStdioMcpFlow(configRoot);
  await runCompatibilityStdioMcpFlow(configRoot);
  await runHttpMcpFlow();
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  await rm(root, { recursive: true, force: true });
}

async function runStdioMcpFlow(configRoot: string): Promise<void> {
  const client = new Client({ name: "localport-stdio-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCliPath, "src/cli.ts", "serve"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOCALPORT_CONFIG_DIR: configRoot,
    },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    await assertMcpToolFlow(client);
  } finally {
    await client.close();
  }
}

async function runCompatibilityStdioMcpFlow(configRoot: string): Promise<void> {
  const client = new Client({ name: "localport-compatibility-stdio-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCliPath, "src/cli.ts", "serve"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOCALPORT_CONFIG_DIR: configRoot,
      COMPUTER_LINKER_MCP_TOOL_SURFACE: "compatibility",
    },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    await assertMcpToolFlow(client, "compatibility");
  } finally {
    await client.close();
  }
}

async function runHttpMcpFlow(): Promise<void> {
  const server = serveHttp();
  const client = new Client({ name: "localport-http-test-client", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3969/mcp"), {
    requestInit: {
      headers: {
        authorization: "Bearer test-token",
      },
    },
  });

  try {
    await client.connect(transport);
    await assertMcpToolFlow(client);
  } finally {
    await client.close();
    server.close();
  }
}

async function assertMcpToolFlow(client: Client, surface: "generic" | "compatibility" = "generic"): Promise<void> {
  assert.match(client.getInstructions() ?? "", /start with get_computer_info/);
  assert.match(client.getInstructions() ?? "", /stable envelope: scope, op, target, input, options/);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    (surface === "compatibility"
      ? [
          "computer_operation",
          "create_file",
          "get_capabilities",
          "get_computer_info",
          "get_operation_history",
          "glob",
          "grep",
          "list_workspaces",
          "ls",
          "open_workspace",
          "read",
          "workspace_operation",
        ]
      : [
          "computer_operation",
          "get_computer_info",
          "get_operation_history",
        ]),
  );
  for (const tool of tools.tools) {
    assert.ok(tool.outputSchema, `${tool.name} should define outputSchema`);
    assert.equal((tool.outputSchema as { type?: unknown }).type, "object");
  }
  const computerInfoTool = tools.tools.find((tool) => tool.name === "get_computer_info");
  assert.ok(computerInfoTool);
  assert.equal(computerInfoTool.annotations?.readOnlyHint, true);

  const computerOperationTool = tools.tools.find((tool) => tool.name === "computer_operation");
  assert.ok(computerOperationTool);
  assert.equal(computerOperationTool.annotations?.readOnlyHint, false);
  const computerOperationProperties = Object.keys((computerOperationTool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
  assert.deepEqual(computerOperationProperties.sort(), ["input", "op", "options", "scope", "target"]);

  const workspaceOperationTool = tools.tools.find((tool) => tool.name === "workspace_operation");
  if (surface === "compatibility") {
    assert.ok(workspaceOperationTool);
    assert.equal(workspaceOperationTool.annotations?.readOnlyHint, false);
    const workspaceOperationProperties = Object.keys((workspaceOperationTool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
    assert.deepEqual(workspaceOperationProperties.sort(), ["input", "op", "options", "target", "workspaceId"]);
  } else {
    assert.equal(workspaceOperationTool, undefined);
  }

  const directReadTool = tools.tools.find((tool) => tool.name === "read");
  const createFileTool = tools.tools.find((tool) => tool.name === "create_file");
  if (surface === "compatibility") {
    assert.ok(directReadTool);
    assert.equal(directReadTool.annotations?.readOnlyHint, true);
    assert.ok(createFileTool);
    assert.equal(createFileTool.annotations?.readOnlyHint, false);
    assert.equal(createFileTool.annotations?.destructiveHint, false);
  } else {
    assert.equal(directReadTool, undefined);
    assert.equal(createFileTool, undefined);
  }

  const computerInfoResult = await client.callTool({ name: "get_computer_info", arguments: {} });
  assert.equal(toolStructured(computerInfoResult).kind, "computer-linker-computer-info");
  const computerInfo = toolJson(computerInfoResult) as {
    kind: string;
    machineName: string;
    service: { version: string };
    scopes: Array<{ id: string; type: string; allowedOperations: string[] }>;
    operationContract: { mcp: { tool: string } };
    operationRegistry: Array<{ op: string; backendOperation: string }>;
    compatibility: { genericTools: string[]; workspaceTools: string[] };
  };
  assert.equal(computerInfo.kind, "computer-linker-computer-info");
  assert.equal(computerInfo.machineName, "mcp-test");
  assert.equal(computerInfo.service.version, sourcePackageJson.version);
  assert.equal(computerInfo.scopes[0].id, "app");
  assert.equal(computerInfo.scopes[0].type, "folder");
  assert.ok(computerInfo.scopes[0].allowedOperations.includes("read"));
  assert.equal(computerInfo.operationContract.mcp.tool, "computer_operation");
  assert.ok(computerInfo.operationRegistry.some((entry) => entry.op === "file.read" && entry.backendOperation === "read"));
  assert.ok(computerInfo.operationRegistry.some((entry) => entry.op === "file.create" && entry.backendOperation === "create_file"));
  assert.ok(computerInfo.operationRegistry.some((entry) => entry.op === "code.context" && entry.backendOperation === "coding_context"));
  assert.ok(computerInfo.operationRegistry.some((entry) => entry.op === "git.diff" && entry.backendOperation === "git_diff"));
  assert.ok(computerInfo.compatibility.genericTools.includes("computer_operation"));
  assert.ok(computerInfo.compatibility.workspaceTools.includes("workspace_operation"));
  assert.ok(computerInfo.compatibility.workspaceTools.includes("read"));

  const genericReadResult = await client.callTool({
    name: "computer_operation",
    arguments: {
      scope: "app",
      op: "file.read",
      target: "hello.txt",
      options: { maxBytes: 5 },
    },
  });
  assert.equal(toolStructured(genericReadResult).ok, true);
  const genericRead = toolJson(genericReadResult) as { ok: boolean; operationId: string; scope: string; op: string; data: { content: string; truncated: boolean } };
  assert.equal(genericRead.ok, true);
  assert.match(genericRead.operationId, /^op_/);
  assert.equal(genericRead.scope, "app");
  assert.equal(genericRead.op, "file.read");
  assert.equal(genericRead.data.content, "hello");
  assert.equal(genericRead.data.truncated, true);

  const genericSearch = toolJson(await client.callTool({
    name: "computer_operation",
    arguments: {
      scope: "app",
      op: "file.search",
      target: ".",
      input: { query: "MCP", glob: "*.txt" },
      options: { maxResults: 5 },
    },
  })) as { ok: boolean; data: { matches: string[] } };
  assert.equal(genericSearch.ok, true);
  assert.match(genericSearch.data.matches.join("\n"), /hello\.txt/);

  const genericUnknownOperation = toolJson(await client.callTool({
    name: "computer_operation",
    arguments: {
      scope: "app",
      op: "file.nope",
      target: "hello.txt",
    },
  })) as { ok: boolean; scope: string; op: string; error: { code: string; retryable: boolean } };
  assert.equal(genericUnknownOperation.ok, false);
  assert.equal(genericUnknownOperation.scope, "app");
  assert.equal(genericUnknownOperation.op, "file.nope");
  assert.equal(genericUnknownOperation.error.code, "unknown_operation");
  assert.equal(genericUnknownOperation.error.retryable, false);

  const genericHistory = toolJson(await client.callTool({
    name: "get_operation_history",
    arguments: {
      scope: "app",
      view: "last",
      limit: 20,
    },
  })) as { view: string; last: { event?: { tool?: string }; workspaceOperation?: { tool?: string; workspaceId?: string; workspaceRef?: string; operation?: string } } };
  assert.equal(genericHistory.view, "last");
  assert.ok(genericHistory.last.event);
  assert.equal(genericHistory.last.workspaceOperation?.tool, "computer_operation");
  assert.equal(genericHistory.last.workspaceOperation?.workspaceId, "app");
  assert.equal(genericHistory.last.workspaceOperation?.workspaceRef, "app");
  assert.match(genericHistory.last.workspaceOperation?.operation ?? "", /^file\./);

  if (surface !== "compatibility") return;

  const listed = toolJson(await client.callTool({ name: "list_workspaces", arguments: {} })) as {
    machineId?: string;
    machineName: string;
    workspaces: Array<{ id: string; permissions: { read: boolean; write: boolean }; capabilityPolicy: { capabilities: string[] }; allowedOperations: string[] }>;
  };
  assert.match(listed.machineId ?? "", /^machine_/);
  assert.equal(listed.machineName, "mcp-test");
  assert.equal(listed.workspaces[0].id, "app");
  assert.equal(listed.workspaces[0].permissions.read, true);
  assert.ok(listed.workspaces[0].capabilityPolicy.capabilities.includes("fs:write"));
  assert.ok(listed.workspaces[0].allowedOperations.includes("read"));
  assert.ok(listed.workspaces[0].allowedOperations.includes("write"));

  const opened = toolJson(await client.callTool({
    name: "open_workspace",
    arguments: { workspaceRef: "app" },
  })) as { workspaceId: string; configuredWorkspaceId: string; capabilityPolicy: { capabilities: string[] }; allowedOperations: string[] };
  assert.equal(opened.configuredWorkspaceId, "app");
  assert.match(opened.workspaceId, /^ws_/);
  assert.ok(opened.capabilityPolicy.capabilities.includes("git:write"));
  assert.ok(opened.allowedOperations.includes("write_if_unchanged"));

  const directRead = toolJson(await client.callTool({
    name: "read",
    arguments: {
      workspaceId: opened.workspaceId,
      path: "hello.txt",
      maxBytes: 5,
    },
  })) as { content: string; truncated: boolean };
  assert.equal(directRead.content, "hello");
  assert.equal(directRead.truncated, true);

  const directLs = toolJson(await client.callTool({
    name: "ls",
    arguments: {
      workspaceId: opened.workspaceId,
      path: ".",
    },
  })) as { entries: Array<{ path: string; type: string }> };
  assert.ok(directLs.entries.some((entry) => entry.path === "hello.txt" && entry.type === "file"));

  const directGrep = toolJson(await client.callTool({
    name: "grep",
    arguments: {
      workspaceId: opened.workspaceId,
      query: "MCP",
      glob: "*.txt",
      maxResults: 5,
    },
  })) as { matches: string[] };
  assert.match(directGrep.matches.join("\n"), /hello\.txt/);

  const directGlob = toolJson(await client.callTool({
    name: "glob",
    arguments: {
      workspaceId: opened.workspaceId,
      pattern: "*.txt",
      maxResults: 20,
    },
  })) as { matches: string[] };
  assert.ok(directGlob.matches.some((entry) => entry.endsWith("hello.txt")));

  const createdPath = `created-${opened.workspaceId}.txt`;
  const directCreate = toolJson(await client.callTool({
    name: "create_file",
    arguments: {
      workspaceId: opened.workspaceId,
      path: createdPath,
      content: "created through MCP\n",
    },
  })) as { path: string; created: boolean; sizeBytes: number; sha256: string };
  assert.equal(directCreate.path, createdPath);
  assert.equal(directCreate.created, true);
  assert.equal(directCreate.sizeBytes, "created through MCP\n".length);
  assert.match(directCreate.sha256, /^[a-f0-9]{64}$/);

  const read = toolJson(await client.callTool({
    name: "workspace_operation",
    arguments: {
      workspaceId: opened.workspaceId,
      op: "read",
      target: "hello.txt",
    },
  })) as { content: string; sha256: string };
  assert.equal(read.content, "hello from MCP\n");
  assert.match(read.sha256, /^[a-f0-9]{64}$/);

  const readV2 = toolJson(await client.callTool({
    name: "workspace_operation",
    arguments: {
      workspaceId: opened.workspaceId,
      op: "read",
      target: "hello.txt",
      options: { maxBytes: 5 },
    },
  })) as { content: string; truncated: boolean };
  assert.equal(readV2.content, "hello");
  assert.equal(readV2.truncated, true);

  const readMany = toolJson(await client.callTool({
    name: "workspace_operation",
    arguments: {
      workspaceId: opened.workspaceId,
      op: "read_many",
      input: { paths: ["hello.txt"] },
      options: { maxBytes: 5 },
    },
  })) as { files: Array<{ path: string; content: string; truncated: boolean; sizeBytes: number; sha256: string }> };
  assert.equal(readMany.files[0].path, "hello.txt");
  assert.equal(readMany.files[0].content, "hello");
  assert.equal(readMany.files[0].truncated, true);
  assert.equal(readMany.files[0].sizeBytes, "hello from MCP\n".length);
  assert.match(readMany.files[0].sha256, /^[a-f0-9]{64}$/);
}

function toolJson(result: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool result did not include text content");
  return JSON.parse(text);
}

function toolStructured(result: unknown): Record<string, unknown> {
  const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
  assert.ok(structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent));
  return structuredContent as Record<string, unknown>;
}
