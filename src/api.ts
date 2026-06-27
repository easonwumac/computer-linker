import type express from "express";
import type { Request, Response } from "express";
import { errorMessage, readAuditEvents, writeAuditEvent, writeAuthFailureEvent, type AuditEventInput } from "./audit.js";
import { workspaceCapabilityPolicy } from "./capability-policy.js";
import { getLocalPortCapabilities, getLocalPortDoctor } from "./capabilities.js";
import { chatGptSetupStatus } from "./chatgpt.js";
import { computerOperationContract, publicComputerOperationRegistry, type ComputerOperationRegistryEntry } from "./computer-operation-registry.js";
import { computerOperationAuditFields, getComputerInfo, getMcpClientSetup, getOperationHistory, runComputerOperation } from "./computer-contract.js";
import { loadConfig } from "./config.js";
import { historyInsight } from "./history-insights.js";
import { isAuthorizedLocalPortRequest } from "./http-auth.js";
import { PermissionDeniedError } from "./permissions.js";
import { parseChatGptProfileMode } from "./profile.js";
import { listTunnelProcesses } from "./tunnels.js";
import { WorkspaceRegistry, type Workspace } from "./workspaces.js";
import {
  allowedWorkspaceOperations,
  normalizeWorkspaceOperationInput,
  publicWorkspaceOperationRegistry,
  runWorkspaceOperation,
  workspaceOperationContract,
  workspaceOperationRegistry,
  workspaceOperationAuditFields,
  type WorkspaceOperationInput,
  type PublicWorkspaceOperationRegistryEntry,
} from "./workspace-operations.js";

export function registerApiRoutes(app: express.Express): void {
  app.use("/api/v1", (req, res, next) => {
    if (!isAuthorizedLocalPortRequest(req, loadConfig().ownerToken)) {
      writeAuthFailureEvent({
        surface: "api",
        method: req.method,
        requestPath: requestPath(req),
        remoteAddress: req.ip,
      });
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    next();
  });

  app.get("/api/v1/health", (_req, res) => {
    const config = loadConfig();
    res.json({ ok: true, data: { name: "computer-linker", machineId: config.machineId, machineName: config.machineName } });
  });

  app.get("/api/v1/capabilities", (_req, res) => {
    res.json({ ok: true, data: getLocalPortCapabilities() });
  });

  app.get("/api/v1/workspaces", (_req, res) => {
    res.json({ ok: true, data: workspacesData() });
  });

  app.get("/api/v1/history", (req, res) => {
    res.json({ ok: true, data: historyData(req.query) });
  });

  app.post("/api/v1/workspace-operation", apiRoute(async (req) => {
    const input = workspaceOperationInput(req.body);
    return withWorkspace(req.body, "workspace_operation", workspaceOperationAuditFields(input), async (registry, workspace) => (
      runWorkspaceOperation(registry, workspace, input)
    ));
  }));

  app.post("/api/v1/control", apiRoute(async (req) => control(req)));
}

function apiRoute(
  handler: (req: Request) => Promise<unknown>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req)
      .then((data) => res.json({ ok: true, data }))
      .catch((error) => sendApiError(res, error));
  };
}

async function withWorkspace<T>(
  body: Record<string, unknown>,
  tool: string,
  fields: Partial<AuditEventInput>,
  run: (registry: WorkspaceRegistry, workspace: Workspace) => Promise<T>,
): Promise<T> {
  const workspaceRef = requiredString(body.workspace ?? body.workspaceRef, "workspace");
  const registry = new WorkspaceRegistry(loadConfig());
  const workspace = await registry.openWorkspace(workspaceRef);
  return auditedApiCall(tool, {
    workspaceId: workspace.exposedPath.id,
    workspaceRoot: workspace.root,
    workspaceRef,
    ...fields,
  }, async () => run(registry, workspace));
}

