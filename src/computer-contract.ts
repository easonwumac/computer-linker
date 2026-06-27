import { randomUUID } from "node:crypto";
import { platform, release, arch, type } from "node:os";
import { basename } from "node:path";
import { readAuditEvents } from "./audit.js";
import type { AuditEventInput } from "./audit.js";
import { getLocalPortCapabilities } from "./capabilities.js";
import { workspaceCapabilityPolicy } from "./capability-policy.js";
import {
  computerOperationContract,
  computerOperationMap,
  publicComputerOperationRegistry,
  type ComputerOperationEnvelope,
} from "./computer-operation-registry.js";
import { loadConfig } from "./config.js";
import { historyInsight } from "./history-insights.js";
import { compatibilityMcpTools, exposedMcpTools, genericMcpTools, mcpToolSurface } from "./mcp-surface.js";
import { workspaceLinkerVersion } from "./package-metadata.js";
import { PermissionDeniedError } from "./permissions.js";
import { connectionProfile } from "./profile.js";
import { screenshotCapability } from "./screenshot.js";
import { listTunnelProcesses, type TunnelProcessSnapshot } from "./tunnels.js";
import { WorkspaceRegistry } from "./workspaces.js";
import {
  allowedWorkspaceOperations,
  normalizeWorkspaceOperationInput,
  runWorkspaceOperation,
  workspaceOperationAuditFields,
  type WorkspaceOperationInput,
} from "./workspace-operations.js";

export interface McpClientSetupOptions {
  tunnels?: TunnelProcessSnapshot[];
  includeSecrets?: boolean;
}

export interface ComputerInfoOptions {
  include?: unknown;
  includeRoots?: boolean;
}

export type ComputerOperationErrorCode =
  | "invalid_request"
  | "unknown_scope"
  | "unknown_operation"
  | "permission_denied"
  | "path_out_of_scope"
  | "unsupported_platform"
  | "provider_unavailable"
  | "timeout"
  | "process_not_found"
  | "os_permission_required"
  | "execution_failed";

