import type { PublicWorkspaceOperationRegistryEntry, WorkspaceOperationContract, WorkspaceOperationEnvelope, WorkspaceOperationName } from "./workspace-operations.js";
import type { CapabilityPolicy } from "./capability-policy.js";
import type { CodexRunRecord } from "./codex-runs.js";
import type { ComputerOperationContract, ComputerOperationRegistryEntry } from "./computer-operation-registry.js";
import type { FailedReplayItem, HistoryInsight } from "./history-insights.js";
import type { ChatGptSetupStatus, ChatGptVerifyMode } from "./chatgpt.js";
import { runWorkspaceLinkerSdkClientSmoke } from "./client-smoke.js";
import type {
  WorkspaceLinkerClientSmokeCheck,
  WorkspaceLinkerClientSmokeCheckId,
  WorkspaceLinkerClientSmokeOptions,
  WorkspaceLinkerClientSmokeReport,
  WorkspaceLinkerClientSmokeStatus,
} from "./client-smoke.js";
import { computerLinkerDiscovery } from "./discovery-contract.js";
import type { ComputerLinkerDiscovery as ComputerLinkerDiscoveryContract } from "./discovery-contract.js";

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

export type ComputerLinkerOperationName =
  | "file.stat"
  | "file.list"
  | "file.tree"
  | "file.read"
  | "file.read_many"
  | "file.write"
  | "file.create"
  | "file.patch"
  | "file.move"
  | "file.delete"
  | "file.find"
  | "file.search"
  | "code.context"
  | "code.search_symbols"
  | "git.status"
  | "git.changes"
  | "git.diff"
  | "git.log"
  | "git.show"
  | "git.stage"
  | "git.unstage"
  | "git.commit"
  | "package.run"
  | "package.start"
  | "command.run"
  | "command.start"
  | "command.read"
  | "command.stop"
  | "command.list"
  | "process.start"
  | "process.read"
  | "process.stop"
  | "process.list"
  | "codex.run"
  | "codex.start"
  | "codex.read"
  | "codex.stop"
  | "codex.list"
  | "history.last"
  | "history.timeline"
  | "history.sessions"
  | "history.connections"
  | "history.failed_replay"
  | "history.debug_bundle"
  | "screen.list"
  | "screen.capture"
  | "screen.capture_window"
  | "screen.capture_process";

