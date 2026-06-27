import type { PublicWorkspaceOperationRegistryEntry, WorkspaceOperationContract, WorkspaceOperationEnvelope, WorkspaceOperationName } from "./workspace-operations.js";
import type { CapabilityPolicy } from "./capability-policy.js";
import type { CodexRunRecord } from "./codex-runs.js";
import type { ComputerOperationContract, ComputerOperationRegistryEntry } from "./computer-operation-registry.js";
import type { FailedReplayItem, HistoryInsight } from "./history-insights.js";
import type { ChatGptSetupStatus, ChatGptVerifyMode } from "./chatgpt.js";
import { runWorkspaceLinkerSdkClientSmoke } from "./client-smoke.js";
import type { WorkspaceLinkerClientSmokeOptions, WorkspaceLinkerClientSmokeReport } from "./client-smoke.js";

export type {
  WorkspaceLinkerClientSmokeCheck,
  WorkspaceLinkerClientSmokeCheckId,
  WorkspaceLinkerClientSmokeOptions,
  WorkspaceLinkerClientSmokeReport,
  WorkspaceLinkerClientSmokeStatus,
} from "./client-smoke.js";

export interface WorkspaceLinkerClientOptions {
  baseUrl: string;
  ownerToken?: string;
  fetch?: typeof fetch;
}

export interface WorkspaceLinkerWorkspace {
  id: string;
  name: string;
  path: string;
  permissions: {
    read: boolean;
    write: boolean;
    shell: boolean;
    codex: boolean;
    screen?: boolean;
  };
  capabilityPolicy?: CapabilityPolicy;
  allowedOperations: WorkspaceOperationName[];
}

export interface WorkspaceLinkerWorkspaces {
  machineId?: string;
  machineName: string;
  workspaces: WorkspaceLinkerWorkspace[];
}

