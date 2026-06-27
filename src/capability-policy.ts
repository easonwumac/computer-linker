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
  networkAccess: NetworkAccessPolicy;
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
  networkAccess: NetworkAccessPolicy;
  limits?: Partial<CapabilityPolicy["limits"]>;
}

export type NetworkAccessMode = "not-required" | "host-process-may-use-network" | "mixed";

export interface NetworkAccessPolicy {
  mode: NetworkAccessMode;
  requiredByComputerLinker: boolean;
  networkNotGrantedByComputerLinker: boolean;
  networkBlockedByComputerLinker: boolean;
  hostNetworkMayBeUsed: boolean;
  externalNetworkControlsRequired: boolean;
  note: string;
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
    networkAccess: workspaceNetworkAccessPolicy(permissions),
    limits: DEFAULT_LIMITS,
    notes: [
      "This policy is derived from the current read/write/shell/codex workspace permissions.",
      "network:false is a legacy non-grant marker. It is not a network-blocking guarantee; check networkAccess for machine-readable semantics.",
      "maxRuntimeSeconds is the upper bound accepted by Computer Linker for shell, process, package, and Codex timeouts.",
    ],
  };
}

export function operationCapabilityPolicy(operation: WorkspaceOperationName): OperationCapabilityPolicy {
  const capabilities = operationCapabilities(operation);
  const limits = operationLimits(operation);
  return {
    operation,
    capabilities,
    networkAccess: operationNetworkAccessPolicy(operation),
    limits: Object.keys(limits).length > 0 ? limits : undefined,
  };
}

function operationCapabilities(operation: WorkspaceOperationName): CapabilityName[] {
  if (operation === "batch") return [];
  if (operation === "history" || operation === "history_insight") return ["history:read", "network:false"];
  if (operation === "find_files" || operation === "search_text" || operation === "search_symbols") return ["search:read", "fs:read", "network:false"];
  if (operation.startsWith("git_") || operation === "repo_status" || operation === "git_changes" || operation === "git_diff" || operation === "git_log" || operation === "git_show" || operation === "change_summary") {
    return gitOperationCapabilities(operation);
  }
  if (operation === "package_run" || operation === "package_start") return ["package:run", "process:manage"];
  if (operation === "command") return ["shell:run"];
  if (operation === "process_start") return ["process:manage"];
  if (operation === "process_list" || operation === "process_read" || operation === "process_stop") return ["process:manage", "network:false"];
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
    return operation === "codex_runs"
      ? ["codex:readOnly", "process:manage", "network:false"]
      : ["codex:readOnly", "process:manage"];
  }
  return ["codex:write", "process:manage"];
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

export function legacyNetworkCapabilitySemantics(): {
  legacyCapability: "network:false";
  meaning: string;
  networkNotGrantedByComputerLinker: true;
  networkBlockedByComputerLinker: false;
  externalNetworkControlsRequiredForIsolation: true;
} {
  return {
    legacyCapability: "network:false",
    meaning: "Computer Linker does not grant network access as a first-class capability. This marker is not a network isolation or firewall guarantee.",
    networkNotGrantedByComputerLinker: true,
    networkBlockedByComputerLinker: false,
    externalNetworkControlsRequiredForIsolation: true,
  };
}

function workspaceNetworkAccessPolicy(permissions: PathPermissions): NetworkAccessPolicy {
  if (permissions.shell || permissions.codex) {
    return hostProcessNetworkAccessPolicy(
      "This scope can start shell, package, process, or Codex host processes. Computer Linker does not grant or block their network access; use OS, container, firewall, proxy, or network-layer policy if isolation is required.",
    );
  }
  return localOperationNetworkAccessPolicy("Configured read/write/search/history operations do not require network access from Computer Linker.");
}

function operationNetworkAccessPolicy(operation: WorkspaceOperationName): NetworkAccessPolicy {
  if (operation === "batch") {
    return {
      mode: "mixed",
      requiredByComputerLinker: false,
      networkNotGrantedByComputerLinker: true,
      networkBlockedByComputerLinker: false,
      hostNetworkMayBeUsed: true,
      externalNetworkControlsRequired: true,
      note: "Batch network behavior depends on child operations. Computer Linker does not block host network access for shell, package, process, or Codex children.",
    };
  }
  if (operation === "command") {
    return hostProcessNetworkAccessPolicy("Shell commands run as host processes. Computer Linker bounds cwd, runtime, output, and policy patterns, but does not block host network access.");
  }
  if (operation === "package_run" || operation === "package_start") {
    return hostProcessNetworkAccessPolicy("Package scripts run as host processes. Computer Linker checks the configured command policy, but does not block host network access.");
  }
  if (operation === "process_start") {
    return hostProcessNetworkAccessPolicy("Managed processes run as host processes. Computer Linker tracks and can stop them, but does not block host network access.");
  }
  if (isCodexExecutionOperation(operation)) {
    return hostProcessNetworkAccessPolicy("Codex runs as a host process and may invoke tools. Computer Linker bounds cwd, runtime, output, and policy patterns, but does not block host network access.");
  }
  if (operation === "process_list" || operation === "process_read" || operation === "process_stop") {
    return localOperationNetworkAccessPolicy("This operation manages Computer Linker process records and does not itself require network access.");
  }
  return localOperationNetworkAccessPolicy("This operation does not require network access from Computer Linker.");
}

function localOperationNetworkAccessPolicy(note: string): NetworkAccessPolicy {
  return {
    mode: "not-required",
    requiredByComputerLinker: false,
    networkNotGrantedByComputerLinker: true,
    networkBlockedByComputerLinker: false,
    hostNetworkMayBeUsed: false,
    externalNetworkControlsRequired: false,
    note,
  };
}

function hostProcessNetworkAccessPolicy(note: string): NetworkAccessPolicy {
  return {
    mode: "host-process-may-use-network",
    requiredByComputerLinker: false,
    networkNotGrantedByComputerLinker: true,
    networkBlockedByComputerLinker: false,
    hostNetworkMayBeUsed: true,
    externalNetworkControlsRequired: true,
    note,
  };
}

function isCodexExecutionOperation(operation: WorkspaceOperationName): boolean {
  return operation === "codex" ||
    operation === "codex_start" ||
    operation === "codex_plan" ||
    operation === "codex_review" ||
    operation === "codex_fix" ||
    operation === "codex_test" ||
    operation === "codex_continue";
}