export interface ComputerLinkerOperationRequest {
  scope: string;
  op: ComputerLinkerOperationName | (string & {});
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ComputerLinkerComputerHelpers {
  file: {
    stat<T = unknown>(scope: string, target: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, target?: string, options?: Record<string, unknown>): Promise<T>;
    tree<T = unknown>(scope: string, target?: string, options?: Record<string, unknown>): Promise<T>;
    read<T = unknown>(scope: string, target: string, options?: Record<string, unknown>): Promise<T>;
    readMany<T = unknown>(scope: string, paths: string[], options?: Record<string, unknown>): Promise<T>;
    write<T = unknown>(scope: string, target: string, content: string, options?: Record<string, unknown>): Promise<T>;
    create<T = unknown>(scope: string, target: string, content: string, options?: Record<string, unknown>): Promise<T>;
    patch<T = unknown>(scope: string, patch: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    move<T = unknown>(scope: string, fromPath: string, toPath: string, options?: Record<string, unknown>): Promise<T>;
    delete<T = unknown>(scope: string, target: string, input?: Record<string, unknown>, options?: Record<string, unknown>): Promise<T>;
    find<T = unknown>(scope: string, pattern: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    search<T = unknown>(scope: string, query: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  code: {
    context<T = unknown>(scope: string, target?: string, options?: Record<string, unknown>): Promise<T>;
    searchSymbols<T = unknown>(scope: string, query: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  git: {
    status<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    changes<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    diff<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    log<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    show<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    stage<T = unknown>(scope: string, paths: string[], options?: Record<string, unknown>, target?: string): Promise<T>;
    unstage<T = unknown>(scope: string, paths: string[], options?: Record<string, unknown>, target?: string): Promise<T>;
    commit<T = unknown>(scope: string, message: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  package: {
    run<T = unknown>(scope: string, script: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    start<T = unknown>(scope: string, script: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  command: {
    run<T = unknown>(scope: string, command: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    start<T = unknown>(scope: string, command: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    read<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    stop<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
  process: {
    start<T = unknown>(scope: string, command: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    read<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    stop<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
  codex: {
    run<T = unknown>(scope: string, prompt: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    start<T = unknown>(scope: string, prompt: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    read<T = unknown>(scope: string, workflowId: string, options?: Record<string, unknown>): Promise<T>;
    stop<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
  history: {
    last<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    timeline<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    sessions<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    connections<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    failedReplay<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    debugBundle<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
}

export interface WorkspaceLinkerOperationHistoryFilters {
  scope?: string;
  view?: "last" | "timeline" | "sessions" | "connections" | "failed_replay" | "debug_bundle" | "raw" | string;
  limit?: number;
  query?: string;
}

export interface WorkspaceLinkerComputerInfoOptions {
  include?: string[];
  includeRoots?: boolean;
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

export type WorkspaceLinkerDiscovery = ComputerLinkerDiscoveryContract;

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
  discovery: WorkspaceLinkerDiscovery;
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

export type ComputerLinkerClientOptions = WorkspaceLinkerClientOptions;
export type ComputerLinkerScope = WorkspaceLinkerWorkspace;
export type ComputerLinkerWorkspace = WorkspaceLinkerWorkspace;
export type ComputerLinkerScopes = WorkspaceLinkerWorkspaces;
export type ComputerLinkerWorkspaces = WorkspaceLinkerWorkspaces;
export type ComputerLinkerRunOptions = WorkspaceLinkerRunOptions;
export type ComputerLinkerReplayOptions = WorkspaceLinkerReplayOptions;
export type ComputerLinkerWorkspaceOperationRequest = WorkspaceLinkerOperationRequest;
export type ComputerLinkerComputerOperationRequest = ComputerLinkerOperationRequest;
export type ComputerLinkerOperationHistoryFilters = WorkspaceLinkerOperationHistoryFilters;
export type ComputerLinkerComputerInfoOptions = WorkspaceLinkerComputerInfoOptions;
export type ComputerLinkerOperationRegistryFilters = WorkspaceLinkerOperationRegistryFilters;
export type ComputerLinkerComputerOperationRegistry = WorkspaceLinkerComputerOperationRegistry;
export type ComputerLinkerWorkspaceOperationRegistry = WorkspaceLinkerWorkspaceOperationRegistry;
export type ComputerLinkerOperationRegistry = WorkspaceLinkerOperationRegistry;
export type ComputerLinkerMcpClientSetup = WorkspaceLinkerMcpClientSetup;
export type ComputerLinkerDiscovery = WorkspaceLinkerDiscovery;
export type ComputerLinkerConnectReadinessOptions = WorkspaceLinkerConnectReadinessOptions;
export type ComputerLinkerConnectReadiness = WorkspaceLinkerConnectReadiness;
export type ComputerLinkerGitOperation = WorkspaceLinkerGitOperation;
export type ComputerLinkerClientSmokeCheck = WorkspaceLinkerClientSmokeCheck;
export type ComputerLinkerClientSmokeCheckId = WorkspaceLinkerClientSmokeCheckId;
export type ComputerLinkerClientSmokeOptions = WorkspaceLinkerClientSmokeOptions;
export type ComputerLinkerClientSmokeReport = WorkspaceLinkerClientSmokeReport;
export type ComputerLinkerClientSmokeStatus = WorkspaceLinkerClientSmokeStatus;

export class WorkspaceLinkerClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly ownerToken?: string;

  readonly computer: ComputerLinkerComputerHelpers = {
    file: {
      stat: <T = unknown>(scope: string, target: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.stat", target, options })
      ),
      list: <T = unknown>(scope: string, target = ".", options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.list", target, options })
      ),
      tree: <T = unknown>(scope: string, target = ".", options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.tree", target, options })
      ),
      read: <T = unknown>(scope: string, target: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.read", target, options })
      ),
      readMany: <T = unknown>(scope: string, paths: string[], options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.read_many", input: { paths }, options })
      ),
      write: <T = unknown>(scope: string, target: string, content: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.write", target, input: { content }, options })
      ),
      create: <T = unknown>(scope: string, target: string, content: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.create", target, input: { content }, options })
      ),
      patch: <T = unknown>(scope: string, patch: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "file.patch", target, input: { patch }, options })
      ),
      move: <T = unknown>(scope: string, fromPath: string, toPath: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.move", target: fromPath, input: { toPath }, options })
      ),
      delete: <T = unknown>(scope: string, target: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "file.delete", target, input, options })
      ),
      find: <T = unknown>(scope: string, pattern: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "file.find", target, input: { pattern }, options })
      ),
      search: <T = unknown>(scope: string, query: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "file.search", target, input: { query, ...input }, options })
      ),
    },
    code: {
      context: <T = unknown>(scope: string, target = ".", options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "code.context", target, options })
      ),
      searchSymbols: <T = unknown>(scope: string, query: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "code.search_symbols", target, input: { query, ...input }, options })
      ),
    },
    git: {
      status: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.status", target, input, options })
      ),
      changes: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.changes", target, input, options })
      ),
      diff: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.diff", target, input, options })
      ),
      log: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.log", target, input, options })
      ),
      show: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.show", target, input, options })
      ),
      stage: <T = unknown>(scope: string, paths: string[], options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.stage", target, input: { paths }, options })
      ),
      unstage: <T = unknown>(scope: string, paths: string[], options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.unstage", target, input: { paths }, options })
      ),
      commit: <T = unknown>(scope: string, message: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "git.commit", target, input: { message, ...input }, options })
      ),
    },
    package: {
      run: <T = unknown>(scope: string, script: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "package.run", target, input: { script, ...input }, options })
      ),
      start: <T = unknown>(scope: string, script: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "package.start", target, input: { script, ...input }, options })
      ),
    },
    command: {
      run: <T = unknown>(scope: string, command: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "command.run", target, input: { command }, options })
      ),
      start: <T = unknown>(scope: string, command: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "command.start", target, input: { command }, options })
      ),
      read: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "command.read", target: processId, options })
      ),
      stop: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "command.stop", target: processId, options })
      ),
      list: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "command.list", options })
      ),
    },
    process: {
      start: <T = unknown>(scope: string, command: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "process.start", target, input: { command }, options })
      ),
      read: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "process.read", target: processId, options })
      ),
      stop: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "process.stop", target: processId, options })
      ),
      list: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "process.list", options })
      ),
    },
    codex: {
      run: <T = unknown>(scope: string, prompt: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "codex.run", target, input: { prompt }, options })
      ),
      start: <T = unknown>(scope: string, prompt: string, options: Record<string, unknown> = {}, target = ".") => (
        this.computerOperation<T>({ scope, op: "codex.start", target, input: { prompt }, options })
      ),
      read: <T = unknown>(scope: string, workflowId: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "codex.read", target: workflowId, options })
      ),
      stop: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "codex.stop", target: processId, options })
      ),
      list: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "codex.list", options })
      ),
    },
    history: {
      last: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "history.last", options })
      ),
      timeline: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "history.timeline", options })
      ),
      sessions: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "history.sessions", options })
      ),
      connections: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "history.connections", options })
      ),
      failedReplay: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "history.failed_replay", options })
      ),
      debugBundle: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        this.computerOperation<T>({ scope, op: "history.debug_bundle", options })
      ),
    },
  };

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

  async getComputerInfo<T = unknown>(options: WorkspaceLinkerComputerInfoOptions = {}): Promise<T> {
    return this.control("get_computer_info", { ...options }) as Promise<T>;
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
      discovery: computerLinkerDiscovery(),
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

  /**
   * @deprecated Compatibility workspace-operation helper. Prefer
   * computerOperation() or the computer.* helpers for new SDK code.
   */
  async workspaceOperation<T = unknown>(
    workspace: string,
    operation: WorkspaceOperationEnvelope,
  ): Promise<T> {
    return this.control("workspace_operation", {
      workspace,
      input: operation,
    }) as Promise<T>;
  }

  /**
   * @deprecated Compatibility JSON action for legacy workspace operation names.
   * Prefer computerOperation() or the computer.* helpers.
   */
  async operation<T = unknown>(request: WorkspaceLinkerOperationRequest): Promise<T> {
    return this.control("operation", {
      workspace: request.workspace,
      op: request.op,
      target: request.target,
      input: request.input ?? {},
      options: request.options ?? {},
    }) as Promise<T>;
  }

  /**
   * @deprecated Compatibility runner for legacy workspace operation names.
   * Prefer computerOperation() or the computer.* helpers.
   */
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

  /**
   * @deprecated Replays a legacy workspace-operation history template. Prefer
   * computerOperation() for new calls.
   */
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

  /** @deprecated Prefer computer.file.read(). */
  async read(
    workspace: string,
    target: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "read", {}, options, target);
  }

  /** @deprecated Prefer computer.file.readMany(). */
  async readMany(
    workspace: string,
    paths: string[],
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "read_many", { paths }, options);
  }

  /** @deprecated Prefer computer.file.list(). */
  async listFiles(
    workspace: string,
    target = ".",
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "list_details", {}, options, target);
  }

  /** @deprecated Prefer computer.file.tree(). */
  async tree(
    workspace: string,
    target = ".",
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "tree", {}, options, target);
  }

  /** @deprecated Prefer computer.file.write(). */
  async write(
    workspace: string,
    target: string,
    content: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "write", { content }, options, target);
  }

  /** @deprecated Prefer computer.file.patch(). */
  async patch(
    workspace: string,
    patch: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "patch", { patch }, options, target);
  }

  /** @deprecated Prefer computer.file.search(). */
  async search(
    workspace: string,
    query: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.searchText(workspace, query, options, target);
  }

  /** @deprecated Prefer computer.file.search(). */
  async searchText(
    workspace: string,
    query: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "search_text", { query }, options, target);
  }

  /** @deprecated Prefer computer.command.run(). */
  async command(
    workspace: string,
    command: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "command", { command }, options, target);
  }

  /** @deprecated Prefer computer.process.start() or computer.command.start(). */
  async processStart(
    workspace: string,
    command: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "process_start", { command }, options, target);
  }

  /** @deprecated Prefer computer.process.list() or computer.command.list(). */
  async processList(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "process_list", {}, options);
  }

  /** @deprecated Prefer computer.process.read() or computer.command.read(). */
  async processRead(
    workspace: string,
    processId: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "process_read", {}, options, processId);
  }

  /** @deprecated Prefer computer.process.stop() or computer.command.stop(). */
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

  /** @deprecated Prefer computer.git.* helpers such as computer.git.diff(). */
  async git<T = unknown>(
    workspace: string,
    op: WorkspaceLinkerGitOperation,
    input: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<T> {
    return this.run<T>(workspace, op, input, options, target);
  }

  /** @deprecated Prefer computer.git.status(). */
  async repoStatus(
    workspace: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.git(workspace, "repo_status", {}, options, target);
  }

  /** @deprecated Prefer computer.git.diff(). */
  async gitDiff(
    workspace: string,
    paths: string[] = [],
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.git(workspace, "git_diff", { paths }, options, target);
  }

  /** @deprecated Prefer computer.history.* helpers or getOperationHistory(). */
  async workspaceHistory(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "history", {}, options);
  }

  /** @deprecated Prefer computer.history.* helpers or getOperationHistory(). */
  async workspaceHistoryInsight(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.run(workspace, "history_insight", {}, options);
  }

  /** @deprecated Prefer computer.history.last() or getOperationHistory(). */
  async workspaceHistoryLast(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.workspaceHistoryInsight(workspace, {
      ...options,
      view: "last",
    });
  }

  /** @deprecated Prefer computer.history.sessions() or getOperationHistory(). */
  async workspaceHistorySessions(
    workspace: string,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.workspaceHistoryInsight(workspace, {
      ...options,
      view: "sessions",
    });
  }

  /** @deprecated Prefer computer.codex.run(). */
  async codex(
    workspace: string,
    prompt: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex", { prompt, ...options }, {}, target);
  }

  /** @deprecated Prefer computer.codex.run() or computer.codex.start(). */
  async codexPlan(
    workspace: string,
    prompt: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_plan", { prompt, ...options }, {}, target);
  }

  /** @deprecated Prefer computer.codex.run() or computer.codex.start(). */
  async codexReview(
    workspace: string,
    prompt?: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_review", prompt ? { prompt, ...options } : options, {}, target);
  }

  /** @deprecated Prefer computer.codex.run() or computer.codex.start(). */
  async codexFix(
    workspace: string,
    prompt: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_fix", { prompt, ...options }, {}, target);
  }

  /** @deprecated Prefer computer.codex.run() or computer.codex.start(). */
  async codexTest(
    workspace: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_test", options, {}, target);
  }

  /** @deprecated Prefer computer.codex.run() or computer.codex.start(). */
  async codexContinue(
    workspace: string,
    options: Record<string, unknown> = {},
    target = ".",
  ): Promise<unknown> {
    return this.run(workspace, "codex_continue", options, {}, target);
  }

  /** @deprecated Prefer computer.codex.list() or computer.codex.read(). */
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
