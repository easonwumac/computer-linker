import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import express from "express";
import type { Request, Response } from "express";
import * as z from "zod";
import { registerApiRoutes } from "./api.js";
import { errorMessage, writeAuditEvent, writeAuthFailureEvent, type AuditEventInput } from "./audit.js";
import { workspaceCapabilityPolicy } from "./capability-policy.js";
import { getLocalPortCapabilities } from "./capabilities.js";
import { computerOperationAuditFields, getComputerInfo, getOperationHistory, runComputerOperation } from "./computer-contract.js";
import { loadConfig, oauthStatePath } from "./config.js";
import { isAuthorizedLocalPortRequest } from "./http-auth.js";
import { mcpToolSurface } from "./mcp-surface.js";
import { LocalPortOAuthProvider } from "./oauth-provider.js";
import { workspaceLinkerVersion } from "./package-metadata.js";
import { localPublicBaseUrl } from "./profile.js";
import { stopAllManagedProcesses } from "./processes.js";
import { stopAllTunnelProcesses } from "./tunnels.js";
import {
  closeActiveSession,
  registerActiveSession,
  touchActiveSession,
  type SessionAuthType,
} from "./sessions.js";
import { WorkspaceRegistry } from "./workspaces.js";
import {
  allowedWorkspaceOperations,
  normalizeWorkspaceOperationInput,
  runWorkspaceOperation,
  workspaceOperationAuditFields,
  workspaceOperationNames,
  type WorkspaceOperationInput,
} from "./workspace-operations.js";

const workspaceOperationSchema = {
  workspaceId: z.string(),
  op: z.enum(workspaceOperationNames),
  target: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const workspaceActionAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const createOnlyAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const looseObjectOutputSchema = z.object({}).passthrough();
const permissionOutputSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  shell: z.boolean(),
  codex: z.boolean(),
  screen: z.boolean().optional(),
});
const capabilityPolicyOutputSchema = z.object({
  capabilities: z.array(z.string()),
}).passthrough();
const workspaceOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  permissions: permissionOutputSchema,
  capabilityPolicy: capabilityPolicyOutputSchema,
  allowedOperations: z.array(z.string()),
}).passthrough();

const computerInfoOutputSchema = z.object({
  kind: z.literal("computer-linker-computer-info"),
  schemaVersion: z.number(),
  machineId: z.string(),
  machineName: z.string(),
  platform: looseObjectOutputSchema,
  service: z.object({
    name: z.string(),
    version: z.string(),
    transports: z.array(z.string()),
    localUrl: z.string(),
    publicUrl: z.string().nullable(),
  }).passthrough(),
  scopes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    displayPath: z.string(),
    pathPrivacy: z.object({
      rootsRedacted: z.boolean(),
    }).passthrough(),
    roots: z.array(z.string()).optional(),
    permissions: permissionOutputSchema,
    capabilityPolicy: capabilityPolicyOutputSchema,
    allowedOperations: z.array(z.string()),
  }).passthrough()),
  tools: looseObjectOutputSchema,
  operationContract: looseObjectOutputSchema,
  operationRegistry: z.array(looseObjectOutputSchema),
  discovery: looseObjectOutputSchema,
  compatibility: z.object({
    workspaceTools: z.array(z.string()),
    genericTools: z.array(z.string()),
  }).passthrough(),
  status: looseObjectOutputSchema,
}).passthrough();

const computerOperationOutputSchema = z.object({
  ok: z.boolean(),
  operationId: z.string(),
  scope: z.string(),
  op: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()),
  }).optional(),
  warnings: z.array(z.string()),
}).passthrough();

const operationHistoryOutputSchema = z.object({
  view: z.string().optional(),
  events: z.array(z.unknown()).optional(),
  last: z.unknown().optional(),
  timeline: z.unknown().optional(),
  sessions: z.unknown().optional(),
  failedReplay: z.unknown().optional(),
  debugBundle: z.unknown().optional(),
}).passthrough();