export interface ComputerOperationError {
  code: ComputerOperationErrorCode;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

export interface ComputerOperationResult<T = unknown> {
  ok: boolean;
  operationId: string;
  scope: string;
  op: string;
  startedAt: string;
  durationMs: number;
  data?: T;
  error?: ComputerOperationError;
  warnings: string[];
}

const historyViewMap: Record<string, string> = {
  "history.last": "last",
  "history.timeline": "timeline",
  "history.sessions": "sessions",
  "history.connections": "connections",
  "history.failed_replay": "failed_replay",
  "history.debug_bundle": "debug_bundle",
};

const genericAgentInstructions = [
  "You are connected to Computer Linker, a local MCP server for this computer.",
  "First call get_computer_info to inspect available scopes, permissions, and safety boundaries.",
  "Call computer_operation with dotted ops from computerOperationRegistry and the stable envelope {scope, op, target, input, options}.",
  "Stay inside configured scopes. Prefer file.search, file.read, code.context, and get_operation_history before write.",
  "Use write, shell, command, or codex operations only when the reported permissions allow them.",
  "Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools.",
  "If tunnel or connection behavior is unclear, inspect get_operation_history before changing anything.",
];

export function getComputerInfo(options: ComputerInfoOptions = {}): unknown {
  const config = loadConfig();
  const registry = new WorkspaceRegistry(config);
  const includeRoots = shouldIncludeComputerInfoRoots(options);
  const capabilities = getLocalPortCapabilities() as {
    toolReadiness?: unknown;
    exposure?: { publicMcpUrl?: string | null };
    startup?: { localMcpUrl?: string };
    operationRegistry?: unknown;
  };
  const activeMcpToolSurface = mcpToolSurface();
  return {
    kind: "computer-linker-computer-info",
    schemaVersion: 1,
    machineId: config.machineId,
    machineName: config.machineName,
    platform: {
      os: platform(),
      name: type(),
      arch: arch(),
      release: release(),
      shell: process.env.SHELL ? basename(process.env.SHELL) : undefined,
      nodeVersion: process.version,
    },
    service: {
      name: "computer-linker",
      version: workspaceLinkerVersion(),
      transports: ["stdio", "http"],
      localUrl: capabilities.startup?.localMcpUrl ?? `http://${config.host ?? "127.0.0.1"}:${config.port ?? 3939}/mcp`,
      publicUrl: capabilities.exposure?.publicMcpUrl ?? null,
    },
    scopes: registry.listDefinedWorkspaces().map((workspace) => {
      const scope = {
        id: workspace.id,
        name: workspace.name,
        type: "folder",
        displayPath: displayWorkspacePath(workspace.path, workspace.name, workspace.id),
        pathPrivacy: {
          rootsRedacted: !includeRoots,
          reason: includeRoots
            ? "Full roots were explicitly requested by this caller."
            : "Full local roots are redacted from default computer discovery to avoid leaking local usernames, directory layout, or project paths.",
          fullRootsAvailableWith: { include: ["roots"] },
          localDiagnostics: "Use local get_capabilities or list_workspaces diagnostics when the owner needs full configured paths.",
        },
        permissions: workspace.permissions,
        policy: workspace.policy ?? {},
        capabilityPolicy: workspaceCapabilityPolicy(workspace.permissions),
        allowedOperations: allowedWorkspaceOperations(workspace.permissions),
      };
      return includeRoots ? { ...scope, roots: [workspace.path] } : scope;
    }),
    tools: {
      ...(capabilities.toolReadiness && typeof capabilities.toolReadiness === "object" ? capabilities.toolReadiness : {}),
      screenshot: screenshotCapability(),
    },
    operationContract: computerOperationContract,
    operationRegistry: publicComputerOperationRegistry(),
    compatibilityOperationRegistry: capabilities.operationRegistry,
    mcpToolSurface: {
      active: activeMcpToolSurface,
      exposedTools: exposedMcpTools(activeMcpToolSurface),
      compatibilityOptIn: "COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility",
    },
    compatibility: {
      workspaceTools: [...compatibilityMcpTools],
      genericTools: [...genericMcpTools],
    },
    status: {
      ready: true,
      blockingReasons: [],
      warnings: [],
    },
  };
}

function shouldIncludeComputerInfoRoots(options: ComputerInfoOptions): boolean {
  if (options.includeRoots === true) return true;
  const include = options.include;
  if (typeof include === "string") {
    return includeListIncludesRoots([include]);
  }
  if (!Array.isArray(include)) return false;
  return includeListIncludesRoots(include);
}

function includeListIncludesRoots(include: unknown[]): boolean {
  return include
    .map((item) => String(item ?? "").trim().toLowerCase())
    .some((item) => ["root", "roots", "path", "paths", "localroot", "localroots", "details", "debug"].includes(item));
}

function displayWorkspacePath(path: string, name: string, id: string): string {
  return basename(path) || name || id;
}

export function getMcpClientSetup(options: McpClientSetupOptions = {}): unknown {
  const config = loadConfig();
  const profile = connectionProfile(config, options.includeSecrets === true);
  const tunnelSnapshots = options.tunnels ?? listTunnelProcesses();
  const activeOpenAiTunnel = runningOpenAiTunnel(tunnelSnapshots);
  const activeOpenAiTunnelId = activeOpenAiTunnel ? openAiTunnelIdFromSnapshot(activeOpenAiTunnel) : undefined;
  const detectedPublicUrl = runningTunnelPublicUrl(tunnelSnapshots);
  const publicBaseUrl = detectedPublicUrl ?? config.publicBaseUrl;
  const publicMcpUrl = publicBaseUrl ? new URL("/mcp", publicBaseUrl).href : null;
  const publicBaseUrlSource = detectedPublicUrl
    ? "running-tunnel"
    : config.publicBaseUrl ? "configured" : null;
  const remoteReady = Boolean((activeOpenAiTunnel || publicMcpUrl?.startsWith("https://")) && config.ownerToken);
  const blockingReasons: string[] = [];
  const remoteBlockingReasons = [
    ...(!config.ownerToken ? ["ownerToken is required before exposing HTTP MCP beyond loopback"] : []),
    ...(!activeOpenAiTunnel && !publicMcpUrl ? ["No public MCP URL is configured or detected"] : []),
    ...(!activeOpenAiTunnel && publicMcpUrl && !publicMcpUrl.startsWith("https://") ? ["public MCP URL must use https:// for remote clients"] : []),
  ];
  const warnings = [
    ...(!activeOpenAiTunnel && !publicMcpUrl ? ["No public MCP URL is configured or detected; local stdio/loopback clients can still connect."] : []),
    ...(detectedPublicUrl && detectedPublicUrl !== config.publicBaseUrl ? ["Detected tunnel URL is temporary until saved as publicBaseUrl."] : []),
  ];
  const localBearerHeader = config.ownerToken ? profile.http.auth.header ?? "Authorization: Bearer <ownerToken>" : null;

  return {
    kind: "computer-linker-mcp-client-setup",
    schemaVersion: 1,
    machineId: config.machineId,
    machineName: config.machineName,
    localReady: true,
    ready: true,
    remoteReady,
    connection: {
      stdio: profile.stdio,
      localMcpUrl: profile.http.localMcpUrl,
      publicMcpUrl,
      publicBaseUrl: publicBaseUrl ?? null,
      publicBaseUrlSource,
      tunnel: activeOpenAiTunnel
        ? {
            provider: "openai",
            mode: "secure-mcp-tunnel",
            status: "running",
            tunnelId: activeOpenAiTunnelId ?? activeOpenAiTunnel.id,
            localMcpTarget: profile.http.localMcpUrl,
            publicUrlRequired: false,
          }
        : null,
    },
    auth: {
      mode: activeOpenAiTunnel ? "openai-secure-tunnel" : config.ownerToken ? "owner-token-or-oauth" : "loopback-only",
      bearerHeader: activeOpenAiTunnel ? null : localBearerHeader,
      alternateBearerHeader: config.ownerToken
        ? activeOpenAiTunnel
          ? null
          : options.includeSecrets === true
          ? `x-computer-linker-token: ${config.ownerToken}`
          : "x-computer-linker-token: <ownerToken>"
        : null,
      localBearerHeader,
      oauthDiscovery: publicMcpUrl && config.ownerToken && config.publicBaseUrl
        ? {
            authorizationServerMetadataUrl: new URL("/.well-known/oauth-authorization-server", config.publicBaseUrl).href,
            protectedResourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", config.publicBaseUrl).href,
            scopes: ["computer-linker"],
          }
        : null,
      notes: activeOpenAiTunnel
        ? ["OpenAI tunnel-client forwards the owner token to the private local MCP server; do not paste a bearer token into ChatGPT Tunnel mode."]
        : [],
    },
    tools: [...genericMcpTools],
    operationShape: {
      tool: "computer_operation",
      contract: computerOperationContract,
      registry: publicComputerOperationRegistry(),
      envelope: {
        scope: "app",
        op: "file.read",
        target: "README.md",
        input: {},
        options: { maxBytes: 65536 },
      },
    },
    firstPrompt: "Call get_computer_info, choose an allowed scope, then use computer_operation with dotted ops from computerOperationRegistry and the stable scope/op/target/input/options envelope. Use get_operation_history to inspect what happened. Do not call compatibility workspace tools unless the server explicitly exposes them.",
    agentInstructions: genericAgentInstructions,
    blockingReasons,
    remoteBlockingReasons,
    warnings,
    nextActions: mcpClientSetupNextActions(remoteReady, remoteBlockingReasons, warnings, activeOpenAiTunnelId),
  };
}

export async function runComputerOperation(envelope: ComputerOperationEnvelope): Promise<ComputerOperationResult> {
  const operationId = `op_${randomUUID()}`;
  const startedAt = new Date();
  const started = performance.now();
  const inputScope = optionalString(envelope.scope) ?? "";
  const inputOp = optionalString(envelope.op) ?? "";

  try {
    const scope = stringValue(envelope.scope, "scope");
    const op = stringValue(envelope.op, "op");
    const workspaceOperation = computerOperationMap[op] ?? op;
    const input = normalizeComputerOperationInput(envelope, workspaceOperation);
    const registry = new WorkspaceRegistry(loadConfig());
    const workspace = await registry.openWorkspace(scope);
    return {
      ok: true,
      operationId,
      scope,
      op,
      startedAt: startedAt.toISOString(),
      durationMs: elapsedMs(started),
      data: await runWorkspaceOperation(registry, workspace, input),
      warnings: [],
    };
  } catch (error) {
    return {
      ok: false,
      operationId,
      scope: inputScope,
      op: inputOp,
      startedAt: startedAt.toISOString(),
      durationMs: elapsedMs(started),
      error: computerOperationError(error),
      warnings: [],
    };
  }
}

export function getOperationHistory(input: Record<string, unknown>): unknown {
  const view = optionalString(input.view) ?? "last";
  const scope = optionalString(input.scope ?? input.workspace ?? input.workspaceId);
  if (view === "raw") {
    return {
      events: readAuditEvents({
        workspaceId: scope,
        query: optionalString(input.q ?? input.query),
        limit: optionalPositiveInteger(input.limit),
      }),
    };
  }
  return historyInsight({
    view,
    workspaceId: scope,
    query: optionalString(input.q ?? input.query),
    limit: optionalPositiveInteger(input.limit),
  });
}

export function normalizeComputerOperationInput(
  envelope: ComputerOperationEnvelope,
  workspaceOperation = stringValue(envelope.op, "op"),
): WorkspaceOperationInput {
  const sourceOp = stringValue(envelope.op, "op");
  const mappedInput = {
    ...(envelope.input ?? {}),
    ...historyViewInput(sourceOp),
  };
  return normalizeWorkspaceOperationInput({
    operation: workspaceOperation,
    target: envelope.target,
    input: mappedInput,
    options: envelope.options ?? {},
  });
}

export async function computerOperationAuditFields(envelope: ComputerOperationEnvelope): Promise<Partial<AuditEventInput>> {
  const scope = optionalString(envelope.scope);
  const op = optionalString(envelope.op);
  let workspaceOperationInput: WorkspaceOperationInput | undefined;
  try {
    workspaceOperationInput = op ? normalizeComputerOperationInput(envelope, computerOperationMap[op] ?? op) : undefined;
  } catch {
    workspaceOperationInput = undefined;
  }
  const fields: Partial<AuditEventInput> = {
    workspaceRef: scope,
    operation: op,
    target: optionalString(envelope.target),
    ...(workspaceOperationInput ? workspaceOperationAuditFields(workspaceOperationInput) : {}),
  };
  fields.operation = op ?? fields.operation;
  fields.target = optionalString(envelope.target) ?? fields.target;

  if (!scope) return fields;
  try {
    const registry = new WorkspaceRegistry(loadConfig());
    const workspace = await registry.openWorkspace(scope);
    return {
      ...fields,
      workspaceId: workspace.exposedPath.id,
      workspaceRoot: workspace.root,
      workspaceRef: scope,
    };
  } catch {
    return fields;
  }
}

export function computerOperationName(op: string): string {
  return computerOperationMap[op] ?? op;
}

function historyViewInput(op: string): Record<string, unknown> {
  return historyViewMap[op] ? { view: historyViewMap[op] } : {};
}

function stringValue(value: unknown, name: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : undefined;
}

function elapsedMs(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function computerOperationError(error: unknown): ComputerOperationError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: computerOperationErrorCode(error, message),
    message,
    retryable: isRetryableComputerOperationError(message),
    details: error instanceof Error ? { name: error.name } : {},
  };
}

