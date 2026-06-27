import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { writeConfig } from "./config.js";
import { serveHttp } from "./server.js";
import { listTunnelProcesses, startTunnelProcess, stopAllTunnelProcesses } from "./tunnels.js";

const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const originalPath = process.env.PATH;
const root = await mkdtemp(join(tmpdir(), "localport-api-test-"));
const configRoot = join(root, "config");
const workspaceRoot = join(root, "workspace");
const fakeBinRoot = join(root, "bin");
const baseUrl = "http://127.0.0.1:3959";

try {
  process.env.LOCALPORT_CONFIG_DIR = configRoot;
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(fakeBinRoot, { recursive: true });
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, ".codex", "skills", "api-helper"), { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "hello from LocalPort\n", "utf8");
  await writeFile(join(workspaceRoot, "lines.txt"), "one\ntwo\nthree\nfour\n", "utf8");
  await writeFile(join(workspaceRoot, "context.txt"), "before\nneedle\nAfter\n\nAgain\nneedle\nDone\n", "utf8");
  await writeFile(join(workspaceRoot, "command-fail.js"), [
    "process.stdout.write('command-out');",
    "process.stderr.write('command-err');",
    "process.exit(7);",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, "api-process.js"), [
    "process.stdout.write('api-process-out');",
    "process.stderr.write('api-process-err');",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, "AGENTS.md"), "root api guidance\n", "utf8");
  await writeFile(join(workspaceRoot, ".codex", "skills", "api-helper", "SKILL.md"), "# API Helper\n\nUse this skill for API work.\n", "utf8");
  await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({
    name: "api-overview-app",
    packageManager: "npm@10.0.0",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "node --test",
    },
  }, null, 2), "utf8");
  await writeFile(join(workspaceRoot, "package-lock.json"), "{}\n", "utf8");
  await writeFile(join(workspaceRoot, "tsconfig.json"), "{}\n", "utf8");
  await writeFile(join(workspaceRoot, "src/index.ts"), [
    "export interface ApiWorkspace {",
    "  id: string;",
    "}",
    "export class ApiController {}",
    "export const answer = 42;",
    "",
  ].join("\n"), "utf8");
  writeConfig({
    machineName: "api-test",
    host: "127.0.0.1",
    port: 3959,
    ownerToken: "test-token",
    workspaces: [
      {
        id: "app",
        name: "Read only app",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
      {
        id: "writer",
        name: "Writable app",
        path: workspaceRoot,
        permissions: { read: true, write: true, shell: false, codex: false },
      },
      {
        id: "runner",
        name: "Command runner",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: true, codex: false, screen: true },
      },
    ],
  });

  const server = serveHttp();
  try {
    await waitForApi();

    const unauthenticated = await getJson("/api/v1/workspaces", false);
    assert.equal(unauthenticated.status, 401);

    const unauthenticatedControl = await postJson("/api/v1/control", { action: "get_capabilities" }, false);
    assert.equal(unauthenticatedControl.status, 401);

    const workspaces = await getJson("/api/v1/workspaces");
    assert.equal(workspaces.status, 200);
    assert.equal(workspaces.body.ok, true);
    assert.match(workspaces.body.data.machineId, /^machine_/);
    assert.equal(workspaces.body.data.workspaces.length, 3);
    assert.equal(workspaces.body.data.workspaces[0].id, "app");
    assert.ok(workspaces.body.data.workspaces[0].allowedOperations.includes("read"));
    assert.ok(workspaces.body.data.workspaces[0].allowedOperations.includes("coding_context"));
    assert.equal(workspaces.body.data.workspaces[0].allowedOperations.includes("write"), false);
    assert.ok(workspaces.body.data.workspaces[0].capabilityPolicy.capabilities.includes("history:read"));
    assert.ok(workspaces.body.data.workspaces[0].capabilityPolicy.capabilities.includes("network:false"));
    assert.equal(workspaces.body.data.workspaces[0].allowedOperations.includes("command"), false);
    assert.ok(workspaces.body.data.workspaces.find((workspace: { id: string }) => workspace.id === "runner").allowedOperations.includes("package_run"));

    const capabilities = await getJson("/api/v1/capabilities");
    assert.equal(capabilities.status, 200);
    assert.match(capabilities.body.data.machineId, /^machine_/);
    assert.equal(capabilities.body.data.machineName, "api-test");
    assert.equal(capabilities.body.data.machine.id, capabilities.body.data.machineId);
    assert.equal(capabilities.body.data.machine.hostname, "api-test");
    assert.equal(capabilities.body.data.machine.nodeVersion, process.version);
    assert.equal(typeof capabilities.body.data.machine.platform, "string");
    assert.equal(capabilities.body.data.connectionProfile.machineName, "api-test");
    assert.equal(capabilities.body.data.connectionProfile.machineId, capabilities.body.data.machineId);
    assert.equal(capabilities.body.data.connectionProfile.http.auth.header, "Authorization: Bearer <ownerToken>");
    assert.equal(capabilities.body.data.connectionProfile.http.auth.bearerToken, undefined);
    assert.ok(capabilities.body.data.workspaces[0].allowedOperations.includes("read"));
    assert.equal(capabilities.body.data.workspaces[0].allowedOperations.includes("write"), false);
    assert.equal(capabilities.body.data.workspaces[0].allowedOperations.includes("git_stage"), false);
    assert.ok(capabilities.body.data.workspaces[0].capabilityPolicy.capabilities.includes("fs:read"));
    assert.equal(capabilities.body.data.workspaces[0].capabilityPolicy.capabilities.includes("fs:write"), false);
    assert.ok(capabilities.body.data.workspaces.find((workspace: { id: string }) => workspace.id === "writer").capabilityPolicy.capabilities.includes("git:write"));
    const runnerCapabilities = capabilities.body.data.workspaces.find((workspace: { id: string }) => workspace.id === "runner") as {
      capabilityPolicy: { capabilities: string[] };
      allowedOperations: string[];
    };
    assert.ok(runnerCapabilities.capabilityPolicy.capabilities.includes("screen:capture"));
    assert.ok(capabilities.body.data.capabilityPolicy.supportedCapabilities.includes("process:manage"));
    assert.ok(capabilities.body.data.capabilityPolicy.supportedCapabilities.includes("screen:capture"));
    assert.equal(capabilities.body.data.capabilityPolicy.source, "derived-from-workspace-permissions");
    assert.equal(capabilities.body.data.mcpToolSurface.active, "generic");
    assert.deepEqual(capabilities.body.data.mcpTools, [
      "get_computer_info",
      "computer_operation",
      "get_operation_history",
    ]);
    assert.equal(capabilities.body.data.jsonApi.unifiedEndpoint, "POST /control");
    assert.ok(capabilities.body.data.jsonApi.actions.includes("get_computer_info"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("client_setup"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("computer_operation"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("get_operation_history"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("doctor"));
    assert.equal(capabilities.body.data.jsonApi.actions.includes("chatgpt_setup"), false);
    assert.ok(capabilities.body.data.jsonApi.actions.includes("history_insight"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("operation_registry"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("computer_operation_registry"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("workspace_operation_registry"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("workspace_operation"));
    assert.ok(capabilities.body.data.jsonApi.actions.includes("operation"));
    assert.ok(capabilities.body.data.jsonApi.endpoints.includes("POST /control"));
    assert.deepEqual(capabilities.body.data.clientGuidance.recommendedFlow, ["get_computer_info", "client_setup", "computer_operation", "get_operation_history"]);
    assert.equal(capabilities.body.data.clientGuidance.preferredControlShape.action, "computer_operation");
    assert.equal(capabilities.body.data.clientGuidance.preferredControlShape.op, "file.read");
    assert.equal(capabilities.body.data.clientGuidance.preferredWorkspaceOperationShape.op, "read");
    assert.equal(capabilities.body.data.computerOperationContract.mcp.tool, "computer_operation");
    assert.equal(capabilities.body.data.computerOperationContract.envelope.op, "file.read");
    assert.ok(capabilities.body.data.computerOperationContract.compatibility.acceptsLegacyWorkspaceOps);
    const genericFileRead = capabilities.body.data.computerOperationRegistry.find((entry: { op: string }) => entry.op === "file.read");
    assert.equal(genericFileRead.backendOperation, "read");
    assert.equal(genericFileRead.target, "path");
    assert.ok(genericFileRead.options.includes("maxBytes"));
    const genericScreenList = capabilities.body.data.computerOperationRegistry.find((entry: { op: string }) => entry.op === "screen.list");
    assert.equal(genericScreenList.backendOperation, "screen_list");
    assert.ok(genericScreenList.capabilities.includes("screen:capture"));
    const screenModes = new Set(capabilities.body.data.screenshot.modes as string[]);
    const genericScreenOps = new Set(capabilities.body.data.computerOperationRegistry
      .filter((entry: { category: string }) => entry.category === "screen")
      .map((entry: { op: string }) => entry.op));
    const runnerAllowedOps = new Set(runnerCapabilities.allowedOperations);
    assert.ok(genericScreenOps.has("screen.list"));
    assert.ok(runnerAllowedOps.has("screen_list"));
    assert.equal(genericScreenOps.has("screen.capture"), screenModes.has("display"));
    assert.equal(genericScreenOps.has("screen.capture_window"), screenModes.has("window"));
    assert.equal(genericScreenOps.has("screen.capture_process"), screenModes.has("process"));
    assert.equal(runnerAllowedOps.has("screen_capture"), screenModes.has("display"));
    assert.equal(runnerAllowedOps.has("screen_capture_window"), screenModes.has("window"));
    assert.equal(runnerAllowedOps.has("screen_capture_process"), screenModes.has("process"));
    assert.equal(capabilities.body.data.operationContract.mcp.tool, "workspace_operation");
    assert.deepEqual(capabilities.body.data.operationContract.mcp.requiredFields, ["workspaceId", "op"]);
    assert.equal(capabilities.body.data.operationContract.jsonApi.action, "operation");
    assert.equal(capabilities.body.data.operationContract.envelope.op, "read");
    assert.ok(capabilities.body.data.clientGuidance.examples.some((example: { operation?: { op: string } }) => example.operation?.op === "code.context"));
    assert.ok(capabilities.body.data.clientGuidance.examples.some((example: { control?: { action: string } }) => example.control?.action === "client_setup"));
    assert.equal(capabilities.body.data.clientGuidance.examples.some((example: { control?: { action: string } }) => example.control?.action === "chatgpt_setup"), false);
    assert.equal(capabilities.body.data.exposure.authMode, "owner-token-or-oauth");
    assert.equal(capabilities.body.data.exposure.localOnly, false);
    assert.equal(capabilities.body.data.exposure.publicBaseUrlConfigured, false);
    assert.equal(typeof capabilities.body.data.exposure.readyForTunnel, "boolean");
    assert.ok(Array.isArray(capabilities.body.data.exposure.tunnelToolsAvailable));
    assert.ok(Array.isArray(capabilities.body.data.exposure.blockingReasons));
    assert.ok(capabilities.body.data.exposure.warnings.includes("publicBaseUrl should be configured to the tunnel origin for OAuth clients"));

    const computerInfo = await postJson("/api/v1/control", {
      action: "get_computer_info",
    });
    assert.equal(computerInfo.status, 200);
    assert.equal(computerInfo.body.data.kind, "workspace-linker-computer-info");
    assert.equal(computerInfo.body.data.machineName, "api-test");
    assert.equal(computerInfo.body.data.scopes[0].id, "app");
    assert.equal(computerInfo.body.data.scopes[0].type, "folder");
    assert.ok(computerInfo.body.data.scopes[0].allowedOperations.includes("read"));
    assert.equal(computerInfo.body.data.operationContract.mcp.tool, "computer_operation");
    assert.ok(computerInfo.body.data.operationRegistry.some((entry: { op: string; backendOperation: string }) => (
      entry.op === "file.search" && entry.backendOperation === "search_text"
    )));
    assert.ok(computerInfo.body.data.operationRegistry.some((entry: { op: string; backendOperation: string; category: string }) => (
      entry.op === "code.context" && entry.backendOperation === "coding_context" && entry.category === "code"
    )));
    assert.ok(computerInfo.body.data.operationRegistry.some((entry: { op: string; backendOperation: string; category: string }) => (
      entry.op === "git.diff" && entry.backendOperation === "git_diff" && entry.category === "git"
    )));
    assert.ok(computerInfo.body.data.operationRegistry.some((entry: { op: string; backendOperation: string; category: string }) => (
      entry.op === "package.run" && entry.backendOperation === "package_run" && entry.category === "package"
    )));
    assert.ok(computerInfo.body.data.compatibility.genericTools.includes("computer_operation"));

    const clientSetup = await postJson("/api/v1/control", {
      action: "client_setup",
    });
    assert.equal(clientSetup.status, 200);
    assert.equal(clientSetup.body.data.kind, "workspace-linker-mcp-client-setup");
    assert.equal(clientSetup.body.data.machineName, "api-test");
    assert.equal(clientSetup.body.data.localReady, true);
    assert.equal(clientSetup.body.data.remoteReady, false);
    assert.deepEqual(clientSetup.body.data.blockingReasons, []);
    assert.ok(clientSetup.body.data.remoteBlockingReasons.some((reason: string) => reason.includes("No public MCP URL")));
    assert.equal(clientSetup.body.data.connection.localMcpUrl, "http://127.0.0.1:3959/mcp");
    assert.equal(clientSetup.body.data.auth.bearerHeader, "Authorization: Bearer <ownerToken>");
    assert.deepEqual(clientSetup.body.data.tools, ["get_computer_info", "computer_operation", "get_operation_history"]);
    assert.equal(clientSetup.body.data.operationShape.tool, "computer_operation");
    assert.equal(clientSetup.body.data.operationShape.contract.mcp.tool, "computer_operation");
    assert.ok(clientSetup.body.data.operationShape.registry.some((entry: { op: string; backendOperation: string }) => (
      entry.op === "command.run" && entry.backendOperation === "command"
    )));
    assert.doesNotMatch(JSON.stringify(clientSetup.body.data), /test-token/);

    const computerRead = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "app",
      op: "file.read",
      target: "hello.txt",
      options: { maxBytes: 5 },
    });
    assert.equal(computerRead.status, 200);
    assert.equal(computerRead.body.data.ok, true);
    assert.match(computerRead.body.data.operationId, /^op_/);
    assert.equal(computerRead.body.data.scope, "app");
    assert.equal(computerRead.body.data.op, "file.read");
    assert.equal(computerRead.body.data.data.content, "hello");
    assert.equal(computerRead.body.data.data.truncated, true);

    const computerReadHistory = await postJson("/api/v1/control", {
      action: "get_operation_history",
      input: { scope: "app", view: "raw", query: "file.read", limit: 20 },
    });
    assert.equal(computerReadHistory.status, 200);
    assert.ok(computerReadHistory.body.data.events.some((event: { tool?: string; workspaceId?: string; workspaceRef?: string; operation?: string; path?: string; target?: string }) => (
      event.tool === "computer_operation" &&
      event.workspaceId === "app" &&
      event.workspaceRef === "app" &&
      event.operation === "file.read" &&
      event.path === "hello.txt" &&
      event.target === "hello.txt"
    )));

    const computerSearch = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "app",
      op: "file.search",
      target: ".",
      input: { query: "LocalPort", glob: "*.txt" },
      options: { maxResults: 5 },
    });
    assert.equal(computerSearch.status, 200);
    assert.equal(computerSearch.body.data.ok, true);
    assert.match(computerSearch.body.data.data.matches.join("\n"), /hello\.txt/);

    const computerBlockedWrite = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "app",
      op: "file.write",
      target: "blocked.txt",
      input: { content: "blocked" },
    });
    assert.equal(computerBlockedWrite.status, 200);
    assert.equal(computerBlockedWrite.body.data.ok, false);
    assert.equal(computerBlockedWrite.body.data.error.code, "permission_denied");
    assert.match(computerBlockedWrite.body.data.error.message, /write permission is disabled/);

    const computerUnknownScope = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "missing-scope",
      op: "file.read",
      target: "hello.txt",
    });
    assert.equal(computerUnknownScope.status, 200);
    assert.equal(computerUnknownScope.body.data.ok, false);
    assert.equal(computerUnknownScope.body.data.scope, "missing-scope");
    assert.equal(computerUnknownScope.body.data.op, "file.read");
    assert.equal(computerUnknownScope.body.data.error.code, "unknown_scope");
    assert.equal(computerUnknownScope.body.data.error.retryable, false);

    const computerUnknownOperation = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "app",
      op: "file.nope",
      target: "hello.txt",
    });
    assert.equal(computerUnknownOperation.status, 200);
    assert.equal(computerUnknownOperation.body.data.ok, false);
    assert.equal(computerUnknownOperation.body.data.scope, "app");
    assert.equal(computerUnknownOperation.body.data.op, "file.nope");
    assert.equal(computerUnknownOperation.body.data.error.code, "unknown_operation");

    const computerOutsidePath = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "app",
      op: "file.read",
      target: "../outside.txt",
    });
    assert.equal(computerOutsidePath.status, 200);
    assert.equal(computerOutsidePath.body.data.ok, false);
    assert.equal(computerOutsidePath.body.data.error.code, "path_out_of_scope");

    const computerInvalidRequest = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "app",
    });
    assert.equal(computerInvalidRequest.status, 200);
    assert.equal(computerInvalidRequest.body.data.ok, false);
    assert.equal(computerInvalidRequest.body.data.scope, "app");
    assert.equal(computerInvalidRequest.body.data.op, "");
    assert.equal(computerInvalidRequest.body.data.error.code, "invalid_request");

    const computerCreate = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "writer",
      op: "file.create",
      target: "created-through-computer-operation.txt",
      input: { content: "created once\n" },
    });
    assert.equal(computerCreate.status, 200);
    assert.equal(computerCreate.body.data.ok, true);
    assert.equal(computerCreate.body.data.data.created, true);
    assert.match(computerCreate.body.data.data.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(join(workspaceRoot, "created-through-computer-operation.txt"), "utf8"), "created once\n");

    const computerCreateAgain = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "writer",
      op: "file.create",
      target: "created-through-computer-operation.txt",
      input: { content: "should not overwrite\n" },
    });
    assert.equal(computerCreateAgain.status, 200);
    assert.equal(computerCreateAgain.body.data.ok, false);
    assert.match(computerCreateAgain.body.data.error.message, /File already exists/);
    assert.equal(await readFile(join(workspaceRoot, "created-through-computer-operation.txt"), "utf8"), "created once\n");

    const screenList = await postJson("/api/v1/control", {
      action: "computer_operation",
      scope: "runner",
      op: "screen.list",
    });
    assert.equal(screenList.status, 200);
    assert.equal(screenList.body.data.ok, true);
    assert.equal(typeof screenList.body.data.data.provider, "string");
    assert.ok(Array.isArray(screenList.body.data.data.displays));

    const genericOperationHistory = await postJson("/api/v1/control", {
      action: "get_operation_history",
      input: { scope: "app", view: "last", query: "file.search", limit: 20 },
    });
    assert.equal(genericOperationHistory.status, 200);
    assert.equal(genericOperationHistory.body.data.view, "last");
    assert.ok(genericOperationHistory.body.data.last.event);
    assert.equal(genericOperationHistory.body.data.last.workspaceOperation.tool, "computer_operation");
    assert.equal(genericOperationHistory.body.data.last.workspaceOperation.workspaceId, "app");
    assert.match(genericOperationHistory.body.data.last.workspaceOperation.operation, /^file\./);

    const chatGptSetup = await postJson("/api/v1/control", {
      action: "chatgpt_setup",
      input: { mode: "coding" },
    });
    assert.equal(chatGptSetup.status, 200);
    assert.equal(chatGptSetup.body.data.kind, "chatgpt-setup-status");
    assert.equal(chatGptSetup.body.data.mode, "coding");
    assert.equal(chatGptSetup.body.data.setupFields.appName, "Workspace Linker (api-test)");
    assert.equal(chatGptSetup.body.data.setupFields.bearerHeader, "Authorization: Bearer <ownerToken>");
    assert.equal(chatGptSetup.body.data.setupFields.mcpServerUrl, "http://127.0.0.1:3959/mcp");
    assert.equal(chatGptSetup.body.data.ready, false);
    assert.equal(chatGptSetup.body.data.connectProfile.serverUrl, "http://127.0.0.1:3959/mcp");
    assert.equal(chatGptSetup.body.data.connectProfile.auth.bearerHeader, "Authorization: Bearer <ownerToken>");
    assert.equal(chatGptSetup.body.data.connectProfile.cli.connectorConfig, "workspace-linker client chatgpt connector --mode coding --show-token");
    assert.ok(chatGptSetup.body.data.connectProfile.firstPrompt.includes("get_computer_info"));
    assert.ok(chatGptSetup.body.data.blockingReasons.some((reason: string) => reason.includes("public-base-url")));
    assert.equal(chatGptSetup.body.data.wizard.overallStatus, "blocked");
    assert.equal(chatGptSetup.body.data.wizard.currentStepId, "public_url");
    assert.ok(chatGptSetup.body.data.wizard.steps.some((step: { id: string; status: string }) => (
      step.id === "owner_token" && step.status === "complete"
    )));
    assert.doesNotMatch(JSON.stringify(chatGptSetup.body.data), /test-token/);

    await installFakeCloudflared(fakeBinRoot, "https://api-detected.trycloudflare.com");
    process.env.PATH = [fakeBinRoot, originalPath ?? ""].filter(Boolean).join(delimiter);
    startTunnelProcess({ provider: "cloudflare", localPort: 3959 });
    await waitForDetectedTunnelUrl("https://api-detected.trycloudflare.com");
    const detectedTunnelSetup = await postJson("/api/v1/control", {
      action: "chatgpt_setup",
      input: { mode: "coding" },
    });
    assert.equal(detectedTunnelSetup.status, 200);
    assert.equal(detectedTunnelSetup.body.data.ready, true);
    assert.equal(detectedTunnelSetup.body.data.mcpServerUrl, "https://api-detected.trycloudflare.com/mcp");
    assert.equal(detectedTunnelSetup.body.data.setupFields.mcpServerUrl, "https://api-detected.trycloudflare.com/mcp");
    assert.equal(detectedTunnelSetup.body.data.connectProfile.serverUrl, "https://api-detected.trycloudflare.com/mcp");
    assert.equal(detectedTunnelSetup.body.data.connectProfile.auth.oauthEnabled, false);
    assert.equal(detectedTunnelSetup.body.data.connectProfile.cli.publicSmoke, "workspace-linker client chatgpt smoke --url https://api-detected.trycloudflare.com");
    assert.equal(detectedTunnelSetup.body.data.wizard.detectedPublicUrl, "https://api-detected.trycloudflare.com");
    assert.equal(detectedTunnelSetup.body.data.wizard.effectiveMcpServerUrl, "https://api-detected.trycloudflare.com/mcp");
    assert.equal(detectedTunnelSetup.body.data.wizard.overallStatus, "ready");
    assert.equal(detectedTunnelSetup.body.data.wizard.currentStepId, null);
    assert.ok(detectedTunnelSetup.body.data.wizard.steps.some((step: { id: string; status: string }) => (
      step.id === "public_url" && step.status === "complete"
    )));
    assert.equal(detectedTunnelSetup.body.data.oauthDiscovery.enabled, false);
    assert.ok(detectedTunnelSetup.body.data.warnings.some((warning: string) => warning.includes("used for this setup only")));

    const searchRegistry = await postJson("/api/v1/control", {
      action: "operation_registry",
      input: { category: "search", query: "ripgrep" },
    });
    assert.equal(searchRegistry.status, 200);
    assert.equal(searchRegistry.body.data.kind, "computer-operation-registry");
    assert.equal(searchRegistry.body.data.contract.jsonApi.action, "computer_operation");
    assert.equal(searchRegistry.body.data.filters.category, "search");
    assert.equal(searchRegistry.body.data.filters.query, "ripgrep");
    assert.equal(searchRegistry.body.data.filters.contract, "computer");
    assert.ok(searchRegistry.body.data.count >= 1);
    assert.ok(searchRegistry.body.data.operations.every((operation: { op: string }) => operation.op === "file.search"));
    assert.ok(searchRegistry.body.data.operations.some((operation: { op: string; capabilities: string[] }) => (
      operation.op === "file.search" &&
      operation.capabilities.includes("search:read")
    )));
    assert.equal(searchRegistry.body.data.operations.some((operation: { run?: { execute?: unknown } }) => operation.run?.execute), false);

    const gitRegistry = await postJson("/api/v1/control", {
      action: "computer_operation_registry",
      input: { category: "git", query: "diff" },
    });
    assert.equal(gitRegistry.status, 200);
    assert.ok(gitRegistry.body.data.operations.some((operation: { op: string; backendOperation: string }) => (
      operation.op === "git.diff" &&
      operation.backendOperation === "git_diff"
    )));

    const workspaceSearchRegistry = await postJson("/api/v1/control", {
      action: "workspace_operation_registry",
      input: { category: "search", query: "ripgrep" },
    });
    assert.equal(workspaceSearchRegistry.status, 200);
    assert.equal(workspaceSearchRegistry.body.data.kind, "operation-registry");
    assert.equal(workspaceSearchRegistry.body.data.contract.jsonApi.action, "operation");
    assert.equal(workspaceSearchRegistry.body.data.filters.contract, "workspace");
    assert.ok(workspaceSearchRegistry.body.data.operations.every((operation: { category: string }) => operation.category === "search"));
    assert.ok(workspaceSearchRegistry.body.data.operations.some((operation: { operation: string; capabilities: string[] }) => (
      operation.operation === "search_text" &&
      operation.capabilities.includes("search:read")
    )));

    const workspaceSearchRegistryAlias = await postJson("/api/v1/control", {
      action: "operation_registry",
      input: { contract: "workspace", category: "search", query: "ripgrep" },
    });
    assert.equal(workspaceSearchRegistryAlias.status, 200);
    assert.equal(workspaceSearchRegistryAlias.body.data.kind, "operation-registry");
    assert.equal(workspaceSearchRegistryAlias.body.data.filters.contract, "workspace");

    assert.ok(capabilities.body.data.workspaceOperations.includes("codex"));
    assert.equal(capabilities.body.data.operationCatalog.length, capabilities.body.data.workspaceOperations.length);
    assert.ok(capabilities.body.data.workspaceOperations.includes("tree"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("explain_operation"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("instructions"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("agent_skills"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("coding_context"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("project_overview"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("history"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("history_insight"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("change_summary"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("repo_status"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_changes"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_diff"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_log"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_show"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_stage"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_unstage"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_commit"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_worktree_list"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("git_worktree_create"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("patch"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("read_many"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("write_if_unchanged"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("search_symbols"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("package_run"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("package_start"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_start"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_plan"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_review"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_fix"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_test"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_continue"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("codex_runs"));
    assert.ok(capabilities.body.data.workspaceOperations.includes("batch"));
    assert.equal(capabilities.body.data.operationSafety.length, capabilities.body.data.workspaceOperations.length);
    assert.equal(capabilities.body.data.operationRegistry.length, capabilities.body.data.workspaceOperations.length);
    assert.ok(capabilities.body.data.operationRegistry.some((operation: { operation: string; category: string; boundary: string; permission: string }) => (
      operation.operation === "search_text" &&
      operation.category === "search" &&
      operation.boundary === "workspace-path-enforced" &&
      operation.permission === "read"
    )));
    assert.ok(capabilities.body.data.operationRegistry.some((operation: { operation: string; name: string; schema: { requiredFields: string[] }; run: { handler: string }; audit: { fields: string } }) => (
      operation.operation === "search_text" &&
      operation.name === "search_text" &&
      operation.schema.requiredFields.includes("query") &&
      operation.run.handler === "runFileSearchOperation" &&
      operation.audit.fields === "workspaceOperationAuditFields"
    )));
    assert.equal(capabilities.body.data.operationRegistry.some((operation: { run: { execute?: unknown } }) => operation.run.execute), false);
    assert.ok(capabilities.body.data.operationSafety.some((entry: { operation: string; boundary: string }) => (
      entry.operation === "read" &&
      entry.boundary === "workspace-path-enforced"
    )));
    assert.ok(capabilities.body.data.operationSafety.some((entry: { operation: string; boundary: string }) => (
      entry.operation === "command" &&
      entry.boundary === "workspace-cwd-only"
    )));
    assert.ok(capabilities.body.data.operationSafety.some((entry: { operation: string; boundary: string }) => (
      entry.operation === "codex" &&
      entry.boundary === "workspace-cwd-only"
    )));
    assert.ok(capabilities.body.data.operationSafety.some((entry: { operation: string; boundary: string }) => (
      entry.operation === "batch" &&
      entry.boundary === "mixed"
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "explain_operation" &&
      operation.permission === "read"
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "tree" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("maxDepth")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "instructions" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("maxBytes")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "agent_skills" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("maxResults")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "coding_context" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("maxDepth") &&
      operation.optionalFields.includes("maxEntries") &&
      operation.optionalFields.includes("maxBytes") &&
      operation.optionalFields.includes("maxResults")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "project_overview" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("maxDepth")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "history" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("maxResults")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "change_summary" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("path") &&
      operation.optionalFields.includes("maxBytes")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "repo_status" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("includeDiff")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "git_changes" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("path")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "git_diff" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("paths") &&
      operation.optionalFields.includes("staged") &&
      operation.optionalFields.includes("maxBytes")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "git_log" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("paths") &&
      operation.optionalFields.includes("maxResults")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "git_show" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("ref") &&
      operation.optionalFields.includes("paths") &&
      operation.optionalFields.includes("maxBytes")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "git_stage" &&
      operation.permission === "write" &&
      operation.requiredFields.includes("paths") &&
      operation.optionalFields.includes("path")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "git_unstage" &&
      operation.permission === "write" &&
      operation.requiredFields.includes("paths") &&
      operation.optionalFields.includes("path")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "git_commit" &&
      operation.permission === "write" &&
      operation.requiredFields.includes("message") &&
      operation.optionalFields.includes("path")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "git_worktree_list" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("path")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "git_worktree_create" &&
      operation.permission === "write" &&
      operation.requiredFields.includes("toPath") &&
      operation.optionalFields.includes("branch") &&
      operation.optionalFields.includes("startPoint")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[] }) => (
      operation.operation === "patch" &&
      operation.permission === "write" &&
      operation.requiredFields.includes("patch")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "read" &&
      operation.permission === "read" &&
      operation.requiredFields.includes("path") &&
      operation.optionalFields.includes("startLine") &&
      operation.optionalFields.includes("lineCount") &&
      operation.optionalFields.includes("maxBytes")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "read_many" &&
      operation.permission === "read" &&
      operation.requiredFields.includes("paths") &&
      operation.optionalFields.includes("maxBytes")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[] }) => (
      operation.operation === "write_if_unchanged" &&
      operation.permission === "write" &&
      operation.requiredFields.includes("path") &&
      operation.requiredFields.includes("content") &&
      operation.requiredFields.includes("expectedSha256")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[] }) => (
      operation.operation === "codex_start" &&
      operation.permission === "codex" &&
      operation.requiredFields.includes("prompt")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[] }) => (
      operation.operation === "codex" &&
      operation.permission === "codex" &&
      operation.requiredFields.includes("prompt")
    )));
    assert.ok(capabilities.body.data.operationRegistry.some((operation: { operation: string; category: string; boundary: string; permission: string }) => (
      operation.operation === "codex_plan" &&
      operation.category === "codex" &&
      operation.boundary === "workspace-cwd-only" &&
      operation.permission === "codex"
    )));
    assert.ok(capabilities.body.data.operationRegistry.some((operation: { operation: string; capabilities: string[]; limits?: { maxRuntimeSeconds?: number } }) => (
      operation.operation === "codex_review" &&
      operation.capabilities.includes("codex:readOnly") &&
      operation.limits?.maxRuntimeSeconds === 3600
    )));
    assert.ok(capabilities.body.data.operationRegistry.some((operation: { operation: string; capabilities: string[] }) => (
      operation.operation === "git_stage" &&
      operation.capabilities.includes("git:write") &&
      operation.capabilities.includes("fs:write")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "batch" &&
      operation.permission === "mixed" &&
      operation.requiredFields.includes("operations") &&
      operation.optionalFields.includes("continueOnError")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[] }) => (
      operation.operation === "command" &&
      operation.permission === "shell" &&
      operation.requiredFields.includes("command")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "package_run" &&
      operation.permission === "shell" &&
      operation.requiredFields.includes("script") &&
      operation.optionalFields.includes("scriptArgs") &&
      operation.optionalFields.includes("timeoutSeconds")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[]; optionalFields: string[] }) => (
      operation.operation === "package_start" &&
      operation.permission === "shell" &&
      operation.requiredFields.includes("script") &&
      operation.optionalFields.includes("scriptArgs") &&
      operation.optionalFields.includes("timeoutSeconds")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "search_text" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("beforeContext") &&
      operation.optionalFields.includes("afterContext")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; optionalFields: string[] }) => (
      operation.operation === "search_symbols" &&
      operation.permission === "read" &&
      operation.optionalFields.includes("query") &&
      operation.optionalFields.includes("glob")
    )));
    assert.ok(capabilities.body.data.operationCatalog.some((operation: { operation: string; permission: string; requiredFields: string[] }) => (
      operation.operation === "process_start" &&
      operation.permission === "shell" &&
      operation.requiredFields.includes("command")
    )));
    assert.ok(capabilities.body.data.localTools.some((tool: { name: string; available: boolean }) => tool.name === "codex" && typeof tool.available === "boolean"));
    assert.ok(capabilities.body.data.localTools.some((tool: { name: string; available: boolean }) => tool.name === "rg" && typeof tool.available === "boolean"));
    assert.ok(capabilities.body.data.localTools.some((tool: { name: string; category: string; available: boolean }) => tool.name === "git" && tool.category === "vcs" && typeof tool.available === "boolean"));
    assert.equal(capabilities.body.data.codingCapabilities.workspaceBoundary, true);
    assert.equal(capabilities.body.data.codingCapabilities.fileOperations, true);
    assert.equal(typeof capabilities.body.data.codingCapabilities.fastSearch, "boolean");
    assert.equal(capabilities.body.data.codingCapabilities.agentSkills, true);
    assert.equal(capabilities.body.data.codingCapabilities.shellExecution, true);
    assert.equal(capabilities.body.data.codingCapabilities.codexExecution, false);
    assert.equal(typeof capabilities.body.data.codingCapabilities.gitWorktrees, "boolean");
    assert.equal(capabilities.body.data.codingCapabilities.durableHistory, true);
    assert.match(capabilities.body.data.security.boundaryModel.workspaceCwdOnly, /not OS filesystem sandboxes/);
    assert.ok(capabilities.body.data.security.findings.some((finding: { id: string; workspaceId?: string }) => finding.id === "shell-broad-access" && finding.workspaceId === "runner"));
    assert.equal(capabilities.body.data.releaseReadiness.kind, "workspace-linker-release-readiness");
    assert.equal(typeof capabilities.body.data.releaseReadiness.ready, "boolean");
    assert.equal(capabilities.body.data.configDiagnostics.criticalCount, 0);
    assert.ok(Array.isArray(capabilities.body.data.configDiagnostics.findings));

    const read = await workspaceOperation({ workspace: "app", operation: "read", path: "hello.txt" });
    assert.equal(read.status, 200);
    assert.equal(read.body.data.content, "hello from LocalPort\n");
    assert.match(read.body.data.sha256, /^[a-f0-9]{64}$/);
    assert.equal(read.body.data.truncated, false);

    const controlCapabilities = await control({ action: "get_capabilities" });
    assert.equal(controlCapabilities.status, 200);
    assert.equal(controlCapabilities.body.data.machineName, "api-test");
    assert.equal(controlCapabilities.body.data.startup.kind, "workspace-linker-startup-readiness");
    assert.equal(controlCapabilities.body.data.startup.localApiUrl, "http://127.0.0.1:3959/api/v1");
    assert.ok(controlCapabilities.body.data.startup.modes.some((mode: { id: string; command: string }) => (
      mode.id === "start" &&
      mode.command === "workspace-linker start"
    )));
    assert.ok(controlCapabilities.body.data.startup.modes.some((mode: { id: string; command: string }) => (
      mode.id === "tunnel-cloudflare" &&
      mode.command === "workspace-linker start <workspace-path> --dev --tunnel cloudflare"
    )));
    assert.ok(controlCapabilities.body.data.startup.modes.every((mode: { command: string }) => !mode.command.includes("--no-tunnel")));
    assert.ok(controlCapabilities.body.data.startup.modes.some((mode: { id: string; command: string }) => (
      mode.id === "service" &&
      mode.command.includes("serve")
    )));

    const controlDoctor = await control({ action: "doctor" });
    assert.equal(controlDoctor.status, 200);
    assert.equal(controlDoctor.body.data.machineName, "api-test");
    assert.equal(controlDoctor.body.data.machine.nodeVersion, process.version);
    assert.equal(controlDoctor.body.data.runtime.localMcpUrl, "http://127.0.0.1:3959/mcp");
    assert.equal(controlDoctor.body.data.runtime.localApiUrl, "http://127.0.0.1:3959/api/v1");
    assert.equal(controlDoctor.body.data.runtime.startCommands.start, "workspace-linker start");
    assert.equal(controlDoctor.body.data.runtime.startCommands.serveHttp, "workspace-linker start");
    assert.equal(controlDoctor.body.data.startup.kind, "workspace-linker-startup-readiness");
    assert.equal(controlDoctor.body.data.startup.localMcpUrl, "http://127.0.0.1:3959/mcp");
    assert.equal(typeof controlDoctor.body.data.startup.ready, "boolean");
    assert.match(controlDoctor.body.data.startup.service.profileBundleCommand, /service profile --platform/);
    assert.equal(typeof controlDoctor.body.data.readyForTunnel, "boolean");
    assert.equal(controlDoctor.body.data.auth.ownerTokenConfigured, true);
    assert.equal(controlDoctor.body.data.workspaces.total, 3);
    assert.equal(controlDoctor.body.data.workspaces.shellEnabled, 1);
    assert.equal(controlDoctor.body.data.workspaces.codexEnabled, 0);
    assert.equal(controlDoctor.body.data.releaseReadiness.kind, "workspace-linker-release-readiness");
    assert.equal(controlDoctor.body.data.releaseReadiness.recommendedGate, "npm run product:check");
    assert.ok(controlDoctor.body.data.releaseReadiness.checks.some((check: { id: string }) => check.id === "command-policy"));
    assert.equal(controlDoctor.body.data.configDiagnostics.criticalCount, 0);
    assert.ok(Array.isArray(controlDoctor.body.data.security.findings));
    assert.ok(Array.isArray(controlDoctor.body.data.tunnels.tools));
    assert.ok(Array.isArray(controlDoctor.body.data.tunnels.commands));
    assert.match(controlDoctor.body.data.service.profileCommand, /^workspace-linker service profile --platform /);
    assert.match(controlDoctor.body.data.service.profileBundleCommand, /--output-dir \.\/service-profile$/);
    assert.match(controlDoctor.body.data.service.installDryRunCommand, /service install --dry-run --platform/);
    assert.ok(Array.isArray(controlDoctor.body.data.service.statusCommands));
    assert.ok(controlDoctor.body.data.localTools.some((tool: { name: string; available: boolean }) => tool.name === "node" && tool.available));
    assert.ok(controlDoctor.body.data.nextActions.some((action: string) => action.includes("publicBaseUrl")));

    const controlWorkspaces = await control({ action: "list_workspaces" });
    assert.equal(controlWorkspaces.status, 200);
    assert.equal(controlWorkspaces.body.data.workspaces.length, 3);

    const controlRead = await control({
      action: "workspace_operation",
      workspace: "app",
      input: { operation: "read", path: "hello.txt", maxBytes: 5 },
    });
    assert.equal(controlRead.status, 200);
    assert.equal(controlRead.body.data.content, "hello");
    assert.match(controlRead.body.data.sha256, /^[a-f0-9]{64}$/);
    assert.equal(controlRead.body.data.truncated, true);

    const controlReadV2 = await control({
      action: "workspace_operation",
      workspace: "app",
      input: {
        op: "read",
        target: "hello.txt",
        options: { maxBytes: 5 },
      },
    });
    assert.equal(controlReadV2.status, 200);
    assert.equal(controlReadV2.body.data.content, "hello");
    assert.equal(controlReadV2.body.data.truncated, true);

    const controlReadFlat = await control({
      action: "workspace_operation",
      workspace: "app",
      op: "read",
      target: "hello.txt",
      options: { maxBytes: 5 },
    });
    assert.equal(controlReadFlat.status, 200);
    assert.equal(controlReadFlat.body.data.content, "hello");
    assert.equal(controlReadFlat.body.data.truncated, true);

    const controlReadAlias = await control({
      action: "operation",
      workspace: "app",
      op: "read",
      target: "hello.txt",
      options: { maxBytes: 5 },
    });
    assert.equal(controlReadAlias.status, 200);
    assert.equal(controlReadAlias.body.data.content, "hello");
    assert.equal(controlReadAlias.body.data.truncated, true);

    const controlSearchV2 = await control({
      action: "workspace_operation",
      workspace: "app",
      input: {
        op: "search_text",
        target: ".",
        input: { query: "needle", glob: "context.txt" },
        options: { maxResults: 5 },
      },
    });
    assert.equal(controlSearchV2.status, 200);
    assert.match(controlSearchV2.body.data.matches.join("\n"), /context\.txt/);

    const controlBatch = await control({
      action: "workspace_operation",
      workspace: "app",
      input: {
        operation: "batch",
        continueOnError: true,
        operations: [
          { operation: "read", path: "hello.txt", maxBytes: 5 },
          { operation: "write", path: "blocked-from-batch.txt", content: "blocked" },
          { operation: "search_text", query: "needle", glob: "context.txt", maxResults: 5 },
        ],
      },
    });
    assert.equal(controlBatch.status, 200);
    assert.equal(controlBatch.body.data.completed, false);
    assert.equal(controlBatch.body.data.results.length, 3);
    assert.equal(controlBatch.body.data.results[0].ok, true);
    assert.equal(controlBatch.body.data.results[0].data.content, "hello");
    assert.equal(controlBatch.body.data.results[1].ok, false);
    assert.match(controlBatch.body.data.results[1].error, /write permission is disabled/);
    assert.equal(controlBatch.body.data.results[2].ok, true);
    assert.match(controlBatch.body.data.results[2].data.matches.join("\n"), /context\.txt/);

    const batchItemHistory = await getJson("/api/v1/history?tool=workspace_operation.batch_item&q=batch%5B1%5D");
    assert.equal(batchItemHistory.status, 200);
    assert.ok(batchItemHistory.body.data.events.some((event: { success: boolean; detail?: string; error?: string }) => (
      event.success === false &&
      event.detail === "batch[1]: write" &&
      event.error?.includes("write permission is disabled")
    )));

    const rangedRead = await workspaceOperation({
      workspace: "app",
      operation: "read",
      path: "lines.txt",
      startLine: 2,
      lineCount: 2,
      maxBytes: 7,
    });
    assert.equal(rangedRead.status, 200);
    assert.equal(rangedRead.body.data.content, "two\nthr");
    assert.equal(rangedRead.body.data.startLine, 2);
    assert.equal(rangedRead.body.data.endLine, 3);
    assert.equal(rangedRead.body.data.totalLines, 5);
    assert.match(rangedRead.body.data.sha256, /^[a-f0-9]{64}$/);
    assert.equal(rangedRead.body.data.truncated, true);

    const readMany = await workspaceOperation({
      workspace: "app",
      operation: "read_many",
      paths: ["hello.txt", "AGENTS.md"],
      maxBytes: 5,
    });
    assert.equal(readMany.status, 200);
    assert.deepEqual(readMany.body.data.files.map((file: { path: string }) => file.path), ["hello.txt", "AGENTS.md"]);
    assert.equal(readMany.body.data.files[0].content, "hello");
    assert.match(readMany.body.data.files[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(readMany.body.data.files[0].truncated, true);

    const readManyOutside = await workspaceOperation({
      workspace: "app",
      operation: "read_many",
      paths: ["hello.txt", "../outside.txt"],
    });
    assert.equal(readManyOutside.status, 400);
    assert.match(readManyOutside.body.error, /outside workspace/);

    const search = await workspaceOperation({ workspace: "app", operation: "search_text", query: "localport" });
    assert.equal(search.status, 200);
    assert.match(search.body.data.matches.join("\n"), /hello\.txt/i);

    const contextSearch = await workspaceOperation({
      workspace: "app",
      operation: "search_text",
      query: "needle",
      glob: "context.txt",
      beforeContext: 1,
      afterContext: 1,
    });
    assert.equal(contextSearch.status, 200);
    const contextMatches = contextSearch.body.data.matches.join("\n");
    assert.match(contextMatches, /context\.txt[-:]1[-:]before/);
    assert.match(contextMatches, /context\.txt:2:needle/);
    assert.match(contextMatches, /context\.txt[-:]3[-:]After/);
    assert.match(contextMatches, /context\.txt:6:needle/);
    assert.doesNotMatch(contextMatches, /^--$/m);

    const symbolSearch = await workspaceOperation({
      workspace: "app",
      operation: "search_symbols",
      query: "Api",
      glob: "*.ts",
      maxResults: 10,
    });
    assert.equal(symbolSearch.status, 200);
    assert.ok(symbolSearch.body.data.symbols.some((symbol: { path: string; name: string; kind: string }) => (
      symbol.path === "src/index.ts" &&
      symbol.name === "ApiController" &&
      symbol.kind === "class"
    )));

    const blockedWrite = await workspaceOperation({
      workspace: "app",
      operation: "write",
      path: "blocked.txt",
      content: "blocked",
    });
    assert.equal(blockedWrite.status, 403);
    assert.equal(blockedWrite.body.ok, false);

    const blockedPatch = await workspaceOperation({
      workspace: "app",
      operation: "patch",
      patch: patchText("hello.txt", "hello from LocalPort\n", "blocked\n"),
    });
    assert.equal(blockedPatch.status, 403);
    assert.equal(blockedPatch.body.ok, false);

    const write = await workspaceOperation({
      workspace: "writer",
      operation: "write",
      path: "created.txt",
      content: "created through api",
    });
    assert.equal(write.status, 200);
    assert.equal(await readFile(join(workspaceRoot, "created.txt"), "utf8"), "created through api");

    const optimisticSource = await workspaceOperation({
      workspace: "writer",
      operation: "write",
      path: "optimistic.txt",
      content: "initial\n",
    });
    assert.equal(optimisticSource.status, 200);

    const optimisticRead = await workspaceOperation({
      workspace: "writer",
      operation: "read",
      path: "optimistic.txt",
    });
    assert.equal(optimisticRead.status, 200);
    assert.match(optimisticRead.body.data.sha256, /^[a-f0-9]{64}$/);

    const optimisticWrite = await workspaceOperation({
      workspace: "writer",
      operation: "write_if_unchanged",
      path: "optimistic.txt",
      content: "changed\n",
      expectedSha256: optimisticRead.body.data.sha256,
    });
    assert.equal(optimisticWrite.status, 200);
    assert.equal(optimisticWrite.body.data.written, true);
    assert.equal(optimisticWrite.body.data.conflict, false);
    assert.equal(optimisticWrite.body.data.previousSha256, optimisticRead.body.data.sha256);
    assert.match(optimisticWrite.body.data.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(join(workspaceRoot, "optimistic.txt"), "utf8"), "changed\n");

    const staleOptimisticWrite = await workspaceOperation({
      workspace: "writer",
      operation: "write_if_unchanged",
      path: "optimistic.txt",
      content: "stale\n",
      expectedSha256: optimisticRead.body.data.sha256,
    });
    assert.equal(staleOptimisticWrite.status, 200);
    assert.equal(staleOptimisticWrite.body.data.written, false);
    assert.equal(staleOptimisticWrite.body.data.conflict, true);
    assert.notEqual(staleOptimisticWrite.body.data.currentSha256, staleOptimisticWrite.body.data.expectedSha256);
    assert.equal(await readFile(join(workspaceRoot, "optimistic.txt"), "utf8"), "changed\n");

    const patchSource = await workspaceOperation({
      workspace: "writer",
      operation: "write",
      path: "patch.txt",
      content: "old\n",
    });
    assert.equal(patchSource.status, 200);

    const patch = await workspaceOperation({
      workspace: "writer",
      operation: "patch",
      patch: patchText("patch.txt", "old\n", "new\n"),
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.data.applied, true);
    assert.equal(normalizeNewlines(await readFile(join(workspaceRoot, "patch.txt"), "utf8")), "new\n");

    const outsidePatch = await workspaceOperation({
      workspace: "writer",
      operation: "patch",
      patch: patchText("../outside.txt", "old\n", "new\n"),
    });
    assert.equal(outsidePatch.status, 400);
    assert.match(outsidePatch.body.error, /outside workspace/);

    const stat = await workspaceOperation({ workspace: "writer", operation: "stat", path: "created.txt" });
    assert.equal(stat.status, 200);
    assert.equal(stat.body.data.entry.type, "file");

    const mkdir = await workspaceOperation({ workspace: "writer", operation: "mkdir", path: "folder" });
    assert.equal(mkdir.status, 200);

    const writeInstructions = await workspaceOperation({
      workspace: "writer",
      operation: "write",
      path: "folder/CLAUDE.md",
      content: "folder api guidance\n",
    });
    assert.equal(writeInstructions.status, 200);

    const details = await workspaceOperation({ workspace: "writer", operation: "list_details", path: "." });
    assert.equal(details.status, 200);
    assert.ok(details.body.data.entries.some((entry: { name: string; type: string }) => entry.name === "folder" && entry.type === "directory"));

    const instructions = await workspaceOperation({
      workspace: "app",
      operation: "instructions",
      path: "folder/new-file.ts",
      maxBytes: 9,
    });
    assert.equal(instructions.status, 200);
    assert.deepEqual(instructions.body.data.files.map((entry: { path: string }) => entry.path), ["AGENTS.md", "folder/CLAUDE.md"]);
    assert.equal(instructions.body.data.files[0].content, "root api ");
    assert.equal(instructions.body.data.files[0].truncated, true);

    const agentSkills = await workspaceOperation({
      workspace: "app",
      operation: "agent_skills",
      maxResults: 10,
    });
    assert.equal(agentSkills.status, 200);
    assert.ok(agentSkills.body.data.skills.some((skill: { name: string; path: string; title: string }) => (
      skill.name === "api-helper" &&
      skill.path === ".codex/skills/api-helper/SKILL.md" &&
      skill.title === "API Helper"
    )));

    const repoStatus = await workspaceOperation({
      workspace: "app",
      operation: "repo_status",
      path: ".",
      includeDiff: false,
      maxBytes: 1024,
    });
    assert.equal(repoStatus.status, 200);
    assert.equal(typeof repoStatus.body.data.isGitRepository, "boolean");

    const overview = await workspaceOperation({
      workspace: "app",
      operation: "project_overview",
      path: ".",
      maxDepth: 2,
      maxEntries: 80,
    });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.packageName, "api-overview-app");
    assert.deepEqual(overview.body.data.packageManagers, ["npm"]);
    assert.deepEqual(overview.body.data.packageScripts, ["build", "test"]);
    assert.ok(overview.body.data.configFiles.includes("package.json"));
    assert.ok(overview.body.data.configFiles.includes("tsconfig.json"));
    assert.ok(overview.body.data.instructionFiles.includes("AGENTS.md"));
    assert.ok(overview.body.data.languages.some((language: { language: string }) => language.language === "TypeScript"));

    const tree = await workspaceOperation({ workspace: "writer", operation: "tree", path: ".", maxDepth: 2, maxEntries: 20 });
    assert.equal(tree.status, 200);
    assert.ok(tree.body.data.entries.some((entry: { path: string; type: string }) => entry.path === "created.txt" && entry.type === "file"));
    assert.ok(tree.body.data.entries.some((entry: { path: string; type: string }) => entry.path === "folder" && entry.type === "directory"));

    const directoryOnlyTree = await workspaceOperation({ workspace: "writer", operation: "tree", path: ".", includeFiles: false });
    assert.equal(directoryOnlyTree.status, 200);
    assert.ok(directoryOnlyTree.body.data.entries.every((entry: { type: string }) => entry.type === "directory"));

    const move = await workspaceOperation({
      workspace: "writer",
      operation: "move",
      fromPath: "created.txt",
      toPath: "folder/moved.txt",
    });
    assert.equal(move.status, 200);
    assert.equal(await readFile(join(workspaceRoot, "folder/moved.txt"), "utf8"), "created through api");

    const deleteRoot = await workspaceOperation({ workspace: "writer", operation: "delete", path: ".", recursive: true });
    assert.equal(deleteRoot.status, 400);
    assert.match(deleteRoot.body.error, /workspace root/);

    const remove = await workspaceOperation({ workspace: "writer", operation: "delete", path: "folder", recursive: true });
    assert.equal(remove.status, 200);

    const failingCommand = await workspaceOperation({
      workspace: "runner",
      operation: "command",
      command: "node command-fail.js",
      timeoutSeconds: 5,
    });
    assert.equal(failingCommand.status, 200);
    assert.equal(failingCommand.body.data.exitCode, 7);
    assert.equal(failingCommand.body.data.stdout, "command-out");
    assert.equal(failingCommand.body.data.stderr, "command-err");
    assert.equal(failingCommand.body.data.timedOut, false);

    const missingCommand = await workspaceOperation({
      workspace: "runner",
      operation: "command",
    });
    assert.equal(missingCommand.status, 400);
    assert.match(missingCommand.body.error, /command is required/);

    const missingPackageScript = await workspaceOperation({
      workspace: "runner",
      operation: "package_run",
      script: "missing-script",
    });
    assert.equal(missingPackageScript.status, 400);
    assert.match(missingPackageScript.body.error, /Unknown package script/);

    const startedProcess = await workspaceOperation({
      workspace: "runner",
      operation: "process_start",
      command: "node api-process.js",
    });
    assert.equal(startedProcess.status, 200);
    assert.match(startedProcess.body.data.process.processId, /^proc_/);
    assert.equal(startedProcess.body.data.process.status, "running");

    const processRead = await waitForProcessOutput(startedProcess.body.data.process.processId);
    assert.equal(processRead.body.data.process.stdout, "api-process-out");
    assert.equal(processRead.body.data.process.stderr, "api-process-err");

    const processList = await workspaceOperation({ workspace: "runner", operation: "process_list" });
    assert.equal(processList.status, 200);
    assert.ok(processList.body.data.processes.some((process: { processId: string }) => (
      process.processId === startedProcess.body.data.process.processId
    )));

    const processStop = await workspaceOperation({
      workspace: "runner",
      operation: "process_stop",
      processId: startedProcess.body.data.process.processId,
    });
    assert.equal(processStop.status, 200);
    assert.equal(processStop.body.data.process.status, "exited");

    const operationHistory = await workspaceOperation({
      workspace: "runner",
      operation: "history",
      query: "command-fail",
      maxResults: 10,
    });
    assert.equal(operationHistory.status, 200);
    assert.equal(operationHistory.body.data.events.some((event: { tool?: string; commandPreview?: string }) => (
      event.tool === "workspace_operation" &&
      event.commandPreview?.includes("command-fail")
    )), true);

    const operationHistoryInsight = await workspaceOperation({
      workspace: "runner",
      operation: "history_insight",
      view: "timeline",
      query: "command-fail",
      maxResults: 10,
    });
    assert.equal(operationHistoryInsight.status, 200);
    assert.equal(operationHistoryInsight.body.data.view, "timeline");
    assert.ok(operationHistoryInsight.body.data.summary.totalEvents >= 1);
    assert.ok(operationHistoryInsight.body.data.timeline.some((event: { operation?: string; commandPreview?: string }) => (
      event.operation === "command" &&
      event.commandPreview?.includes("command-fail")
    )));

    const operationHistoryLast = await workspaceOperation({
      workspace: "runner",
      operation: "history_insight",
      view: "last",
      query: "command is required",
      maxResults: 10,
    });
    assert.equal(operationHistoryLast.status, 200);
    assert.equal(operationHistoryLast.body.data.view, "last");
    assert.equal(operationHistoryLast.body.data.last.failure.operation, "command");
    assert.equal(operationHistoryLast.body.data.last.replay.request.workspace, "runner");
    assert.equal(operationHistoryLast.body.data.last.replay.request.input.op, "command");
    assert.ok(operationHistoryLast.body.data.last.replay.requiresInput.includes("command"));
    assert.ok(operationHistoryLast.body.data.last.suggestedNextActions.some((action: string) => action.includes("missing replay input")));

    const operationHistorySessions = await workspaceOperation({
      workspace: "runner",
      operation: "history_insight",
      view: "sessions",
      maxResults: 100,
    });
    assert.equal(operationHistorySessions.status, 200);
    assert.equal(operationHistorySessions.body.data.view, "sessions");
    assert.ok(operationHistorySessions.body.data.sessions.some((session: {
      scope: string;
      workspaceId?: string;
      failedEvents: number;
      operations: Record<string, number>;
    }) => (
      session.scope === "workspace" &&
      session.workspaceId === "runner" &&
      session.failedEvents >= 1 &&
      session.operations.command >= 1
    )));

    const blockedScreenCapture = await workspaceOperation({
      workspace: "runner",
      operation: "screen_capture",
      path: "secondary",
      returnMode: "base64",
    });
    assert.equal(blockedScreenCapture.status, 400);

    const runnerReplay = await control({
      action: "history_insight",
      view: "failed_replay",
      workspaceId: "runner",
      limit: 100,
    });
    assert.equal(runnerReplay.status, 200);
    assert.ok(runnerReplay.body.data.failedReplay.some((item: {
      replayable: boolean;
      request?: { workspace: string; input: { op: string; input: { script?: string } } };
    }) => (
      item.replayable &&
      item.request?.workspace === "runner" &&
      item.request.input.op === "package_run" &&
      item.request.input.input.script === "missing-script"
    )));
    assert.ok(runnerReplay.body.data.failedReplay.some((item: {
      replayable: boolean;
      requiresInput?: string[];
      request?: { workspace: string; input: { op: string } };
    }) => (
      !item.replayable &&
      item.requiresInput?.includes("command") &&
      item.request?.workspace === "runner" &&
      item.request.input.op === "command"
    )));
    assert.ok(runnerReplay.body.data.failedReplay.some((item: {
      replayable: boolean;
      requiresInput?: string[];
      reason?: string;
      request?: { workspace: string; input: { op: string; input: { path?: string; returnMode?: string } } };
    }) => (
      !item.replayable &&
      item.requiresInput?.includes("screen-capture-confirmation") &&
      item.reason?.includes("Screenshot captures can expose current screen pixels") &&
      item.request?.workspace === "runner" &&
      item.request.input.op === "screen_capture" &&
      item.request.input.input.path === "secondary" &&
      item.request.input.input.returnMode === "base64"
    )));

    const history = await getJson("/api/v1/history?tool=workspace_operation");
    assert.equal(history.status, 200);
    assert.ok(history.body.data.events.some((event: { success: boolean }) => event.success === false));
    assert.ok(history.body.data.events.some((event: { success: boolean }) => event.success === true));

    const historyInsight = await control({
      action: "history_insight",
      view: "failed_replay",
      workspaceId: "app",
      limit: 100,
    });
    assert.equal(historyInsight.status, 200);
    assert.equal(historyInsight.body.data.view, "failed_replay");
    assert.ok(historyInsight.body.data.summary.failedEvents >= 1);
    assert.ok(historyInsight.body.data.failedReplay.some((item: { replayable: boolean; requiresInput?: string[]; request?: { workspace: string; input: { op: string } } }) => (
      !item.replayable &&
      item.requiresInput?.includes("content") &&
      item.request?.workspace === "app" &&
      item.request.input.op === "write"
    )));

    const debugBundle = await control({
      action: "history_insight",
      view: "debug_bundle",
      limit: 20,
    });
    assert.equal(debugBundle.status, 200);
    assert.equal(debugBundle.body.data.debugBundle.format, "workspace-linker-debug-bundle-v1");
    assert.ok(debugBundle.body.data.debugBundle.redactions.some((redaction: string) => redaction.includes("Owner tokens")));
    assert.ok(debugBundle.body.data.debugBundle.redactions.some((redaction: string) => redaction.includes("screenshot image bytes")));
    assert.ok(Array.isArray(debugBundle.body.data.debugBundle.connections));

    const authFailures = await getJson("/api/v1/history?type=auth_failure&q=workspaces");
    assert.equal(authFailures.status, 200);
    assert.ok(authFailures.body.data.events.some((event: { tool?: string; requestPath?: string; success: boolean }) => (
      event.tool === "api" &&
      event.requestPath === "/api/v1/workspaces" &&
      event.success === false
    )));

    const historySessions = await control({
      action: "history_insight",
      view: "sessions",
      limit: 100,
    });
    assert.equal(historySessions.status, 200);
    assert.equal(historySessions.body.data.view, "sessions");
    assert.ok(historySessions.body.data.sessions.some((session: {
      scope: string;
      surface?: string;
      failedEvents: number;
      tools: Record<string, number>;
    }) => (
      session.scope === "surface" &&
      session.surface === "api" &&
      session.failedEvents >= 1 &&
      session.tools.api >= 1
    )));

    const historyConnections = await control({
      action: "history_insight",
      view: "connections",
      limit: 100,
    });
    assert.equal(historyConnections.status, 200);
    assert.equal(historyConnections.body.data.view, "connections");
    assert.ok(Array.isArray(historyConnections.body.data.connections));
    assert.ok(historyConnections.body.data.connections.some((connection: {
      scope: string;
      totalEvents: number;
    }) => connection.totalEvents >= 1 && (connection.scope === "surface" || connection.scope === "workspace")));
  } finally {
    await stopAllTunnelProcesses();
    server.close();
  }
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;

  await rm(root, { recursive: true, force: true });
}

async function installFakeCloudflared(directory: string, publicUrl: string): Promise<void> {
  const posixPath = join(directory, "cloudflared");
  await writeFile(posixPath, [
    "#!/usr/bin/env node",
    `console.log(${JSON.stringify(publicUrl)});`,
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");
  await chmod(posixPath, 0o755);

  await writeFile(join(directory, "cloudflared.cmd"), [
    "@echo off",
    `echo ${publicUrl}`,
    ":loop",
    "ping -n 2 127.0.0.1 >nul",
    "goto loop",
    "",
  ].join("\r\n"), "utf8");
}

async function waitForDetectedTunnelUrl(publicUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (listTunnelProcesses().some((tp) => tp.status === "running" && tp.publicUrl === publicUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("fake tunnel public URL did not become available");
}

async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await getJson("/api/v1/health");
      if (response.status === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("API did not start");
}

async function getJson(path: string, authenticated = true): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authenticated ? authHeaders() : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function postJson(path: string, body: unknown, authenticated = true): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(authenticated ? authHeaders() : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function workspaceOperation(body: unknown): Promise<{ status: number; body: any }> {
  return postJson("/api/v1/workspace-operation", body);
}

async function control(body: unknown): Promise<{ status: number; body: any }> {
  return postJson("/api/v1/control", body);
}

async function waitForProcessOutput(processId: string): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await workspaceOperation({
      workspace: "runner",
      operation: "process_read",
      processId,
    });
    if (
      response.body.data?.process?.stdout?.includes("api-process-out") &&
      response.body.data?.process?.stderr?.includes("api-process-err")
    ) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("process output did not become available");
}

function authHeaders(): Record<string, string> {
  return { authorization: "Bearer test-token" };
}

function patchText(path: string, oldText: string, newText: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${oldText.trimEnd()}`,
    `+${newText.trimEnd()}`,
    "",
  ].join("\n");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