const capabilitiesOutputSchema = z.object({
  name: z.string(),
  machineId: z.string(),
  machineName: z.string(),
  auth: looseObjectOutputSchema,
  machine: looseObjectOutputSchema,
  workspaces: z.array(workspaceOutputSchema),
  mcpTools: z.array(z.string()),
  jsonApi: looseObjectOutputSchema,
  discovery: looseObjectOutputSchema,
  clientGuidance: looseObjectOutputSchema,
  workspaceOperations: z.array(z.string()),
  operationRegistry: z.array(looseObjectOutputSchema),
  computerOperationRegistry: z.array(looseObjectOutputSchema),
  capabilityPolicy: looseObjectOutputSchema,
  codingCapabilities: looseObjectOutputSchema,
  tunnels: looseObjectOutputSchema,
}).passthrough();

const listWorkspacesOutputSchema = z.object({
  machineId: z.string(),
  machineName: z.string(),
  workspaces: z.array(workspaceOutputSchema),
}).passthrough();

const openWorkspaceOutputSchema = z.object({
  workspaceId: z.string(),
  root: z.string(),
  configuredWorkspaceId: z.string(),
  permissions: permissionOutputSchema,
  capabilityPolicy: capabilityPolicyOutputSchema,
  allowedOperations: z.array(z.string()),
}).passthrough();

