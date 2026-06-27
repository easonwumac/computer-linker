import type { PathPermissions } from "./permissions.js";
import type { WorkspaceOperationName } from "./workspace-operations.js";

export type CapabilityName =
  | "fs:read"
  | "fs:write"
  | "search:read"
  | "history:read"
  | "git:read"
  | "git:write"
  | "package:run"
  | "process:manage"
  | "shell:run"
  | "codex:readOnly"
  | "codex:write"
  | "screen:capture"
  | "network:false";

export interface CapabilityPolicy {
  version: 1;
  source: "derived-from-workspace-permissions";
  capabilities: CapabilityName[];
  limits: {
    maxRuntimeSeconds: number;
    maxFileBytes: number;
    maxSearchResults: number;
    maxBatchOperations: number;
  };
  notes: string[];
}

export interface OperationCapabilityPolicy {
  operation: WorkspaceOperationName;
  capabilities: CapabilityName[];
  limits?: Partial<CapabilityPolicy["limits"]>;
}

const DEFAULT_LIMITS: CapabilityPolicy["limits"] = {
  maxRuntimeSeconds: 3600,
  maxFileBytes: 256 * 1024,
  maxSearchResults: 1000,
  maxBatchOperations: 25,
};

export function workspaceCapabilityPolicy(permissions: PathPermissions): CapabilityPolicy {
  const capabilities = new Set<CapabilityName>(["network:false"]);
  if (permissions.read) {
    capabilities.add("fs:read");
    capabilities.add("search:read");
    capabilities.add("history:read");
    capabilities.add("git:read");
  }
  if (permissions.write) {
    capabilities.add("fs:write");
    capabilities.add("git:write");
  }
  if (permissions.shell) {
    capabilities.add("package:run");
    capabilities.add("process:manage");
    capabilities.add("shell:run");
  }
  if (permissions.codex) {
    capabilities.add("codex:readOnly");
    capabilities.add("codex:write");
    capabilities.add("process:manage");
  }
  if (permissions.screen) {
    capabilities.add("screen:capture");
  }

  return {
    version: 1,
    source: "derived-from-workspace-permissions",
    capabilities: [...capabilities],
    limits: DEFAULT_LIMITS,
    notes: [
      "This policy is derived from the current read/write/shell/codex workspace permissions.",
      "network:false means Workspace Linker does not grant network access as a first-class capability; shell, package, and Codex processes may still use the host network if the underlying tools do.",
      "maxRuntimeSeconds is the upper bound accepted by Workspace Linker for shell, process, package, and Codex timeouts.",
    ],
  };
}

export function operationCapabilityPolicy(operation: WorkspaceOperationName): OperationCapabilityPolicy {
  const capabilities = operationCapabilities(operation);
  const limits = operationLimits(operation);
  return {
    operation,
    capabilities,
    limits: Object.keys(limits).length > 0 ? limits : undefined,
  };
}

function operationCapabilities(operation: WorkspaceOperationName): CapabilityName[] {
  if (operation === "batch") return ["network:false"];
  if (operation === "history" || operation === "history_insight") return ["history:read", "network:false"];
  if (operation === "find_files" || operation === "search_text" || operation === "search_symbols") return ["search:read", "fs:read", "network:false"];
  if (operation.startsWith("git_") || operation === "repo_status" || operation === "git_changes" || operation === "git_diff" || operation === "git_log" || operation === "git_show" || operation === "change_summary") {
    return gitOperationCapabilities(operation);
  }
  if (operation === "package_run" || operation === "package_start") return ["package:run", "process:manage", "network:false"];
  if (operation === "command") return ["shell:run", "network:false"];
  if (operation === "process_start" || operation === "process_list" || operation === "process_read" || operation === "process_stop") return ["process:manage", "network:false"];
  if (operation === "codex" || operation === "codex_start" || operation === "codex_plan" || operation === "codex_review" || operation === "codex_fix" || operation === "codex_test" || operation === "codex_continue" || operation === "codex_runs") {
    return codexOperationCapabilities(operation);
  }
  if (operation === "screen_list" || operation === "screen_capture" || operation === "screen_capture_window" || operation === "screen_capture_process") {
    return ["screen:capture", "network:false"];
  }
  if (operation === "write" || operation === "create_file" || operation === "write_if_unchanged" || operation === "edit" || operation === "patch" || operation === "mkdir" || operation === "delete" || operation === "move") {
    return ["fs:write", "network:false"];
  }
  return ["fs:read", "network:false"];
}

function gitOperationCapabilities(operation: WorkspaceOperationName): CapabilityName[] {
  if (operation === "git_stage" || operation === "git_unstage" || operation === "git_commit" || operation === "git_worktree_create") {
    return ["git:write", "fs:write", "network:false"];
  }
  return ["git:read", "fs:read", "network:false"];
}

function codexOperationCapabilities(operation: WorkspaceOperationName): CapabilityName[] {
  if (operation === "codex_plan" || operation === "codex_review" || operation === "codex_test" || operation === "codex_runs") {
    return ["codex:readOnly", "process:manage", "network:false"];
  }
  return ["codex:write", "process:manage", "network:false"];
}

function operationLimits(operation: WorkspaceOperationName): Partial<CapabilityPolicy["limits"]> {
  if (operation === "batch") return { maxBatchOperations: DEFAULT_LIMITS.maxBatchOperations };
  if (operation === "find_files" || operation === "search_text" || operation === "search_symbols" || operation === "history" || operation === "history_insight") return { maxSearchResults: DEFAULT_LIMITS.maxSearchResults };
  if (operation === "read" || operation === "read_many" || operation === "git_diff" || operation === "git_show" || operation === "repo_status") return { maxFileBytes: DEFAULT_LIMITS.maxFileBytes };
  if (operation === "command" || operation === "process_start" || operation === "package_run" || operation === "package_start" || operation === "codex" || operation === "codex_start" || operation === "codex_plan" || operation === "codex_review" || operation === "codex_fix" || operation === "codex_test" || operation === "codex_continue") {
    return { maxRuntimeSeconds: DEFAULT_LIMITS.maxRuntimeSeconds };
  }
  return {};
}