async function control(req: Request): Promise<unknown> {
  const action = requiredString(req.body.action, "action");

  switch (action) {
    case "get_computer_info":
    case "computer_info":
      return getComputerInfo(req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : req.body);
    case "client_setup":
    case "mcp_client_setup":
      return getMcpClientSetup({ tunnels: listTunnelProcesses() });
    case "get_capabilities":
    case "capabilities":
      return getLocalPortCapabilities();
    case "doctor":
      return getLocalPortDoctor();
    case "chatgpt_setup":
      return chatGptSetupData(req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : req.body);
    case "list_workspaces":
    case "workspaces":
      return workspacesData();
    case "history":
      return historyData(req.body.filters && typeof req.body.filters === "object" ? req.body.filters as Record<string, unknown> : req.body);
    case "history_insight":
      return historyInsightData(req.body.filters && typeof req.body.filters === "object" ? req.body.filters as Record<string, unknown> : req.body);
    case "get_operation_history":
    case "operation_history":
      return getOperationHistory(req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : req.body);
    case "operation_registry":
      return operationRegistryData(req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : req.body);
    case "computer_operation_registry":
      return computerOperationRegistryData(req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : req.body);
    case "workspace_operation_registry":
      return workspaceOperationRegistryData(req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : req.body);
    case "computer_operation":
      return auditedApiCall("computer_operation", await computerOperationAuditFields({
        scope: optionalString(req.body.scope),
        op: optionalString(req.body.op),
        target: optionalString(req.body.target),
        input: req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : {},
        options: req.body.options && typeof req.body.options === "object" ? req.body.options as Record<string, unknown> : {},
      }), async () => runComputerOperation({
        scope: optionalString(req.body.scope),
        op: optionalString(req.body.op),
        target: optionalString(req.body.target),
        input: req.body.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : {},
        options: req.body.options && typeof req.body.options === "object" ? req.body.options as Record<string, unknown> : {},
      }), operationResultSucceeded);
    case "workspace_operation":
    case "operation": {
      const body = controlWorkspaceOperationBody(req.body);
      const input = workspaceOperationInput(body);
      return withWorkspace(body, "workspace_operation", workspaceOperationAuditFields(input), async (registry, workspace) => (
        runWorkspaceOperation(registry, workspace, input)
      ));
    }
    default:
      throw new Error("action must be one of: get_computer_info, client_setup, get_capabilities, doctor, list_workspaces, history, history_insight, get_operation_history, operation_registry, computer_operation_registry, workspace_operation_registry, computer_operation, workspace_operation, operation");
  }
}

function controlWorkspaceOperationBody(body: Record<string, unknown>): Record<string, unknown> {
  if (body.op || body.operation) return body;
  const inputBody = body.input && typeof body.input === "object" ? body.input as Record<string, unknown> : undefined;
  if (!inputBody) return body;
  return { ...inputBody, workspace: body.workspace ?? inputBody.workspace };
}

function workspacesData(): unknown {
  const config = loadConfig();
  const registry = new WorkspaceRegistry(config);
  return {
    machineId: config.machineId,
    machineName: config.machineName,
    workspaces: registry.listDefinedWorkspaces().map((workspace) => ({
      ...workspace,
      capabilityPolicy: workspaceCapabilityPolicy(workspace.permissions),
      allowedOperations: allowedWorkspaceOperations(workspace.permissions),
    })),
  };
}

function chatGptSetupData(input: Record<string, unknown>): unknown {
  return chatGptSetupStatus(loadConfig(), parseChatGptProfileMode(optionalString(input.mode), "chatgpt_setup mode"), {
    tunnels: listTunnelProcesses(),
  });
}

function historyData(input: Record<string, unknown>): unknown {
  return {
    events: readAuditEvents({
      type: auditType(input.type),
      success: optionalBoolean(input.success),
      tool: optionalString(input.tool),
      workspaceId: optionalString(input.workspaceId),
      query: optionalString(input.q ?? input.query),
      limit: optionalPositiveInteger(input.limit),
    }),
  };
}

function historyInsightData(input: Record<string, unknown>): unknown {
  return historyInsight({
    view: optionalString(input.view),
    workspaceId: optionalString(input.workspaceId ?? input.workspace),
    query: optionalString(input.q ?? input.query),
    limit: optionalPositiveInteger(input.limit),
  });
}

function operationRegistryData(input: Record<string, unknown>): unknown {
  const contract = optionalString(input.contract ?? input.compatibility);
  return contract === "workspace"
    ? workspaceOperationRegistryData(input)
    : computerOperationRegistryData(input);
}

function computerOperationRegistryData(input: Record<string, unknown>): unknown {
  const category = optionalString(input.category);
  const permission = optionalString(input.permission);
  const query = optionalString(input.q ?? input.query)?.toLowerCase();
  const operations = publicComputerOperationRegistry().filter((operation) => (
    matchesComputerOperationCategory(operation, category) &&
    matchesComputerOperationPermission(operation, permission) &&
    matchesComputerOperationQuery(operation, query)
  ));

  return {
    kind: "computer-operation-registry",
    schemaVersion: 1,
    contract: computerOperationContract,
    filters: {
      contract: "computer",
      category,
      permission,
      query,
    },
    count: operations.length,
    operations,
    compatibility: {
      workspaceRegistry: {
        action: "operation_registry",
        input: { contract: "workspace" },
      },
    },
  };
}