export function createLocalPortMcpServer(): McpServer {
  const config = loadConfig();
  const workspaces = new WorkspaceRegistry(config);
  const surface = mcpToolSurface();
  const server = new McpServer(
    {
      name: "computer-linker",
      title: `Computer Linker (${config.machineName})`,
      version: workspaceLinkerVersion(),
      description: "Permissioned local workspace MCP server for reading, editing, searching, running commands, and delegating Codex inside explicitly exposed folders.",
    },
    {
      instructions:
        `You are connected to Computer Linker on ${config.machineName}. ` +
        "Use the three-tool flow: start with get_computer_info, call computer_operation, then call get_operation_history when auditing. " +
        "computer_operation always uses the stable envelope: scope, op, target, input, options. " +
        (surface === "compatibility"
          ? "Compatibility clients may still use legacy workspace tools, but new clients should prefer computer_operation. "
          : "Compatibility workspace tools are hidden by default; set COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility only for legacy clients. ") +
        "Start coding tasks with op=code.context. Use file.search, file.read, git.diff, and package.run as needed. " +
        "Only use write, command, process, codex, or screen operations when the selected scope explicitly allows them.",
    },
  );

  server.registerTool(
    "get_computer_info",
    {
      title: "Get computer info",
      description: "Step 1. Inspect this computer: identity, scopes, permissions, readiness, URLs, and available operations.",
      inputSchema: {
        include: z.array(z.string()).optional(),
      },
      outputSchema: computerInfoOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => auditedToolCall("get_computer_info", {}, async () => toolResponse(getComputerInfo(input))),
  );

  server.registerTool(
    "computer_operation",
    {
      title: "Computer operation",
      description: [
        "Step 2. Run one scoped operation with the stable envelope: scope, op, target, input, options.",
        "Use dotted ops returned by get_computer_info. Common ops: code.context, file.list, file.search, file.read, git.diff, package.run.",
      ].join(" "),
      inputSchema: {
        scope: z.string(),
        op: z.string(),
        target: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        options: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: computerOperationOutputSchema,
      annotations: workspaceActionAnnotations,
    },
    async (input) => auditedToolCall("computer_operation", await computerOperationAuditFields(input), async () => {
      const result = await runComputerOperation(input);
      return toolResponse(result);
    }, mcpOperationResultSucceeded),
  );

  server.registerTool(
    "get_operation_history",
    {
      title: "Get operation history",
      description: "Step 3. Read redacted history for actions, sessions, tunnel connections, failures, and debug bundles.",
      inputSchema: {
        scope: z.string().optional(),
        view: z.string().optional(),
        limit: z.number().optional(),
        query: z.string().optional(),
      },
      outputSchema: operationHistoryOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => auditedToolCall("get_operation_history", {
      workspaceRef: input.scope,
    }, async () => toolResponse(getOperationHistory(input))),
  );

  if (surface === "compatibility") {
  server.registerTool(
    "get_capabilities",
    {
      title: "Get capabilities",
      description: "Step 1. Inspect this computer: available tools, operationRegistry, workspace permissions, tunnel/auth status, and safety boundaries.",
      inputSchema: {},
      outputSchema: capabilitiesOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => auditedToolCall("get_capabilities", {}, async () => toolResponse(getLocalPortCapabilities())),
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Step 2. List predefined exposed workspaces and each workspace's allowedOperations. Choose one before calling open_workspace.",
      inputSchema: {},
      outputSchema: listWorkspacesOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => auditedToolCall("list_workspaces", {}, async () => {
      const definedWorkspaces = workspaces.listDefinedWorkspaces().map((workspace) => ({
        ...workspace,
        capabilityPolicy: workspaceCapabilityPolicy(workspace.permissions),
        allowedOperations: allowedWorkspaceOperations(workspace.permissions),
      }));
      return toolResponse({ machineId: config.machineId, machineName: config.machineName, workspaces: definedWorkspaces });
    }),
  );

  server.registerTool(
    "open_workspace",
    {
      title: "Open workspace",
      description: "Step 3. Open one predefined workspace by id, name, or exact configured path. Returns workspaceId for workspace_operation.",
      inputSchema: {
        workspaceRef: z.string(),
      },
      outputSchema: openWorkspaceOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceRef }) => auditedToolCall("open_workspace", { workspaceRef }, async () => {
      const workspace = await workspaces.openWorkspace(workspaceRef);
      writeAuditEvent({
        type: "workspace_open",
        success: true,
        tool: "open_workspace",
        workspaceId: workspace.id,
        workspaceRoot: workspace.root,
        workspaceRef,
      });
      return toolResponse({
        workspaceId: workspace.id,
        root: workspace.root,
        configuredWorkspaceId: workspace.exposedPath.id,
        permissions: workspace.exposedPath.permissions,
        capabilityPolicy: workspaceCapabilityPolicy(workspace.exposedPath.permissions),
        allowedOperations: allowedWorkspaceOperations(workspace.exposedPath.permissions),
      });
    }),
  );

  server.registerTool(
    "read",
    {
      title: "Read file",
      description: "Read one UTF-8 file from an opened predefined workspace. Call list_workspaces and open_workspace first; path must be relative to that workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        lineCount: z.number().int().positive().optional(),
        maxBytes: z.number().int().positive().optional(),
      },
      outputSchema: looseObjectOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => runWorkspaceTool("read", workspaces, input.workspaceId, {
      operation: "read",
      path: input.path,
      startLine: input.startLine,
      lineCount: input.lineCount,
      maxBytes: input.maxBytes,
    }),
  );

  server.registerTool(
    "ls",
    {
      title: "List directory",
      description: "List directory entries in an opened predefined workspace with type, size, and modified time. Use only paths relative to the opened workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string().optional(),
      },
      outputSchema: looseObjectOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => runWorkspaceTool("ls", workspaces, input.workspaceId, {
      operation: "list_details",
      path: input.path ?? ".",
    }),
  );

  server.registerTool(
    "grep",
    {
      title: "Search text",
      description: "Search text in an opened predefined workspace, using ripgrep when available. Use path/glob to keep results bounded.",
      inputSchema: {
        workspaceId: z.string(),
        query: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
        fixedStrings: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        beforeContext: z.number().int().nonnegative().optional(),
        afterContext: z.number().int().nonnegative().optional(),
        maxResults: z.number().int().positive().optional(),
      },
      outputSchema: looseObjectOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => runWorkspaceTool("grep", workspaces, input.workspaceId, {
      operation: "search_text",
      path: input.path ?? ".",
      query: input.query,
      glob: input.glob,
      fixedStrings: input.fixedStrings,
      caseSensitive: input.caseSensitive,
      beforeContext: input.beforeContext,
      afterContext: input.afterContext,
      maxResults: input.maxResults,
    }),
  );

  server.registerTool(
    "glob",
    {
      title: "Find files",
      description: "Find file paths in an opened predefined workspace by glob pattern. Use this before broad reads.",
      inputSchema: {
        workspaceId: z.string(),
        pattern: z.string(),
        path: z.string().optional(),
        maxResults: z.number().int().positive().optional(),
      },
      outputSchema: looseObjectOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => runWorkspaceTool("glob", workspaces, input.workspaceId, {
      operation: "find_files",
      path: input.path ?? ".",
      pattern: input.pattern,
      maxResults: input.maxResults,
    }),
  );

  server.registerTool(
    "create_file",
    {
      title: "Create file",
      description: "Create a new UTF-8 file in an opened predefined workspace and fail if it already exists. Use write/edit/patch only when overwriting or changing an existing file is intended.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        content: z.string(),
      },
      outputSchema: looseObjectOutputSchema,
      annotations: createOnlyAnnotations,
    },
    async (input) => runWorkspaceTool("create_file", workspaces, input.workspaceId, {
      operation: "create_file",
      path: input.path,
      content: input.content,
    }),
  );

  server.registerTool(
    "workspace_operation",
    {
      title: "Workspace operation",
      description: [
        "Step 4. Run one operation in an opened workspace.",
        "Use only the stable envelope fields: workspaceId, op, target, input, options.",
        "Examples: {op:'coding_context', target:'.'}, {op:'read', target:'README.md', options:{maxBytes:65536}}, {op:'search_text', target:'.', input:{query:'TODO', glob:'*.ts'}, options:{maxResults:20}}.",
        "For writes use op=write/edit/patch/write_if_unchanged. For Git use op=git_changes/git_diff/git_stage/git_commit. For commands use op=package_run/command only when allowedOperations includes them. For Codex prefer op=codex_plan/codex_review/codex_fix/codex_test/codex_continue when allowedOperations includes them; use raw op=codex only for custom prompts.",
        "If unsure whether an operation is allowed, call {op:'explain_operation', target:'operation_name'} first.",
      ].join(" "),
      inputSchema: workspaceOperationSchema,
      outputSchema: looseObjectOutputSchema,
      annotations: workspaceActionAnnotations,
    },
    async ({ workspaceId, ...input }) => {
      const operationInput = normalizeWorkspaceOperationInput(input);
      return auditedToolCall("workspace_operation", {
        workspaceId,
        ...workspaceOperationAuditFields(operationInput),
      }, async () => {
        const workspace = workspaces.getWorkspace(workspaceId);
        return toolResponse(await runWorkspaceOperation(workspaces, workspace, operationInput));
      });
    },
  );
  }

  return server;
}

function runWorkspaceTool(
  tool: string,
  workspaces: WorkspaceRegistry,
  workspaceId: string,
  operationInput: WorkspaceOperationInput,
) {
  return auditedToolCall(tool, {
    workspaceId,
    ...workspaceOperationAuditFields(operationInput),
  }, async () => {
    const workspace = workspaces.getWorkspace(workspaceId);
    return toolResponse(await runWorkspaceOperation(workspaces, workspace, operationInput));
  });
}

function toolResponse(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: jsonObject(data),
  };
}

function jsonObject(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}

async function auditedToolCall<T>(
  tool: string,
  fields: Partial<AuditEventInput>,
  run: () => Promise<T>,
  success?: (result: T) => boolean,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await run();
    writeAuditEvent({
      type: "tool_call",
      tool,
      success: success ? success(result) : true,
      durationMs: Math.round(performance.now() - startedAt),
      ...fields,
    });
    return result;
  } catch (error) {
    writeAuditEvent({
      type: "tool_call",
      tool,
      success: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: errorMessage(error),
      ...fields,
    });
    throw error;
  }
}

function mcpOperationResultSucceeded(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
  if (structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)) {
    const ok = (structuredContent as { ok?: unknown }).ok;
    if (ok === false) return false;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return true;
  const text = content.find((item) => (
    item &&
    typeof item === "object" &&
    (item as { type?: unknown }).type === "text" &&
    typeof (item as { text?: unknown }).text === "string"
  )) as { text?: string } | undefined;
  if (!text?.text) return true;
  try {
    const parsed = JSON.parse(text.text) as { ok?: unknown };
    return parsed.ok !== false;
  } catch {
    return true;
  }
}

export async function serveStdio(): Promise<void> {
  await createLocalPortMcpServer().connect(new StdioServerTransport());
}

export function serveHttp(): { url: string; publicUrl: string; apiUrl: string; close(): void } {
  const config = loadConfig();
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 3939;
  const publicBaseUrl = config.publicBaseUrl ?? localPublicBaseUrl(host, port);
  const mcpUrl = new URL("/mcp", publicBaseUrl);
  const resourceServerUrl = resourceUrlFromServerUrl(mcpUrl);
  const localMcpUrl = `http://${host}:${port}/mcp`;
  const localApiUrl = `http://${host}:${port}/api/v1`;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));
  const publicMcpOnlyHost = publicMcpOnlyHostFromConfig(config);
  if (config.publicMcpOnly) {
    app.use((req, res, next) => {
      if (!isPublicMcpOnlyRequest(req, publicMcpOnlyHost, host) || req.path === "/mcp") {
        next();
        return;
      }
      res.status(404).json({
        ok: false,
        error: "public MCP-only mode exposes /mcp only",
      });
    });
  }
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const oauthProvider = config.ownerToken
    ? new LocalPortOAuthProvider(
        {
          ownerToken: config.ownerToken,
          scopes: ["computer-linker"],
          accessTokenTtlSeconds: 60 * 60,
          refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
        },
        mcpUrl,
        { statePath: oauthStatePath() },
      )
    : undefined;
  const bearerAuth = oauthProvider
    ? requireBearerAuth({
        verifier: oauthProvider,
        requiredScopes: ["computer-linker"],
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
      })
    : undefined;

  if (oauthProvider) {
    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: new URL(publicBaseUrl),
        baseUrl: new URL(publicBaseUrl),
        resourceServerUrl,
        scopesSupported: ["computer-linker"],
        resourceName: "Computer Linker",
      }),
    );
  }

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: "computer-linker", machineId: config.machineId, machineName: config.machineName });
  });

  registerApiRoutes(app);

  app.all("/mcp", async (req: Request, res: Response) => {
    let authType: SessionAuthType | undefined;
    const currentOwnerToken = loadConfig().ownerToken;
    if (isAuthorizedLocalPortRequest(req, currentOwnerToken)) {
      // Owner token compatibility path for clients that support custom headers.
      authType = currentOwnerToken ? "owner-token" : "loopback";
    } else if (bearerAuth) {
      try {
        await new Promise<void>((resolve, reject) => {
          bearerAuth(req, res, (error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (error) {
        writeMcpAuthFailure(req, errorMessage(error));
        if (!res.headersSent) sendJsonRpcError(res, 401, -32001, "Unauthorized");
        return;
      }
      if (res.headersSent) {
        writeMcpAuthFailure(req, "oauth middleware rejected request");
        return;
      }

      if (!req.auth?.resource || !checkResourceAllowed({ requestedResource: req.auth.resource, configuredResource: resourceServerUrl })) {
        writeMcpAuthFailure(req, "oauth resource is not allowed");
        sendJsonRpcError(res, 401, -32001, "Unauthorized");
        return;
      }
      authType = "oauth";
    } else {
      writeMcpAuthFailure(req, "unauthorized");
      sendJsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }

    const sessionId = req.header("mcp-session-id");
    const initializeRequest = req.method === "POST" && isInitializeRequest(req.body);

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
        if (!transport) {
          sendJsonRpcError(res, 404, -32000, "Unknown MCP session");
          return;
        }
        touchActiveSession(sessionId);
      } else if (initializeRequest) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) transports.set(newSessionId, transport);
            registerActiveSession({
              id: newSessionId,
              authType: authType ?? "owner-token",
              clientId: req.auth?.clientId,
              clientName: initializeClientName(req.body),
              userAgent: req.header("user-agent"),
              remoteAddress: req.ip,
            });
            writeAuditEvent({
              type: "mcp_session",
              success: true,
              detail: `created:${newSessionId.slice(0, 8)}`,
            });
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            transports.delete(closedSessionId);
            closeActiveSession(closedSessionId);
            writeAuditEvent({
              type: "mcp_session",
              success: true,
              detail: `closed:${closedSessionId.slice(0, 8)}`,
            });
          }
        };

        await createLocalPortMcpServer().connect(transport);
      } else {
        sendJsonRpcError(res, 400, -32000, "No valid MCP session");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : String(error);
        sendJsonRpcError(res, 500, -32603, message);
      }
    }
  });

  const server = app.listen(port, host);
  return {
    url: localMcpUrl,
    publicUrl: mcpUrl.href,
    apiUrl: localApiUrl,
    close: () => {
      void stopAllManagedProcesses();
      void stopAllTunnelProcesses();
      server.close();
    },
  };
}