function computerOperationErrorCode(error: unknown, message: string): ComputerOperationErrorCode {
  if (/(^|\s)(scope|op|path|query|command|prompt|processId|operationName|workspace) is required\b/.test(message)) {
    return "invalid_request";
  }
  if (/Unknown configured workspace|Unknown workspaceId/.test(message)) return "unknown_scope";
  if (/outside workspace|outside exposed path|outside workspace root|resolves outside workspace|outside exposed paths/i.test(message)) {
    return "path_out_of_scope";
  }
  if (/operation must be one of|Unknown operation|cannot execute operation|Unsupported Codex workflow/i.test(message)) {
    return "unknown_operation";
  }
  if (error instanceof PermissionDeniedError || /permission is disabled|permission denied|Refusing to .* workspace root/i.test(message)) {
    return "permission_denied";
  }
  if (/os permission|required.*permission|Screen Recording permission/i.test(message)) return "os_permission_required";
  if (/provider.*unavailable|unavailable.*provider/i.test(message)) return "provider_unavailable";
  if (/not implemented|unsupported platform|unsupported|not supported/i.test(message)) return "unsupported_platform";
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/Unknown process|process not found/i.test(message)) return "process_not_found";
  return "execution_failed";
}

function isRetryableComputerOperationError(message: string): boolean {
  return /timed out|timeout|os permission|required.*permission|provider.*unavailable/i.test(message);
}