export interface WorkspaceLinkerRunOptions {
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface WorkspaceLinkerReplayOptions {
  workspace?: string;
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface WorkspaceLinkerOperationRequest {
  workspace: string;
  op: WorkspaceOperationName;
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface WorkspaceLinkerComputerOperationRequest {
  scope: string;
  op: string;
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface WorkspaceLinkerOperationHistoryFilters {
  scope?: string;
  view?: "last" | "timeline" | "sessions" | "connections" | "failed_replay" | "debug_bundle" | "raw" | string;
  limit?: number;
  query?: string;
}

export interface WorkspaceLinkerOperationRegistryFilters {
  contract?: "computer" | "workspace";
  compatibility?: "workspace";
  category?: string;
  permission?: string;
  query?: string;
}

export interface WorkspaceLinkerComputerOperationRegistry {
  kind: "computer-operation-registry";
  schemaVersion: 1;
  contract: ComputerOperationContract;
  filters: WorkspaceLinkerOperationRegistryFilters & { contract?: "computer" };
  count: number;
  operations: ComputerOperationRegistryEntry[];
  compatibility?: {
    workspaceRegistry?: {
      action: string;
      input: Record<string, unknown>;
    };
  };
}

export interface WorkspaceLinkerWorkspaceOperationRegistry {
  kind: "operation-registry";
  schemaVersion: 1;
  contract: WorkspaceOperationContract;
  filters: WorkspaceLinkerOperationRegistryFilters & { contract?: "workspace" };
  count: number;
  operations: PublicWorkspaceOperationRegistryEntry[];
}

export type WorkspaceLinkerOperationRegistry =
  | WorkspaceLinkerComputerOperationRegistry
  | WorkspaceLinkerWorkspaceOperationRegistry;

export interface WorkspaceLinkerMcpClientSetup {
  kind: "computer-linker-mcp-client-setup";
  schemaVersion: 1;
  machineId?: string;
  machineName: string;
  localReady: boolean;
  ready: boolean;
  remoteReady: boolean;
  blockingReasons: string[];
  remoteBlockingReasons: string[];
  warnings: string[];
  nextActions: string[];
  connection?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  tools?: string[];
  operationShape?: Record<string, unknown>;
  firstPrompt?: string;
  agentInstructions?: string[];
}

export interface WorkspaceLinkerConnectReadinessOptions {
  /** @deprecated Only used by chatGptSetup(); connectReadiness() is generic. */
  mode?: ChatGptVerifyMode;
  registry?: WorkspaceLinkerOperationRegistryFilters;
}

export interface WorkspaceLinkerConnectReadiness {
  kind: "computer-linker-connect-readiness";
  schemaVersion: 1;
  ready: boolean;
  status: "ready" | "needs_action" | "blocked";
  machine: {
    machineId?: string;
    machineName: string;
  } | null;
  recommendedWorkspace: {
    id: string;
    name: string;
    allowedOperations: WorkspaceOperationName[];
  } | null;
  clientSetup: WorkspaceLinkerMcpClientSetup;
  workspaces: WorkspaceLinkerWorkspace[];
  operationRegistry: WorkspaceLinkerOperationRegistry;
  blockingReasons: string[];
  warnings: string[];
  nextActions: string[];
}

export type WorkspaceLinkerGitOperation =
  | "repo_status"
  | "git_changes"
  | "git_diff"
  | "git_log"
  | "git_show"
  | "git_stage"
  | "git_unstage"
  | "git_commit"
  | "git_worktree_list"
  | "git_worktree_create";

export class WorkspaceLinkerClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly ownerToken?: string;

  constructor(options: WorkspaceLinkerClientOptions) {
    this.baseUrl = normalizeComputerLinkerApiBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.ownerToken = options.ownerToken;
  }

  async health(): Promise<unknown> {
    return this.get("health");
  }

  async getCapabilities<T = unknown>(): Promise<T> {
    return this.get("capabilities") as Promise<T>;
  }

  async doctor<T = unknown>(): Promise<T> {
    return this.control("doctor") as Promise<T>;
  }

  async getComputerInfo<T = unknown>(): Promise<T> {
    return this.control("get_computer_info") as Promise<T>;
  }

  async clientSetup<T = unknown>(): Promise<T> {
    return this.control("client_setup") as Promise<T>;
  }

  async smoke(options: WorkspaceLinkerClientSmokeOptions = {}): Promise<WorkspaceLinkerClientSmokeReport> {
    return runWorkspaceLinkerSdkClientSmoke({
      apiBaseUrl: this.baseUrl,
      ownerToken: this.ownerToken,
      fetchImpl: this.fetchImpl,
      ...options,
    });
  }

  async computerOperation<T = unknown>(
    request: WorkspaceLinkerComputerOperationRequest,
  ): Promise<T> {
    return this.control("computer_operation", {
      scope: request.scope,
      op: request.op,
      target: request.target,
      input: request.input ?? {},
      options: request.options ?? {},
    }) as Promise<T>;
  }

  async getOperationHistory<T = unknown>(
    filters: WorkspaceLinkerOperationHistoryFilters = {},
  ): Promise<T> {
    return this.control("get_operation_history", {
      input: filters,
    }) as Promise<T>;
  }

  /**
   * @deprecated Prefer clientSetup() for generic setup discovery. This remains
   * available for older ChatGPT-specific setup UIs.
   */
  async chatGptSetup<T = ChatGptSetupStatus>(mode: ChatGptVerifyMode = "coding"): Promise<T> {
    return this.control("chatgpt_setup", {
      input: { mode },
    }) as Promise<T>;
  }

  async listWorkspaces(): Promise<WorkspaceLinkerWorkspaces> {
    return this.control("list_workspaces") as Promise<WorkspaceLinkerWorkspaces>;
  }

  async history(filters: Record<string, unknown> = {}): Promise<unknown> {
    return this.control("history", { filters });
  }

  async historyInsight<T = HistoryInsight>(filters: Record<string, unknown> = {}): Promise<T> {
    return this.control("history_insight", { filters }) as Promise<T>;
  }

  async operationRegistry(
    filters: WorkspaceLinkerOperationRegistryFilters = {},
  ): Promise<WorkspaceLinkerOperationRegistry> {
    return this.control("operation_registry", {
      input: filters,
    }) as Promise<WorkspaceLinkerOperationRegistry>;
  }

  async workspaceOperationRegistry(
    filters: Omit<WorkspaceLinkerOperationRegistryFilters, "contract" | "compatibility"> = {},
  ): Promise<WorkspaceLinkerWorkspaceOperationRegistry> {
    return this.control("workspace_operation_registry", {
      input: filters,
    }) as Promise<WorkspaceLinkerWorkspaceOperationRegistry>;
  }

  async connectReadiness(
    options: WorkspaceLinkerConnectReadinessOptions = {},
  ): Promise<WorkspaceLinkerConnectReadiness> {
    const [clientSetup, workspaces, operationRegistry] = await Promise.all([
      this.clientSetup<WorkspaceLinkerMcpClientSetup>(),
      this.listWorkspaces(),
      this.operationRegistry(options.registry),
    ]);
    const blockingReasons = [
      ...clientSetup.blockingReasons,
      ...workspaceBlockingReasons(workspaces),
      ...operationRegistryBlockingReasons(operationRegistry),
    ];
    const warnings = [...clientSetup.warnings];
    const nextActions = dedupeStrings([
      ...blockingReasons.map((reason) => `Resolve: ${reason}`),
      ...warnings.map((warning) => `Review: ${warning}`),
      ...clientSetup.nextActions,
    ]);

    return {
      kind: "computer-linker-connect-readiness",
      schemaVersion: 1,
      ready: blockingReasons.length === 0 && clientSetup.ready,
      status: connectReadinessStatus(blockingReasons, clientSetup.ready),
      machine: {
        machineId: workspaces.machineId,
        machineName: workspaces.machineName,
      },
      recommendedWorkspace: recommendedWorkspace(workspaces.workspaces),
      clientSetup,
      workspaces: workspaces.workspaces,
      operationRegistry,
      blockingReasons,
      warnings,
      nextActions,
    };
  }

  async historyLast<T = HistoryInsight>(filters: Record<string, unknown> = {}): Promise<T> {
    return this.historyInsight<T>({
      ...filters,
      view: "last",
    });
  }

  async historySessions<T = HistoryInsight>(filters: Record<string, unknown> = {}): Promise<T> {
    return this.historyInsight<T>({
      ...filters,
      view: "sessions",
    });
  }

  async historyConnections<T = HistoryInsight>(filters: Record<string, unknown> = {}): Promise<T> {
    return this.historyInsight<T>({
      ...filters,
      view: "connections",
    });
  }

  async failedReplay(filters: Record<string, unknown> = {}): Promise<FailedReplayItem[]> {
    const insight = await this.historyInsight<HistoryInsight>({
      ...filters,
      view: "failed_replay",
    });
    return insight.failedReplay ?? [];
  }

  async workspaceOperation<T = unknown>(
    workspace: string,
    operation: WorkspaceOperationEnvelope,
  ): Promise<T> {
    return this.control("workspace_operation", {
      workspace,
      input: operation,
    }) as Promise<T>;
  }

  async operation<T = unknown>(request: WorkspaceLinkerOperationRequest): Promise<T> {
    return this.control("operation", {
      workspace: request.workspace,
      op: request.op,
      target: request.target,
      input: request.input ?? {},
      options: request.options ?? {},
    }) as Promise<T>;
  }

  async run<T = unknown>(
    workspace: string,
    op: WorkspaceOperationName,
    input: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
    target?: string,
  ): Promise<T> {
    return this.operation({
      workspace,
      op,
      target,
      input,
      options,
    });
  }

  async replayFailed<T = unknown>(
    item: FailedReplayItem,
    replayOptions: WorkspaceLinkerReplayOptions = {},
  ): Promise<T> {
    if (!item.request) {
      throw new Error(item.reason ?? "Failed replay item does not include a request template");
    }

    const input = {
      ...item.request.input.input,
      ...replayOptions.input,
    };
    const missing = (item.requiresInput ?? []).filter((key) => input[key] === undefined);
    if (missing.length > 0) {
      throw new Error(`Failed replay requires input: ${missing.join(", ")}`);
    }
    if (!item.replayable && (item.requiresInput ?? []).length === 0) {
      throw new Error(item.reason ?? "Failed replay item is not replayable");
    }

    return this.operation<T>({
      workspace: replayOptions.workspace ?? item.request.workspace,
      op: item.request.input.op as WorkspaceOperationName,
      target: replayOptions.target ?? item.request.input.target,
      input,
      options: {
        ...item.request.input.options,
        ...replayOptions.options,
      },
    });
  }

  async read(
    workspace: string,
    target: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "read", {}, options, target);
  }

  async readMany(
    workspace: string,
    paths: string[],
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "read_many", { paths }, options);
  }

  async listFiles(
    workspace: string,
    target = ".",
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "list_details", {}, options, target);
  }