function publicMcpOnlyHostFromConfig(config: { publicMcpOnly?: boolean; publicBaseUrl?: string }): string | undefined {
  if (!config.publicMcpOnly || !config.publicBaseUrl) return undefined;
  try {
    return new URL(config.publicBaseUrl).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function isPublicMcpOnlyRequest(req: Request, publicHost: string | undefined, localHost: string): boolean {
  const hosts = [
    req.header("host"),
    req.header("x-forwarded-host"),
  ].flatMap((host) => {
    const normalized = normalizeRequestHost(host);
    return normalized ? [normalized] : [];
  });
  if (hosts.length === 0) return false;
  return hosts.some((host) => host === publicHost || !isLocalRequestHost(host, localHost));
}

function normalizeRequestHost(host: string | undefined): string | undefined {
  if (typeof host !== "string") return undefined;
  const value = host.toLowerCase().split(",")[0]?.trim();
  if (!value) return undefined;
  if (value.endsWith(":443")) return value.slice(0, -4);
  if (value.endsWith(":80")) return value.slice(0, -3);
  return value;
}

function isLocalRequestHost(host: string, localHost: string): boolean {
  const hostname = hostnameFromHostHeader(host);
  const configuredHost = hostnameFromHostHeader(localHost);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (configuredHost && configuredHost !== "0.0.0.0" && configuredHost !== "::") {
    localHosts.add(configuredHost);
  }
  return Boolean(hostname && localHosts.has(hostname));
}

function hostnameFromHostHeader(host: string): string | undefined {
  if (!host) return undefined;
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    return close === -1 ? host : host.slice(1, close);
  }
  const colonCount = (host.match(/:/g) ?? []).length;
  if (colonCount === 1) return host.split(":")[0];
  return host;
}

function initializeClientName(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") return undefined;
  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== "object") return undefined;
  const name = (clientInfo as { name?: unknown }).name;
  const version = (clientInfo as { version?: unknown }).version;
  if (typeof name !== "string" || !name.trim()) return undefined;
  return typeof version === "string" && version.trim() ? `${name} ${version}` : name;
}

function isExecError(error: unknown): error is Error & { code: number } {
  return error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "number";
}

function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function writeMcpAuthFailure(req: Request, detail: string): void {
  writeAuthFailureEvent({
    surface: "mcp",
    method: req.method,
    requestPath: req.path,
    remoteAddress: req.ip,
    detail,
  });
}