function runningTunnelPublicUrl(tunnels: TunnelProcessSnapshot[]): string | undefined {
  return tunnels
    .filter((tunnel) => tunnel.status === "running")
    .map((tunnel) => tunnel.publicUrl)
    .find((url): url is string => Boolean(url));
}

function runningOpenAiTunnel(tunnels: TunnelProcessSnapshot[]): TunnelProcessSnapshot | undefined {
  return tunnels.find((tunnel) => tunnel.status === "running" && tunnel.provider === "openai");
}

function openAiTunnelIdFromSnapshot(tunnel: TunnelProcessSnapshot): string | undefined {
  const args = Array.isArray(tunnel.args) ? tunnel.args : [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--control-plane.tunnel-id" && args[index + 1]) return args[index + 1];
  }
  return undefined;
}

function mcpClientSetupNextActions(
  remoteReady: boolean,
  remoteBlockingReasons: string[],
  warnings: string[],
  openAiTunnelId?: string,
): string[] {
  if (remoteReady) {
    if (openAiTunnelId) {
      return [`Use OpenAI/ChatGPT Tunnel mode and select or paste ${openAiTunnelId}; the target MCP path remains /mcp.`, "Then call get_computer_info."];
    }
    return ["Use the public MCP URL with bearer auth or OAuth, then call get_computer_info."];
  }
  const actions = new Set<string>();
  actions.add("For local clients, use stdio or the loopback MCP URL.");
  for (const reason of remoteBlockingReasons) actions.add(`For remote clients, resolve: ${reason}`);
  for (const warning of warnings) actions.add(`Review: ${warning}`);
  return [...actions];
}
