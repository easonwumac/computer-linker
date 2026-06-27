#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(
  process.env.WORKSPACE_LINKER_MCP_URL ??
    process.argv[2] ??
    "http://127.0.0.1:3939/mcp",
);
const token =
  process.env.WORKSPACE_LINKER_TOKEN ??
  process.env.WORKSPACE_LINKER_OWNER_TOKEN ??
  process.argv[3];

const client = new Client({
  name: "workspace-linker-minimal-client",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  },
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  console.log(`tools: ${toolNames.join(", ")}`);

  for (const requiredTool of ["get_computer_info", "computer_operation", "get_operation_history"]) {
    if (!toolNames.includes(requiredTool)) {
      throw new Error(`Missing required tool: ${requiredTool}`);
    }
  }

  const computerInfo = toolData(await client.callTool({
    name: "get_computer_info",
    arguments: {},
  }));
  const scope = readableScope(computerInfo);
  if (!scope) {
    throw new Error("No readable scope returned by get_computer_info.");
  }
  console.log(`scope: ${scope}`);

  const operation = toolData(await client.callTool({
    name: "computer_operation",
    arguments: {
      scope,
      op: "file.list",
      target: ".",
      input: {},
      options: { maxEntries: 5 },
    },
  }));
  if (operation?.ok !== true) {
    throw new Error(`computer_operation file.list failed: ${operation?.error?.message ?? "unknown error"}`);
  }
  console.log("file.list: ok");

  const history = toolData(await client.callTool({
    name: "get_operation_history",
    arguments: {
      view: "last",
      limit: 5,
    },
  }));
  console.log(`history: ${history?.view ?? "unknown"}`);
} finally {
  await closeClient();
}

function toolData(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = result?.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readableScope(computerInfo) {
  return computerInfo?.scopes?.find((scope) => (
    typeof scope.id === "string" &&
    (
      scope.permissions?.read === true ||
      scope.allowedOperations?.includes("file.list") ||
      scope.allowedOperations?.includes("read") ||
      scope.allowedOperations?.includes("search_text")
    )
  ))?.id;
}

async function closeClient() {
  try {
    if (transport.sessionId) await transport.terminateSession();
  } catch {
    // Best effort.
  }
  try {
    await client.close();
  } catch {
    // Best effort.
  }
}