  async tree(
    workspace: string,
    target = ".",
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "tree", {}, options, target);
  }

  async write(
    workspace: string,
    target: string,
    content: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "write", { content }, options, target);
  }

  async patch(
    workspace: string,
    patch: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "patch", { patch }, options, target);
  }

  async search(
    workspace: string,
    query: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.searchText(workspace, query, options, target);
  }

  async searchText(
    workspace: string,
    query: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "search_text", { query }, options, target);
  }

  async command(
    workspace: string,
    command: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "command", { command }, options, target);
  }

  async processStart(
    workspace: string,
    command: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "process_start", { command }, options, target);
  }

  async processList(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "process_list", {}, options);
  }

  async processRead(
    workspace: string,
    processId: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "process_read", {}, options, processId);
  }

  async processStop(
    workspace: string,
    processId: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "process_stop", {}, options, processId);
  }

  async screenList<T = unknown>(
    scope: string,
  ): Promise<T> {
    return this.computerOperation<T>({ scope, op: "screen.list" });
  }

  async screenCapture<T = unknown>(
    scope: string,
    target = "primary",
    options: Record<string, unknown> = {},
  ): Promise<T> {
    return this.computerOperation<T>({ scope, op: "screen.capture", target, options });
  }

  async screenCaptureWindow<T = unknown>(
    scope: string,
    windowId: string,
    options: Record<string, unknown> = {},
  ): Promise<T> {
    return this.computerOperation<T>({ scope, op: "screen.capture_window", target: windowId, options });
  }

  async screenCaptureProcess<T = unknown>(
    scope: string,
    processIdOrName: string,
    options: Record<string, unknown> = {},
  ): Promise<T> {
    return this.computerOperation<T>({ scope, op: "screen.capture_process", target: processIdOrName, options });
  }

  async git<T = unknown>(
    workspace: string,
    op: WorkspaceLinkerGitOperation,
    input: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<T> {
    return this.run<T>(workspace, op, input, options, target);
  }

  async repoStatus(
    workspace: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.git(workspace, "repo_status", {}, options, target);
  }

  async gitDiff(
    workspace: string,
    paths: string[] = [],
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.git(workspace, "git_diff", { paths }, options, target);
  }

  async workspaceHistory(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "history", {}, options);
  }

  async workspaceHistoryInsight(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "history_insight", {}, options);
  }

  async workspaceHistoryLast(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.workspaceHistoryInsight(workspace, {
      ...options,
      view: "last",
    });
  }

  async workspaceHistorySessions(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.workspaceHistoryInsight(workspace, {
      ...options,
      view: "sessions",
    });
  }

  async codex(
    workspace: string,
    prompt: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex", { prompt, ...options }, {}, target);
  }

  async codexPlan(
    workspace: string,
    prompt: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_plan", { prompt, ...options }, {}, target);
  }

  async codexReview(
    workspace: string,
    prompt?: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_review", prompt ? { prompt, ...options } : options, {}, target);
  }

  async codexFix(
    workspace: string,
    prompt: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_fix", { prompt, ...options }, {}, target);
  }

  async codexTest(
    workspace: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_test", options, {}, target);
  }

  async codexContinue(
    workspace: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_continue", options, {}, target);
  }

  async codexRuns(
    workspace: string,
    options: { workflowId?: string; maxResults?: number } = {},
  ): Promise<CodexRunRecord[]> {
    const result = await this.run<{ runs: CodexRunRecord[] }>(
      workspace,
      "codex_runs",
      options.maxResults === undefined ? {} : { maxResults: options.maxResults },
      {},
      options.workflowId,
    );
    return result.runs;
  }

  private async control(action: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.post("control", { action, ...body });
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path, { method: "GET" });
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: "GET",
      headers: this.authHeaders(),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Computer Linker request failed with HTTP ${response.status}`;
      throw new Error(error);
    }
    return payload;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        ...this.authHeaders(),
        ...init.headers,
      },
    });
    const payload = await response.json() as { ok?: boolean; data?: unknown; error?: string };
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error ?? `Computer Linker request failed with HTTP ${response.status}`);
    }
    return payload.data;
  }

  private authHeaders(): Record<string, string> {
    return this.ownerToken ? { authorization: `Bearer ${this.ownerToken}` } : {};
  }
}

export { WorkspaceLinkerClient as ComputerLinkerClient };

function normalizeComputerLinkerApiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "ComputerLinkerClient baseUrl must be an absolute JSON API URL, such as http://127.0.0.1:3939/api/v1.",
    );
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const lastSegment = path.split("/").filter(Boolean).at(-1);
  if (lastSegment === "mcp") {
    throw new Error(
      "ComputerLinkerClient baseUrl points to the MCP endpoint (/mcp). " +
        "The SDK uses the JSON API; pass http://127.0.0.1:3939/api/v1 or the origin URL, or use an MCP client for /mcp.",
    );
  }

  url.search = "";
  url.hash = "";
  url.pathname = path === "/" ? "/api/v1/" : `${path}/`;
  return url;
}

function connectReadinessStatus(
  blockingReasons: string[],
  setupReady: boolean,
): WorkspaceLinkerConnectReadiness["status"] {
  if (blockingReasons.length > 0) return "blocked";
  return setupReady ? "ready" : "needs_action";
}

function workspaceBlockingReasons(workspaces: WorkspaceLinkerWorkspaces): string[] {
  return workspaces.workspaces.length > 0 ? [] : ["No workspaces are configured"];
}

function operationRegistryBlockingReasons(registry: WorkspaceLinkerOperationRegistry): string[] {
  return registry.operations.length > 0 ? [] : ["Operation registry returned no operations"];
}

function recommendedWorkspace(workspaces: WorkspaceLinkerWorkspace[]): WorkspaceLinkerConnectReadiness["recommendedWorkspace"] {
  const workspace = workspaces.find((entry) => (
    entry.permissions.read &&
    entry.allowedOperations.includes("coding_context") &&
    entry.allowedOperations.includes("search_text")
  )) ?? workspaces[0];
  if (!workspace) return null;
  return {
    id: workspace.id,
    name: workspace.name,
    allowedOperations: workspace.allowedOperations,
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