function workspaceOperationRegistryData(input: Record<string, unknown>): unknown {
  const category = optionalString(input.category);
  const permission = optionalString(input.permission);
  const query = optionalString(input.q ?? input.query)?.toLowerCase();
  const operations = publicWorkspaceOperationRegistry(workspaceOperationRegistry.filter((operation) => (
    matchesOperationCategory(operation, category) &&
    matchesOperationPermission(operation, permission) &&
    matchesOperationQuery(operation, query)
  )));

  return {
    kind: "operation-registry",
    schemaVersion: 1,
    contract: workspaceOperationContract,
    filters: {
      contract: "workspace",
      category,
      permission,
      query,
    },
    count: operations.length,
    operations,
  };
}

function matchesComputerOperationCategory(operation: ComputerOperationRegistryEntry, category: string | undefined): boolean {
  if (!category) return true;
  if (operation.category === category) return true;
  if (category === "search") return operation.op === "file.search" || operation.op === "code.search_symbols";
  if (category === "coding") return operation.category === "code";
  if (category === "files") return operation.category === "file";
  if (category === "metadata") return operation.category === "history";
  return false;
}

function matchesComputerOperationPermission(operation: ComputerOperationRegistryEntry, permission: string | undefined): boolean {
  return !permission || operation.permission === permission;
}

function matchesComputerOperationQuery(operation: ComputerOperationRegistryEntry, query: string | undefined): boolean {
  if (!query) return true;
  return [
    operation.op,
    operation.category,
    operation.permission,
    operation.description,
    operation.boundary,
    operation.target ?? "",
    operation.backendOperation,
    operation.legacyWorkspaceOperation,
    ...operation.capabilities,
    ...operation.requiredInput,
    ...operation.optionalInput,
    ...operation.options,
  ].some((value) => value.toLowerCase().includes(query));
}

function matchesOperationCategory(operation: PublicWorkspaceOperationRegistryEntry, category: string | undefined): boolean {
  return !category || operation.category === category;
}

function matchesOperationPermission(operation: PublicWorkspaceOperationRegistryEntry, permission: string | undefined): boolean {
  return !permission || operation.permission === permission;
}

function matchesOperationQuery(operation: PublicWorkspaceOperationRegistryEntry, query: string | undefined): boolean {
  if (!query) return true;
  return [
    operation.operation,
    operation.name,
    operation.category,
    operation.permission,
    operation.description,
    operation.boundary,
    ...operation.capabilities,
    ...operation.requiredFields,
    ...operation.optionalFields,
  ].some((value) => value.toLowerCase().includes(query));
}

async function auditedApiCall<T>(
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

function operationResultSucceeded(result: unknown): boolean {
  return !(result && typeof result === "object" && (result as { ok?: unknown }).ok === false);
}

function sendApiError(res: Response, error: unknown): void {
  const status = error instanceof PermissionDeniedError ? 403 : 400;
  res.status(status).json({ ok: false, error: errorMessage(error) });
}

function requiredString(value: unknown, name: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return optionalBoundedPositiveInteger(value, 1000);
}

function optionalBoundedPositiveInteger(value: unknown, max: number): number | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function optionalBoundedNonNegativeInteger(value: unknown, max: number): number | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === "on" || value === "1") return true;
  if (value === false || value === "false" || value === "off" || value === "0") return false;
  return undefined;
}

function workspaceOperationInput(body: Record<string, unknown>): WorkspaceOperationInput {
  return normalizeWorkspaceOperationInput(body);
}

function auditType(value: unknown): "tool_call" | "workspace_open" | "mcp_session" | "auth_failure" | "admin_action" | undefined {
  const text = optionalString(value);
  return text === "tool_call" || text === "workspace_open" || text === "mcp_session" || text === "auth_failure" || text === "admin_action" ? text : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value.map(optionalString).filter((path): path is string => Boolean(path));
  return paths.length ? paths.slice(0, 100) : undefined;
}

function requestPath(req: Request): string {
  return `${req.baseUrl}${req.path}`;
}
