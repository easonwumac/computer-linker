import {
  workspaceOperationEntry,
  type PublicWorkspaceOperationRegistryEntry,
  type WorkspaceOperationName,
} from "./workspace-operations.js";
import { screenshotCapability, type ScreenshotCaptureOptions } from "./screenshot.js";

export interface ComputerOperationEnvelope {
  scope?: string;
  op?: string;
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ComputerOperationRegistryEntry {
  op: string;
  category: "file" | "code" | "git" | "package" | "command" | "process" | "codex" | "history" | "screen";
  permission: PublicWorkspaceOperationRegistryEntry["permission"];
  capabilities: PublicWorkspaceOperationRegistryEntry["capabilities"];
  networkAccess: PublicWorkspaceOperationRegistryEntry["networkAccess"];
  boundary: PublicWorkspaceOperationRegistryEntry["boundary"];
  description: string;
  target?: string;
  requiredInput: string[];
  optionalInput: string[];
  options: string[];
  backendOperation: WorkspaceOperationName;
  legacyWorkspaceOperation: WorkspaceOperationName;
  example: ComputerOperationEnvelope;
}

export interface ComputerOperationContract {
  version: 1;
  mcp: {
    tool: "computer_operation";
    requiredFields: ["scope", "op"];
  };
  jsonApi: {
    endpoint: "POST /api/v1/control";
    action: "computer_operation";
    requiredFields: ["action", "scope", "op"];
  };
  envelope: ComputerOperationEnvelope;
  guidance: string[];
  compatibility: {
    acceptsLegacyWorkspaceOps: true;
    legacyRegistry: "operationRegistry";
  };
}

interface ComputerOperationDefinition {
  op: string;
  category: ComputerOperationRegistryEntry["category"];
  backendOperation: WorkspaceOperationName;
  target?: string;
  backendTarget?: string;
  description: string;
}

const computerOperationDefinitions: ComputerOperationDefinition[] = [
  { op: "file.stat", category: "file", backendOperation: "stat", target: "path", description: "Return metadata for one scoped file or directory." },
  { op: "file.list", category: "file", backendOperation: "list_details", target: "path", description: "List directory entries with type, size, and modified time." },
  { op: "file.tree", category: "file", backendOperation: "tree", target: "path", description: "List a bounded recursive tree for codebase orientation." },
  { op: "file.read", category: "file", backendOperation: "read", target: "path", description: "Read one UTF-8 file with optional byte or line bounds." },
  { op: "file.read_many", category: "file", backendOperation: "read_many", description: "Read several UTF-8 files in one bounded scoped call." },
  { op: "file.write", category: "file", backendOperation: "write", target: "path", description: "Create or overwrite one UTF-8 file inside the scope." },
  { op: "file.create", category: "file", backendOperation: "create_file", target: "path", description: "Create one new UTF-8 file inside the scope and fail if it already exists." },
  { op: "file.patch", category: "file", backendOperation: "patch", target: "path", description: "Apply a validated unified diff inside the scope." },
  { op: "file.move", category: "file", backendOperation: "move", target: "fromPath", description: "Move or rename a scoped file or directory. Moving the configured scope root is blocked." },
  { op: "file.delete", category: "file", backendOperation: "delete", target: "path", description: "Delete a scoped file or directory. Deleting the configured scope root is blocked." },
  { op: "file.find", category: "file", backendOperation: "find_files", target: "path", description: "Find scoped file paths by pattern." },
  { op: "file.search", category: "file", backendOperation: "search_text", target: "path", description: "Search text quickly, preferring ripgrep when available." },
  { op: "code.context", category: "code", backendOperation: "coding_context", target: "path", description: "Return a bounded code-oriented workspace context." },
  { op: "code.search_symbols", category: "code", backendOperation: "search_symbols", target: "path", description: "Find common code symbols such as functions, classes, interfaces, and exports." },
  { op: "git.status", category: "git", backendOperation: "repo_status", target: "path", description: "Inspect repository status and optional bounded diff." },
  { op: "git.changes", category: "git", backendOperation: "git_changes", target: "path", description: "Return structured changed-file entries and counts." },
  { op: "git.diff", category: "git", backendOperation: "git_diff", target: "path", description: "Return a bounded staged or unstaged diff." },
  { op: "git.log", category: "git", backendOperation: "git_log", target: "path", description: "Return recent commits for a repository or pathspec." },
  { op: "git.show", category: "git", backendOperation: "git_show", target: "path", description: "Return a bounded commit or object view." },
  { op: "git.stage", category: "git", backendOperation: "git_stage", target: "path", description: "Stage scoped paths in the Git index." },
  { op: "git.unstage", category: "git", backendOperation: "git_unstage", target: "path", description: "Unstage scoped paths from the Git index." },
  { op: "git.commit", category: "git", backendOperation: "git_commit", target: "path", description: "Create a Git commit from staged scoped files." },
  { op: "package.run", category: "package", backendOperation: "package_run", target: "path", description: "Run an existing package.json script in the scope." },
  { op: "package.start", category: "package", backendOperation: "package_start", target: "path", description: "Start an existing package.json script as a managed process." },
  { op: "command.run", category: "command", backendOperation: "command", target: "workingDirectory", description: "Run one bounded shell command in the scope." },
  { op: "command.start", category: "command", backendOperation: "process_start", target: "workingDirectory", description: "Start a managed long-running shell process." },
  { op: "command.read", category: "command", backendOperation: "process_read", target: "processId", description: "Read status and buffered output for a managed process." },
  { op: "command.stop", category: "command", backendOperation: "process_stop", target: "processId", description: "Stop a managed process." },
  { op: "command.list", category: "command", backendOperation: "process_list", description: "List managed shell and Codex processes for the scope." },
  { op: "process.start", category: "process", backendOperation: "process_start", target: "workingDirectory", description: "Start a managed long-running shell process." },
  { op: "process.read", category: "process", backendOperation: "process_read", target: "processId", description: "Read status and buffered output for a managed process." },
  { op: "process.stop", category: "process", backendOperation: "process_stop", target: "processId", description: "Stop a managed process." },
  { op: "process.list", category: "process", backendOperation: "process_list", description: "List managed processes for the scope." },
  { op: "codex.run", category: "codex", backendOperation: "codex", target: "workingDirectory", description: "Run the local Codex CLI once in the scope." },
  { op: "codex.start", category: "codex", backendOperation: "codex_start", target: "workingDirectory", description: "Start a managed Codex CLI task." },
  { op: "codex.read", category: "codex", backendOperation: "codex_runs", target: "workflowId", description: "Read persisted Codex run records." },
  { op: "codex.stop", category: "codex", backendOperation: "process_stop", target: "processId", description: "Stop a managed Codex process." },
  { op: "codex.list", category: "codex", backendOperation: "codex_runs", description: "List recent persisted Codex run records." },
  { op: "history.last", category: "history", backendOperation: "history_insight", description: "Return the latest redacted operation summary." },
  { op: "history.timeline", category: "history", backendOperation: "history_insight", description: "Return a redacted operation timeline." },
  { op: "history.sessions", category: "history", backendOperation: "history_insight", description: "Return recent session summaries." },
  { op: "history.connections", category: "history", backendOperation: "history_insight", description: "Return tunnel and MCP connection summaries." },
  { op: "history.failed_replay", category: "history", backendOperation: "history_insight", description: "Return failed-operation replay templates." },
  { op: "history.debug_bundle", category: "history", backendOperation: "history_insight", description: "Export a redacted debug bundle." },
  { op: "screen.list", category: "screen", backendOperation: "screen_list", description: "List screenshot provider readiness, displays, and capturable windows/processes when available." },
  { op: "screen.capture", category: "screen", backendOperation: "screen_capture", target: "displayId", backendTarget: "path", description: "Capture the primary display or selected display when supported." },
  { op: "screen.capture_window", category: "screen", backendOperation: "screen_capture_window", target: "windowId", backendTarget: "path", description: "Capture a visible window by id when supported." },
  { op: "screen.capture_process", category: "screen", backendOperation: "screen_capture_process", target: "processIdOrName", backendTarget: "path", description: "Capture a visible window for a process id or process name when supported." },
];

export const computerOperationMap: Record<string, WorkspaceOperationName> = Object.fromEntries(
  computerOperationDefinitions.map((entry) => [entry.op, entry.backendOperation]),
) as Record<string, WorkspaceOperationName>;

const computerOperationExamples: Record<string, ComputerOperationEnvelope> = {
  "file.stat": { scope: "app", op: "file.stat", target: "README.md" },
  "file.list": { scope: "app", op: "file.list", target: "src" },
  "file.tree": { scope: "app", op: "file.tree", target: ".", options: { maxDepth: 2, maxEntries: 100 } },
  "file.read": { scope: "app", op: "file.read", target: "README.md", options: { maxBytes: 65536 } },
  "file.read_many": { scope: "app", op: "file.read_many", input: { paths: ["README.md", "package.json"] }, options: { maxBytes: 65536 } },
  "file.write": { scope: "app", op: "file.write", target: "notes/todo.md", input: { content: "- item\n" } },
  "file.create": { scope: "app", op: "file.create", target: "notes/todo.md", input: { content: "- item\n" } },
  "file.patch": { scope: "app", op: "file.patch", input: { patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n" } },
  "file.move": { scope: "app", op: "file.move", target: "old.txt", input: { toPath: "archive/old.txt" } },
  "file.delete": { scope: "app", op: "file.delete", target: "tmp/output", input: { recursive: true } },
  "file.find": { scope: "app", op: "file.find", target: ".", input: { pattern: "*.ts" }, options: { maxResults: 50 } },
  "file.search": { scope: "app", op: "file.search", target: ".", input: { query: "TODO", glob: "*.ts" }, options: { maxResults: 20 } },
  "code.context": { scope: "app", op: "code.context", target: ".", options: { maxDepth: 2, maxEntries: 100, maxBytes: 32768 } },
  "code.search_symbols": { scope: "app", op: "code.search_symbols", target: ".", input: { query: "Workspace", glob: "*.ts" }, options: { maxResults: 50 } },
  "git.status": { scope: "app", op: "git.status", target: ".", input: { includeDiff: true }, options: { maxBytes: 65536 } },
  "git.changes": { scope: "app", op: "git.changes", target: "." },
  "git.diff": { scope: "app", op: "git.diff", target: ".", input: { paths: ["src/index.ts"], staged: false }, options: { maxBytes: 65536 } },
  "git.log": { scope: "app", op: "git.log", target: ".", input: { paths: ["src/index.ts"] }, options: { maxResults: 20 } },
  "git.show": { scope: "app", op: "git.show", target: ".", input: { ref: "HEAD", paths: ["src/index.ts"] }, options: { maxBytes: 65536 } },
  "git.stage": { scope: "app", op: "git.stage", target: ".", input: { paths: ["src/index.ts", "README.md"] } },
  "git.unstage": { scope: "app", op: "git.unstage", target: ".", input: { paths: ["src/index.ts"] } },
  "git.commit": { scope: "app", op: "git.commit", target: ".", input: { message: "Implement workspace search" } },
  "package.run": { scope: "app", op: "package.run", target: ".", input: { script: "test", scriptArgs: ["--watch=false"] }, options: { timeoutSeconds: 120, maxOutputBytes: 200000 } },
  "package.start": { scope: "app", op: "package.start", target: ".", input: { script: "dev", scriptArgs: ["--host", "127.0.0.1"] }, options: { timeoutSeconds: 3600, maxOutputBytes: 200000 } },
  "command.run": { scope: "app", op: "command.run", target: ".", input: { command: "npm test" }, options: { timeoutSeconds: 600 } },
  "command.start": { scope: "app", op: "command.start", target: ".", input: { command: "npm run dev" }, options: { timeoutSeconds: 3600 } },
  "command.read": { scope: "app", op: "command.read", target: "proc_..." },
  "command.stop": { scope: "app", op: "command.stop", target: "proc_..." },
  "command.list": { scope: "app", op: "command.list" },
  "process.start": { scope: "app", op: "process.start", target: ".", input: { command: "npm run dev" }, options: { timeoutSeconds: 3600 } },
  "process.read": { scope: "app", op: "process.read", target: "proc_..." },
  "process.stop": { scope: "app", op: "process.stop", target: "proc_..." },
  "process.list": { scope: "app", op: "process.list" },
  "codex.run": { scope: "app", op: "codex.run", target: ".", input: { prompt: "Inspect this repo and summarize failing tests." }, options: { timeoutSeconds: 1800 } },
  "codex.start": { scope: "app", op: "codex.start", target: ".", input: { prompt: "Run tests and summarize failures." }, options: { timeoutSeconds: 1800 } },
  "codex.read": { scope: "app", op: "codex.read", target: "codex_fix_..." },
  "codex.stop": { scope: "app", op: "codex.stop", target: "proc_..." },
  "codex.list": { scope: "app", op: "codex.list", options: { maxResults: 10 } },
  "history.last": { scope: "app", op: "history.last" },
  "history.timeline": { scope: "app", op: "history.timeline", options: { maxResults: 50 } },
  "history.sessions": { scope: "app", op: "history.sessions", options: { maxResults: 20 } },
  "history.connections": { scope: "app", op: "history.connections", options: { maxResults: 20 } },
  "history.failed_replay": { scope: "app", op: "history.failed_replay", options: { maxResults: 20 } },
  "history.debug_bundle": { scope: "app", op: "history.debug_bundle", options: { maxResults: 100 } },
  "screen.list": { scope: "app", op: "screen.list" },
  "screen.capture": { scope: "app", op: "screen.capture", target: "primary", options: { returnMode: "base64", format: "png", maxWidth: 1280, maxHeight: 720 } },
  "screen.capture_window": { scope: "app", op: "screen.capture_window", target: "window-1", options: { returnMode: "base64", format: "png", maxWidth: 1280, maxHeight: 720 } },
  "screen.capture_process": { scope: "app", op: "screen.capture_process", target: "Terminal", options: { returnMode: "base64", format: "png", maxWidth: 1280, maxHeight: 720 } },
};

export const computerOperationContract: ComputerOperationContract = {
  version: 1,
  mcp: {
    tool: "computer_operation",
    requiredFields: ["scope", "op"],
  },
  jsonApi: {
    endpoint: "POST /api/v1/control",
    action: "computer_operation",
    requiredFields: ["action", "scope", "op"],
  },
  envelope: {
    scope: "app",
    op: "file.read",
    target: "README.md",
    input: {},
    options: { maxBytes: 65536 },
  },
  guidance: [
    "Keep the outer envelope stable: scope, op, target, input, options.",
    "Use the generic dotted op names for new clients, such as file.read, file.search, code.context, git.diff, package.run, command.run, process.start, codex.run, screen.capture, and history.last.",
    "Put operation-specific payload in input and bounds such as maxBytes, maxResults, and timeoutSeconds in options.",
    "Choose scope from get_computer_info.scopes and check the returned operation registry before write, command, or Codex operations.",
  ],
  compatibility: {
    acceptsLegacyWorkspaceOps: true,
    legacyRegistry: "operationRegistry",
  },
};

export const computerOperationRegistry: ComputerOperationRegistryEntry[] = computerOperationDefinitions.map((definition) => {
  const backend = workspaceOperationEntry(definition.backendOperation);
  const optionFields = new Set(["maxBytes", "maxOutputBytes", "maxResults", "timeoutSeconds", "maxDepth", "maxEntries", "startLine", "lineCount", "beforeContext", "afterContext", "format", "returnMode", "maxWidth", "maxHeight"]);
  const backendTarget = definition.backendTarget ?? definition.target;
  const requiredInput = backend.requiredFields.filter((field) => field !== backendTarget);
  const optionalInput = backend.optionalFields.filter((field) => field !== backendTarget && !optionFields.has(field));
  const options = backend.optionalFields.filter((field) => optionFields.has(field));
  return {
    op: definition.op,
    category: definition.category,
    permission: backend.permission,
    capabilities: backend.capabilities,
    networkAccess: backend.networkAccess,
    boundary: backend.boundary,
    description: definition.description,
    target: definition.target,
    requiredInput,
    optionalInput,
    options,
    backendOperation: definition.backendOperation,
    legacyWorkspaceOperation: definition.backendOperation,
    example: computerOperationExamples[definition.op] ?? {
      ...computerOperationContract.envelope,
      op: definition.op,
    },
  };
});

export function publicComputerOperationRegistry(): ComputerOperationRegistryEntry[] {
  return computerOperationRegistry.filter((operation) => operationSupportedByCurrentRuntime(operation));
}

function operationSupportedByCurrentRuntime(operation: ComputerOperationRegistryEntry): boolean {
  if (operation.op === "screen.list") return true;
  const screenMode = screenCaptureModeForOperation(operation.backendOperation);
  if (!screenMode) return true;
  const capability = screenshotCapability();
  return capability.supported && capability.modes.includes(screenMode);
}

function screenCaptureModeForOperation(operation: WorkspaceOperationName): ScreenshotCaptureOptions["source"] | undefined {
  if (operation === "screen_capture") return "display";
  if (operation === "screen_capture_window") return "window";
  if (operation === "screen_capture_process") return "process";
  return undefined;
}
