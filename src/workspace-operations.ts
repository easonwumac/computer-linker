import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { opendir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { errorMessage, previewCommand, readAuditEvents, writeAuditEvent, type AuditEvent, type AuditEventInput, type WorkspaceAuditReplayTemplate } from "./audit.js";
import { readCodexRunRecords, writeCodexRunRecord } from "./codex-runs.js";
import { operationCapabilityPolicy, workspaceCapabilityPolicy, type CapabilityName, type CapabilityPolicy, type NetworkAccessPolicy } from "./capability-policy.js";
import { assertPackageScriptAllowedByPolicy, commandPolicyLimits, managedCommandPolicyLimits } from "./command-policy.js";
import { historyInsightFromEvents } from "./history-insights.js";
import { operationError } from "./operation-errors.js";
import { assertPermission, type PathPermissions } from "./permissions.js";
import { executableCommand, shellCommand } from "./platform-shell.js";
import { listManagedProcesses, readManagedProcess, startManagedProcess, stopManagedProcess, type ManagedProcessSnapshot } from "./processes.js";
import { captureScreenshot, listScreenshotTargets, screenshotCapability, type ScreenshotCaptureOptions } from "./screenshot.js";
import { findFiles, searchSymbols, searchText } from "./search.js";
import { sanitizeGitPatchOutput } from "./git-output.js";
import { assertSensitivePathMutationAllowed } from "./sensitive-files.js";
import { formatWorkspacePath, WorkspaceRegistry, type Workspace } from "./workspaces.js";

export const workspaceOperationNames = [
  "stat",
  "list",
  "list_details",
  "explain_operation",
  "tree",
  "instructions",
  "agent_skills",
  "coding_context",
  "project_overview",
  "history",
  "history_insight",
  "change_summary",
  "repo_status",
  "git_changes",
  "git_diff",
  "git_log",
  "git_show",
  "git_stage",
  "git_unstage",
  "git_commit",
  "git_worktree_list",
  "git_worktree_create",
  "read",
  "read_many",
  "write",
  "create_file",
  "write_if_unchanged",
  "edit",
  "patch",
  "mkdir",
  "delete",
  "move",
  "find_files",
  "search_text",
  "search_symbols",
  "package_run",
  "package_start",
  "command",
  "process_start",
  "process_list",
  "process_read",
  "process_stop",
  "codex_start",
  "codex",
  "codex_plan",
  "codex_review",
  "codex_fix",
  "codex_test",
  "codex_continue",
  "codex_runs",
  "screen_list",
  "screen_capture",
  "screen_capture_window",
  "screen_capture_process",
  "batch",
] as const;

export type WorkspaceOperationName = typeof workspaceOperationNames[number];

export interface WorkspaceOperationCatalogEntry {
  operation: WorkspaceOperationName;
  permission: "read" | "write" | "shell" | "codex" | "screen" | "mixed";
  description: string;
  requiredFields: string[];
  optionalFields: string[];
  example: WorkspaceOperationInput;
}

export type WorkspaceOperationBoundary =
  | "workspace-path-enforced"
  | "workspace-scoped-metadata"
  | "workspace-cwd-only"
  | "mixed";

export interface WorkspaceOperationSafetyEntry {
  operation: WorkspaceOperationName;
  permission: WorkspaceOperationCatalogEntry["permission"];
  boundary: WorkspaceOperationBoundary;
  note: string;
}

export interface WorkspaceOperationSchema {
  requiredFields: string[];
  optionalFields: string[];
  example: WorkspaceOperationInput;
}

export type WorkspaceOperationRunner = (
  registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
) => Promise<unknown>;

export interface WorkspaceOperationRunRegistration {
  type: "workspace-operation-dispatch";
  handler: "runWorkspaceOperation" | "runFileSearchOperation" | "runMetadataOperation" | "runCodexOperation" | "runScreenOperation";
  execute: WorkspaceOperationRunner;
}

export interface WorkspaceOperationAuditRegistration {
  eventType: "tool_call";
  fields: "workspaceOperationAuditFields";
  redactions: string[];
}

export interface WorkspaceOperationInput {
  operation: WorkspaceOperationName;
  operationName?: string;
  path?: string;
  paths?: string[];
  content?: string;
  encoding?: string;
  createParents?: boolean;
  patch?: string;
  oldText?: string;
  newText?: string;
  fromPath?: string;
  toPath?: string;
  recursive?: boolean;
  pattern?: string;
  query?: string;
  glob?: string;
  fixedStrings?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  view?: string;
  beforeContext?: number;
  afterContext?: number;
  maxDepth?: number;
  maxEntries?: number;
  startLine?: number;
  lineCount?: number;
  includeFiles?: boolean;
  maxBytes?: number;
  includeDiff?: boolean;
  staged?: boolean;
  expectedSha256?: string;
  message?: string;
  ref?: string;
  script?: string;
  scriptArgs?: string[];
  branch?: string;
  startPoint?: string;
  command?: string;
  processId?: string;
  signal?: string;
  prompt?: string;
  workflowId?: string;
  format?: string;
  returnMode?: string;
  maxWidth?: number;
  maxHeight?: number;
  workingDirectory?: string;
  timeoutSeconds?: number;
  maxOutputBytes?: number;
  operations?: WorkspaceOperationInput[];
  continueOnError?: boolean;
}

export interface WorkspaceOperationEnvelope {
  operation?: WorkspaceOperationName;
  op?: WorkspaceOperationName;
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ProcessResult {
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export const workspaceOperationCatalog: WorkspaceOperationCatalogEntry[] = [
  {
    operation: "stat",
    permission: "read",
    description: "Return metadata for a file, directory, symlink, or other path.",
    requiredFields: [],
    optionalFields: ["path"],
    example: { operation: "stat", path: "." },
  },
  {
    operation: "list",
    permission: "read",
    description: "List names in a directory.",
    requiredFields: [],
    optionalFields: ["path"],
    example: { operation: "list", path: "src" },
  },
  {
    operation: "list_details",
    permission: "read",
    description: "List directory entries with type, size, and modified time.",
    requiredFields: [],
    optionalFields: ["path"],
    example: { operation: "list_details", path: "src" },
  },
  {
    operation: "explain_operation",
    permission: "read",
    description: "Explain whether another workspace operation is allowed here, including required permission and boundary metadata.",
    requiredFields: ["operationName"],
    optionalFields: [],
    example: { operation: "explain_operation", operationName: "package_start" },
  },
  {
    operation: "tree",
    permission: "read",
    description: "List a bounded recursive tree for quickly understanding workspace structure.",
    requiredFields: [],
    optionalFields: ["path", "maxDepth", "maxEntries", "includeFiles"],
    example: { operation: "tree", path: ".", maxDepth: 2, maxEntries: 100, includeFiles: true },
  },
  {
    operation: "instructions",
    permission: "read",
    description: "Read AGENTS.md and CLAUDE.md instruction files from the workspace root to the target path.",
    requiredFields: [],
    optionalFields: ["path", "maxBytes"],
    example: { operation: "instructions", path: "src/api.ts", maxBytes: 65536 },
  },
  {
    operation: "agent_skills",
    permission: "read",
    description: "Discover workspace-scoped agent skills from .codex/skills, .claude/skills, and skills directories.",
    requiredFields: [],
    optionalFields: ["maxResults", "maxBytes"],
    example: { operation: "agent_skills", maxResults: 50, maxBytes: 32768 },
  },
  {
    operation: "coding_context",
    permission: "read",
    description: "Return the initial coding context for a workspace in one call: overview, instructions, skills, tree, and change summary.",
    requiredFields: [],
    optionalFields: ["path", "maxDepth", "maxEntries", "maxBytes", "maxResults"],
    example: { operation: "coding_context", path: ".", maxDepth: 2, maxEntries: 100, maxBytes: 32768, maxResults: 10 },
  },
  {
    operation: "project_overview",
    permission: "read",
    description: "Return a coding-oriented project overview with manifests, package scripts, language hints, instruction files, and suggested next operations.",
    requiredFields: [],
    optionalFields: ["path", "maxDepth", "maxEntries"],
    example: { operation: "project_overview", path: ".", maxDepth: 3, maxEntries: 300 },
  },
  {
    operation: "history",
    permission: "read",
    description: "Return recent audit events for this opened workspace, including tool calls, failures, commands, and paths.",
    requiredFields: [],
    optionalFields: ["maxResults", "query"],
    example: { operation: "history", maxResults: 50, query: "test" },
  },
  {
    operation: "history_insight",
    permission: "read",
    description: "Return an agent-friendly last-operation view, summary, timeline, session/connection summaries, failed replay templates, or redacted debug bundle for this workspace.",
    requiredFields: [],
    optionalFields: ["view", "maxResults", "query"],
    example: { operation: "history_insight", view: "last", maxResults: 50, query: "test" },
  },
  {
    operation: "change_summary",
    permission: "read",
    description: "Return a compact coding change summary with Git branch, counts, changed files, and diff stats without shell permission.",
    requiredFields: [],
    optionalFields: ["path", "maxBytes"],
    example: { operation: "change_summary", path: ".", maxBytes: 65536 },
  },
  {
    operation: "repo_status",
    permission: "read",
    description: "Return git status and optional diff information for the workspace without requiring shell permission.",
    requiredFields: [],
    optionalFields: ["path", "includeDiff", "maxBytes"],
    example: { operation: "repo_status", path: ".", includeDiff: true, maxBytes: 65536 },
  },
  {
    operation: "git_changes",
    permission: "read",
    description: "Return structured Git change entries for staged, unstaged, untracked, ignored, and renamed files.",
    requiredFields: [],
    optionalFields: ["path"],
    example: { operation: "git_changes", path: "." },
  },
  {
    operation: "git_diff",
    permission: "read",
    description: "Return a bounded Git diff for the repository or selected workspace paths without shell permission.",
    requiredFields: [],
    optionalFields: ["path", "paths", "staged", "maxBytes"],
    example: { operation: "git_diff", path: ".", paths: ["src/app.ts"], staged: false, maxBytes: 65536 },
  },
  {
    operation: "git_log",
    permission: "read",
    description: "Return recent Git commits for the repository or selected workspace paths without shell permission.",
    requiredFields: [],
    optionalFields: ["path", "paths", "maxResults"],
    example: { operation: "git_log", path: ".", paths: ["src/app.ts"], maxResults: 20 },
  },
  {
    operation: "git_show",
    permission: "read",
    description: "Return a bounded Git commit or object view, optionally limited to selected workspace paths, without shell permission.",
    requiredFields: [],
    optionalFields: ["path", "ref", "paths", "maxBytes"],
    example: { operation: "git_show", path: ".", ref: "HEAD", paths: ["src/app.ts"], maxBytes: 65536 },
  },
  {
    operation: "git_stage",
    permission: "write",
    description: "Stage selected workspace paths in Git without shell permission.",
    requiredFields: ["paths"],
    optionalFields: ["path"],
    example: { operation: "git_stage", path: ".", paths: ["src/app.ts", "README.md"] },
  },
  {
    operation: "git_unstage",
    permission: "write",
    description: "Unstage selected workspace paths in Git without shell permission.",
    requiredFields: ["paths"],
    optionalFields: ["path"],
    example: { operation: "git_unstage", path: ".", paths: ["src/app.ts"] },
  },
  {
    operation: "git_commit",
    permission: "write",
    description: "Create a Git commit from currently staged files after verifying every staged path is inside the workspace.",
    requiredFields: ["message"],
    optionalFields: ["path"],
    example: { operation: "git_commit", path: ".", message: "Implement workspace search" },
  },
  {
    operation: "git_worktree_list",
    permission: "read",
    description: "List Git worktrees for a repository path inside the workspace.",
    requiredFields: [],
    optionalFields: ["path"],
    example: { operation: "git_worktree_list", path: "." },
  },
  {
    operation: "git_worktree_create",
    permission: "write",
    description: "Create an isolated Git worktree at a workspace-bounded target path. This runs git directly without shell expansion.",
    requiredFields: ["toPath"],
    optionalFields: ["path", "branch", "startPoint"],
    example: { operation: "git_worktree_create", path: ".", toPath: ".localport/worktrees/feature-a", branch: "feature-a", startPoint: "HEAD" },
  },
  {
    operation: "read",
    permission: "read",
    description: "Read a UTF-8 file by default, or return bounded base64 bytes when encoding=base64 is explicit.",
    requiredFields: ["path"],
    optionalFields: ["startLine", "lineCount", "maxBytes", "encoding"],
    example: { operation: "read", path: "README.md", startLine: 1, lineCount: 80, maxBytes: 65536, encoding: "utf8" },
  },
  {
    operation: "read_many",
    permission: "read",
    description: "Read multiple UTF-8 files by default, or return bounded base64 bytes when encoding=base64 is explicit.",
    requiredFields: ["paths"],
    optionalFields: ["maxBytes", "encoding"],
    example: { operation: "read_many", paths: ["README.md", "src/index.ts"], maxBytes: 65536, encoding: "utf8" },
  },
  {
    operation: "write",
    permission: "write",
    description: "Create or overwrite a UTF-8 file. Missing parent directories require createParents=true.",
    requiredFields: ["path", "content"],
    optionalFields: ["createParents"],
    example: { operation: "write", path: "notes/todo.md", content: "- item\n", createParents: true },
  },
  {
    operation: "create_file",
    permission: "write",
    description: "Create a new UTF-8 file and fail if the path already exists. Missing parent directories require createParents=true.",
    requiredFields: ["path", "content"],
    optionalFields: ["createParents"],
    example: { operation: "create_file", path: "notes/todo.md", content: "- item\n", createParents: true },
  },
  {
    operation: "write_if_unchanged",
    permission: "write",
    description: "Overwrite a UTF-8 file only if its current full-file sha256 still matches the expected value from a prior read.",
    requiredFields: ["path", "content", "expectedSha256"],
    optionalFields: [],
    example: { operation: "write_if_unchanged", path: "README.md", content: "new content\n", expectedSha256: "..." },
  },
  {
    operation: "edit",
    permission: "write",
    description: "Replace exactly one matching text block in a UTF-8 file.",
    requiredFields: ["path", "oldText", "newText"],
    optionalFields: [],
    example: { operation: "edit", path: "README.md", oldText: "old", newText: "new" },
  },
  {
    operation: "patch",
    permission: "write",
    description: "Apply a unified diff inside the workspace after validating that every touched path stays in bounds.",
    requiredFields: ["patch"],
    optionalFields: [],
    example: { operation: "patch", patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n" },
  },
  {
    operation: "mkdir",
    permission: "write",
    description: "Create a directory and parents if needed.",
    requiredFields: ["path"],
    optionalFields: [],
    example: { operation: "mkdir", path: "tmp/output" },
  },
  {
    operation: "delete",
    permission: "write",
    description: "Delete a file or directory. The workspace root itself cannot be deleted.",
    requiredFields: ["path"],
    optionalFields: ["recursive"],
    example: { operation: "delete", path: "tmp/output", recursive: true },
  },
  {
    operation: "move",
    permission: "write",
    description: "Move or rename a file or directory inside the workspace. The workspace root itself cannot be moved.",
    requiredFields: ["fromPath", "toPath"],
    optionalFields: [],
    example: { operation: "move", fromPath: "old.txt", toPath: "archive/old.txt" },
  },
  {
    operation: "find_files",
    permission: "read",
    description: "Find file paths quickly using ripgrep when available.",
    requiredFields: [],
    optionalFields: ["path", "pattern", "maxResults"],
    example: { operation: "find_files", path: ".", pattern: "*.ts", maxResults: 50 },
  },
  {
    operation: "search_text",
    permission: "read",
    description: "Search text quickly using ripgrep when available.",
    requiredFields: ["query"],
    optionalFields: ["path", "glob", "fixedStrings", "caseSensitive", "beforeContext", "afterContext", "maxResults"],
    example: { operation: "search_text", path: ".", query: "Computer Linker", glob: "*.ts", beforeContext: 1, afterContext: 2 },
  },
  {
    operation: "search_symbols",
    permission: "read",
    description: "Search common code symbols such as functions, classes, interfaces, types, and enums inside the workspace.",
    requiredFields: [],
    optionalFields: ["path", "query", "glob", "caseSensitive", "maxResults", "maxBytes"],
    example: { operation: "search_symbols", path: ".", query: "Workspace", glob: "*.ts", maxResults: 50 },
  },
  {
    operation: "package_run",
    permission: "shell",
    description: "Run an existing package.json script from the nearest workspace package root after checking package-script and command policy.",
    requiredFields: ["script"],
    optionalFields: ["path", "scriptArgs", "timeoutSeconds", "maxOutputBytes"],
    example: { operation: "package_run", path: ".", script: "test", scriptArgs: ["--watch=false"], timeoutSeconds: 120, maxOutputBytes: 200000 },
  },
  {
    operation: "package_start",
    permission: "shell",
    description: "Start an existing package.json script as a managed process after checking package-script and command policy.",
    requiredFields: ["script"],
    optionalFields: ["path", "scriptArgs", "timeoutSeconds", "maxOutputBytes"],
    example: { operation: "package_start", path: ".", script: "dev", scriptArgs: ["--host", "127.0.0.1"], timeoutSeconds: 3600, maxOutputBytes: 200000 },
  },
  {
    operation: "command",
    permission: "shell",
    description: "Run a shell command in the workspace or a subdirectory. Non-zero exits return stdout/stderr instead of hiding diagnostic output.",
    requiredFields: ["command"],
    optionalFields: ["workingDirectory", "timeoutSeconds", "maxOutputBytes"],
    example: { operation: "command", command: "npm test", workingDirectory: ".", timeoutSeconds: 120, maxOutputBytes: 200000 },
  },
  {
    operation: "process_start",
    permission: "shell",
    description: "Start a long-running shell process in the workspace, such as a dev server or watch task.",
    requiredFields: ["command"],
    optionalFields: ["workingDirectory", "timeoutSeconds", "maxOutputBytes"],
    example: { operation: "process_start", command: "npm run dev", workingDirectory: ".", timeoutSeconds: 3600, maxOutputBytes: 200000 },
  },
  {
    operation: "process_list",
    permission: "shell",
    description: "List background processes started for this configured workspace.",
    requiredFields: [],
    optionalFields: [],
    example: { operation: "process_list" },
  },
  {
    operation: "process_read",
    permission: "shell",
    description: "Read status and buffered stdout/stderr for a workspace background process.",
    requiredFields: ["processId"],
    optionalFields: [],
    example: { operation: "process_read", processId: "proc_..." },
  },
  {
    operation: "process_stop",
    permission: "shell",
    description: "Stop a workspace background process with SIGTERM by default.",
    requiredFields: ["processId"],
    optionalFields: ["signal"],
    example: { operation: "process_stop", processId: "proc_...", signal: "SIGTERM" },
  },
  {
    operation: "codex_start",
    permission: "codex",
    description: "Start a managed background codex exec task in the workspace. Use process_read and process_stop to inspect or stop it.",
    requiredFields: ["prompt"],
    optionalFields: ["workingDirectory", "timeoutSeconds", "maxOutputBytes"],
    example: { operation: "codex_start", prompt: "Run the tests and summarize failures.", workingDirectory: ".", timeoutSeconds: 1800, maxOutputBytes: 200000 },
  },
  {
    operation: "codex",
    permission: "codex",
    description: "Invoke the local codex CLI in the workspace or a subdirectory. Non-zero exits return stdout/stderr for diagnosis.",
    requiredFields: ["prompt"],
    optionalFields: ["workingDirectory", "timeoutSeconds", "maxOutputBytes"],
    example: { operation: "codex", prompt: "Inspect this repo and summarize failing tests.", workingDirectory: ".", timeoutSeconds: 1800, maxOutputBytes: 200000 },
  },
  {
    operation: "codex_plan",
    permission: "codex",
    description: "Run a Codex planning workflow with project context, current changes, and explicit no-edit planning instructions.",
    requiredFields: ["prompt"],
    optionalFields: ["workingDirectory", "timeoutSeconds", "maxBytes", "maxOutputBytes"],
    example: { operation: "codex_plan", prompt: "Plan the refactor needed to add typed operations.", workingDirectory: ".", timeoutSeconds: 1800, maxOutputBytes: 200000 },
  },
  {
    operation: "codex_review",
    permission: "codex",
    description: "Run a Codex review workflow focused on bugs, regressions, security risks, and missing tests.",
    requiredFields: [],
    optionalFields: ["prompt", "workingDirectory", "timeoutSeconds", "maxBytes", "maxOutputBytes"],
    example: { operation: "codex_review", prompt: "Review the current diff before release.", workingDirectory: ".", timeoutSeconds: 1800, maxOutputBytes: 200000 },
  },
  {
    operation: "codex_fix",
    permission: "codex",
    description: "Run a Codex fix workflow for a user-described issue, asking Codex to edit code and summarize the resulting diff.",
    requiredFields: ["prompt"],
    optionalFields: ["workingDirectory", "timeoutSeconds", "maxBytes", "maxOutputBytes"],
    example: { operation: "codex_fix", prompt: "Fix the failing API test and keep the public contract stable.", workingDirectory: ".", timeoutSeconds: 1800, maxOutputBytes: 200000 },
  },
  {
    operation: "codex_test",
    permission: "codex",
    description: "Run a Codex test workflow that asks Codex to run or reason about the appropriate tests and report failures with next steps.",
    requiredFields: [],
    optionalFields: ["prompt", "script", "workingDirectory", "timeoutSeconds", "maxBytes", "maxOutputBytes"],
    example: { operation: "codex_test", script: "test", prompt: "Verify the workspace operation changes.", workingDirectory: ".", timeoutSeconds: 1800, maxOutputBytes: 200000 },
  },
  {
    operation: "codex_continue",
    permission: "codex",
    description: "Run a Codex continuation workflow using recent Computer Linker history and optional user guidance.",
    requiredFields: [],
    optionalFields: ["prompt", "workflowId", "workingDirectory", "timeoutSeconds", "maxResults", "maxBytes", "maxOutputBytes"],
    example: { operation: "codex_continue", workflowId: "codex_fix_...", prompt: "Continue from the latest failing test.", workingDirectory: ".", maxResults: 50, maxOutputBytes: 200000 },
  },
  {
    operation: "codex_runs",
    permission: "codex",
    description: "List recent persisted Codex workflow run records for this workspace, or inspect one workflow id with bounded stdout/stderr previews and change summaries.",
    requiredFields: [],
    optionalFields: ["workflowId", "maxResults"],
    example: { operation: "codex_runs", workflowId: "codex_fix_...", maxResults: 10 },
  },
  {
    operation: "screen_list",
    permission: "screen",
    description: "List screenshot provider readiness, displays, and capturable windows/processes when available.",
    requiredFields: [],
    optionalFields: [],
    example: { operation: "screen_list" },
  },
  {
    operation: "screen_capture",
    permission: "screen",
    description: "Capture the primary display or selected display when the platform provider supports it.",
    requiredFields: [],
    optionalFields: ["path", "format", "returnMode", "maxWidth", "maxHeight"],
    example: { operation: "screen_capture", path: "primary", format: "png", returnMode: "base64", maxWidth: 1280, maxHeight: 720 },
  },
  {
    operation: "screen_capture_window",
    permission: "screen",
    description: "Capture a specific visible window when the platform provider supports it.",
    requiredFields: ["path"],
    optionalFields: ["format", "returnMode", "maxWidth", "maxHeight"],
    example: { operation: "screen_capture_window", path: "12345", format: "png", returnMode: "base64", maxWidth: 1280, maxHeight: 720 },
  },
  {
    operation: "screen_capture_process",
    permission: "screen",
    description: "Capture a visible window for a process id or process name when the platform provider supports it.",
    requiredFields: ["path"],
    optionalFields: ["format", "returnMode", "maxWidth", "maxHeight"],
    example: { operation: "screen_capture_process", path: "Terminal", format: "png", returnMode: "base64", maxWidth: 1280, maxHeight: 720 },
  },
  {
    operation: "batch",
    permission: "mixed",
    description: "Run up to 25 workspace operations in order. Batch is non-atomic: each child keeps its own permission check and side effects from earlier successful items remain even if a later item fails.",
    requiredFields: ["operations"],
    optionalFields: ["continueOnError"],
    example: {
      operation: "batch",
      operations: [
        { operation: "project_overview", path: "." },
        { operation: "read_many", paths: ["README.md", "package.json"], maxBytes: 32768 },
        { operation: "search_text", query: "TODO", glob: "*.ts", maxResults: 20 },
      ],
      continueOnError: true,
    },
  },
];

export const workspaceOperationSafety: WorkspaceOperationSafetyEntry[] = workspaceOperationCatalog.map((entry) => ({
  operation: entry.operation,
  permission: entry.permission,
  boundary: operationBoundary(entry.operation),
  note: operationBoundaryNote(entry.operation),
}));

export type WorkspaceOperationCategory = "metadata" | "files" | "search" | "coding" | "git" | "package" | "process" | "codex" | "screen" | "batch";

export interface WorkspaceOperationRegistryEntry extends WorkspaceOperationCatalogEntry {
  name: WorkspaceOperationName;
  category: WorkspaceOperationCategory;
  boundary: WorkspaceOperationBoundary;
  schema: WorkspaceOperationSchema;
  run: WorkspaceOperationRunRegistration;
  audit: WorkspaceOperationAuditRegistration;
  safetyNote: string;
  capabilities: CapabilityName[];
  networkAccess: NetworkAccessPolicy;
  limits?: Partial<CapabilityPolicy["limits"]>;
}

export interface PublicWorkspaceOperationRunRegistration {
  type: WorkspaceOperationRunRegistration["type"];
  handler: WorkspaceOperationRunRegistration["handler"];
}

export type PublicWorkspaceOperationRegistryEntry = Omit<WorkspaceOperationRegistryEntry, "run"> & {
  run: PublicWorkspaceOperationRunRegistration;
};

export interface UnavailableWorkspaceOperation {
  operation: WorkspaceOperationName;
  allowedByPolicy: true;
  availableNow: false;
  reason: "provider_unavailable" | "runtime_mode_unavailable";
  detail: string;
  provider?: string;
  requiredMode?: string;
  availableModes?: string[];
  action: string;
}

export interface WorkspaceOperationContract {
  version: 1;
  mcp: {
    tool: "workspace_operation";
    requiredFields: ["workspaceId", "op"];
  };
  jsonApi: {
    endpoint: "POST /api/v1/control";
    action: "operation";
    requiredFields: ["action", "workspace", "op"];
  };
  envelope: {
    workspace: string;
    op: WorkspaceOperationName;
    target?: string;
    input: Record<string, unknown>;
    options: Record<string, unknown>;
  };
  targetMapping: Record<string, string>;
  guidance: string[];
}

export interface WorkspaceOperationRegistrationInput {
  name: WorkspaceOperationName;
  category: WorkspaceOperationCategory;
  permission: WorkspaceOperationCatalogEntry["permission"];
  boundary: WorkspaceOperationBoundary;
  schema: WorkspaceOperationSchema;
  run: WorkspaceOperationRunRegistration;
  audit: WorkspaceOperationAuditRegistration;
  description: string;
  safetyNote: string;
  capabilities: CapabilityName[];
  networkAccess: NetworkAccessPolicy;
  limits?: Partial<CapabilityPolicy["limits"]>;
}

export function registerOperation(input: WorkspaceOperationRegistrationInput): WorkspaceOperationRegistryEntry {
  return {
    operation: input.name,
    name: input.name,
    permission: input.permission,
    description: input.description,
    requiredFields: input.schema.requiredFields,
    optionalFields: input.schema.optionalFields,
    example: input.schema.example,
    category: input.category,
    boundary: input.boundary,
    schema: input.schema,
    run: input.run,
    audit: input.audit,
    safetyNote: input.safetyNote,
    capabilities: input.capabilities,
    networkAccess: input.networkAccess,
    limits: input.limits,
  };
}

export function buildWorkspaceOperationRegistry(
  catalog: readonly WorkspaceOperationCatalogEntry[] = workspaceOperationCatalog,
): WorkspaceOperationRegistryEntry[] {
  assertOperationCatalogCoverage(catalog);
  return catalog.map((entry) => {
    const safety = workspaceOperationSafety.find((item) => item.operation === entry.operation);
    if (!safety) throw new Error(`Missing safety metadata for operation: ${entry.operation}`);
    const policy = operationCapabilityPolicy(entry.operation);
    return registerOperation({
      name: entry.operation,
      category: operationCategory(entry.operation),
      permission: entry.permission,
      boundary: safety.boundary,
      schema: {
        requiredFields: entry.requiredFields,
        optionalFields: entry.optionalFields,
        example: entry.example,
      },
      run: operationRunRegistration(entry.operation),
      audit: {
        eventType: "tool_call",
        fields: "workspaceOperationAuditFields",
        redactions: [
          "file contents",
          "write payloads",
          "patch bodies",
          "screenshot pixels",
          "owner tokens",
          "OAuth tokens",
        ],
      },
      description: entry.description,
      safetyNote: safety.note,
      capabilities: policy.capabilities,
      networkAccess: policy.networkAccess,
      limits: policy.limits,
    });
  });
}

export const workspaceOperationRegistry: WorkspaceOperationRegistryEntry[] = buildWorkspaceOperationRegistry();

export function publicWorkspaceOperationRegistry(
  registry: readonly WorkspaceOperationRegistryEntry[] = workspaceOperationRegistry,
): PublicWorkspaceOperationRegistryEntry[] {
  return registry.filter((entry) => operationSupportedByCurrentRuntime(entry.operation)).map(({ run, ...entry }) => ({
    ...entry,
    run: {
      type: run.type,
      handler: run.handler,
    },
  }));
}

export const workspaceOperationContract: WorkspaceOperationContract = {
  version: 1,
  mcp: {
    tool: "workspace_operation",
    requiredFields: ["workspaceId", "op"],
  },
  jsonApi: {
    endpoint: "POST /api/v1/control",
    action: "operation",
    requiredFields: ["action", "workspace", "op"],
  },
  envelope: {
    workspace: "app",
    op: "read",
    target: "README.md",
    input: {},
    options: { maxBytes: 65536 },
  },
  targetMapping: {
    default: "path",
    command: "workingDirectory",
    process_start: "workingDirectory",
    process_read: "processId",
    process_stop: "processId",
    codex: "workingDirectory",
    codex_start: "workingDirectory",
    codex_plan: "workingDirectory",
    codex_review: "workingDirectory",
    codex_fix: "workingDirectory",
    codex_test: "workingDirectory",
    codex_continue: "workingDirectory",
    codex_runs: "workflowId",
    screen_capture: "displayId",
    screen_capture_window: "windowId",
    screen_capture_process: "processIdOrName",
    explain_operation: "operationName",
    git_worktree_create: "toPath",
    move: "fromPath",
  },
  guidance: [
    "Keep the outer envelope stable: workspace/workspaceId, op, target, input, options.",
    "Put operation-specific payload fields in input and bounded controls such as maxBytes, maxResults, maxOutputBytes, and timeoutSeconds in options.",
    "Check allowedOperations or operation_registry before write, package, process, shell, Git write, or Codex operations.",
    "Use op=coding_context first for coding tasks, then search_text/search_symbols before reading many files.",
  ],
};

function assertOperationCatalogCoverage(catalog: readonly WorkspaceOperationCatalogEntry[]): void {
  const knownOperations = new Set<string>(workspaceOperationNames);
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (!knownOperations.has(entry.operation)) {
      throw new Error(`Unknown operation registered in catalog: ${entry.operation}`);
    }
    if (seen.has(entry.operation)) {
      throw new Error(`Duplicate operation registered in catalog: ${entry.operation}`);
    }
    seen.add(entry.operation);
  }

  const missing = workspaceOperationNames.filter((operation) => !seen.has(operation));
  if (missing.length > 0) {
    throw new Error(`Missing registered operations: ${missing.join(", ")}`);
  }
}

export const workspaceOperationRegistryByName = new Map<WorkspaceOperationName, WorkspaceOperationRegistryEntry>(
  workspaceOperationRegistry.map((entry) => [entry.operation, entry]),
);

export function workspaceOperationEntry(operation: WorkspaceOperationName): WorkspaceOperationRegistryEntry {
  const entry = workspaceOperationRegistryByName.get(operation);
  if (!entry) throw new Error(`Unknown operation: ${operation}`);
  return entry;
}

function operationRunRegistration(operation: WorkspaceOperationName): WorkspaceOperationRunRegistration {
  if (isFileSearchOperation(operation)) {
    return {
      type: "workspace-operation-dispatch",
      handler: "runFileSearchOperation",
      execute: runFileSearchOperation,
    };
  }
  if (isMetadataOperation(operation)) {
    return {
      type: "workspace-operation-dispatch",
      handler: "runMetadataOperation",
      execute: runMetadataOperation,
    };
  }
  if (isCodexOperation(operation)) {
    return {
      type: "workspace-operation-dispatch",
      handler: "runCodexOperation",
      execute: runCodexOperation,
    };
  }
  if (isScreenOperation(operation)) {
    return {
      type: "workspace-operation-dispatch",
      handler: "runScreenOperation",
      execute: runScreenOperation,
    };
  }
  return {
    type: "workspace-operation-dispatch",
    handler: "runWorkspaceOperation",
    execute: dispatchWorkspaceOperation,
  };
}

function isCodexOperation(operation: WorkspaceOperationName): boolean {
  return isCodexExecutionOperation(operation) || operation === "codex_runs";
}

function isMetadataOperation(operation: WorkspaceOperationName): boolean {
  return operation === "explain_operation" ||
    operation === "history" ||
    operation === "history_insight";
}

function isFileSearchOperation(operation: WorkspaceOperationName): boolean {
  return operation === "stat" ||
    operation === "list" ||
    operation === "list_details" ||
    operation === "tree" ||
    operation === "read" ||
    operation === "read_many" ||
    operation === "write" ||
    operation === "create_file" ||
    operation === "write_if_unchanged" ||
    operation === "edit" ||
    operation === "mkdir" ||
    operation === "delete" ||
    operation === "move" ||
    operation === "find_files" ||
    operation === "search_text" ||
    operation === "search_symbols";
}

function isScreenOperation(operation: WorkspaceOperationName): boolean {
  return operation === "screen_list" ||
    operation === "screen_capture" ||
    operation === "screen_capture_window" ||
    operation === "screen_capture_process";
}

export function allowedWorkspaceOperations(permissions: PathPermissions): WorkspaceOperationName[] {
  const policy = workspaceCapabilityPolicy(permissions);
  return workspaceOperationRegistry
    .filter((entry) => (
      operationAllowedByLegacyPermission(entry, permissions) &&
      operationAllowedByCapabilityPolicy(entry, policy) &&
      operationSupportedByCurrentRuntime(entry.operation)
    ))
    .map((entry) => entry.operation);
}

export function unavailableWorkspaceOperations(permissions: PathPermissions): UnavailableWorkspaceOperation[] {
  const policy = workspaceCapabilityPolicy(permissions);
  return workspaceOperationRegistry
    .filter((entry) => (
      operationAllowedByLegacyPermission(entry, permissions) &&
      operationAllowedByCapabilityPolicy(entry, policy)
    ))
    .map((entry) => unavailableOperationForCurrentRuntime(entry.operation))
    .filter((entry): entry is UnavailableWorkspaceOperation => Boolean(entry));
}

function operationSupportedByCurrentRuntime(operation: WorkspaceOperationName): boolean {
  if (operation === "screen_list") return true;
  const screenMode = screenCaptureModeForOperation(operation);
  if (!screenMode) return true;
  const capability = screenshotCapability();
  return capability.supported && capability.modes.includes(screenMode);
}

function unavailableOperationForCurrentRuntime(operation: WorkspaceOperationName): UnavailableWorkspaceOperation | undefined {
  const screenMode = screenCaptureModeForOperation(operation);
  if (!screenMode) return undefined;

  const capability = screenshotCapability();
  if (!capability.supported) {
    return {
      operation,
      allowedByPolicy: true,
      availableNow: false,
      reason: "provider_unavailable",
      detail: capability.permission.detail ?? `Screenshot provider ${capability.provider} is unavailable.`,
      provider: capability.provider,
      requiredMode: screenMode,
      availableModes: capability.modes,
      action: "Install or enable a screenshot provider for this platform, then retry discovery.",
    };
  }
  if (!capability.modes.includes(screenMode)) {
    return {
      operation,
      allowedByPolicy: true,
      availableNow: false,
      reason: "runtime_mode_unavailable",
      detail: `Screenshot provider ${capability.provider} does not support ${screenMode} capture.`,
      provider: capability.provider,
      requiredMode: screenMode,
      availableModes: capability.modes,
      action: `Use one of the available screenshot modes (${capability.modes.join(", ") || "none"}) or install a provider that supports ${screenMode} capture.`,
    };
  }
  return undefined;
}

function screenCaptureModeForOperation(operation: WorkspaceOperationName): ScreenshotCaptureOptions["source"] | undefined {
  if (operation === "screen_capture") return "display";
  if (operation === "screen_capture_window") return "window";
  if (operation === "screen_capture_process") return "process";
  return undefined;
}

function operationAllowedByLegacyPermission(entry: WorkspaceOperationRegistryEntry, permissions: PathPermissions): boolean {
  return entry.permission === "mixed"
    ? permissions.read || permissions.write || permissions.shell || permissions.codex || Boolean(permissions.screen)
    : Boolean(permissions[entry.permission]);
}

function operationAllowedByCapabilityPolicy(entry: WorkspaceOperationRegistryEntry, policy: CapabilityPolicy): boolean {
  const capabilities = new Set(policy.capabilities);
  return missingCapabilities(entry, capabilities).length === 0;
}

function missingCapabilities(entry: WorkspaceOperationRegistryEntry, capabilities: Set<CapabilityName>): CapabilityName[] {
  return entry.capabilities.filter((capability) => !capabilities.has(capability));
}

export function normalizeWorkspaceOperationInput(body: Record<string, unknown>): WorkspaceOperationInput {
  const operation = operationNameFrom(body.operation ?? body.op);
  const input = objectValue(body.input);
  const options = objectValue(body.options);
  const merged: Record<string, unknown> = {
    ...options,
    ...input,
    ...body,
    operation,
  };

  delete merged.op;
  delete merged.target;
  delete merged.input;
  delete merged.options;

  applyTarget(operation, body.target, merged);

  return {
    operation,
    operationName: optionalString(merged.operationName),
    path: optionalString(merged.path),
    paths: optionalStringArray(merged.paths),
    content: typeof merged.content === "string" ? merged.content : undefined,
    encoding: optionalString(merged.encoding),
    createParents: optionalBoolean(merged.createParents),
    patch: typeof merged.patch === "string" ? merged.patch : undefined,
    oldText: typeof merged.oldText === "string" ? merged.oldText : undefined,
    newText: typeof merged.newText === "string" ? merged.newText : undefined,
    fromPath: optionalString(merged.fromPath),
    toPath: optionalString(merged.toPath),
    recursive: optionalBoolean(merged.recursive),
    pattern: optionalString(merged.pattern),
    query: optionalString(merged.query),
    glob: optionalString(merged.glob),
    fixedStrings: optionalBoolean(merged.fixedStrings),
    caseSensitive: optionalBoolean(merged.caseSensitive),
    maxResults: optionalPositiveInteger(merged.maxResults),
    view: optionalString(merged.view),
    beforeContext: optionalBoundedNonNegativeInteger(merged.beforeContext, 20),
    afterContext: optionalBoundedNonNegativeInteger(merged.afterContext, 20),
    maxDepth: optionalPositiveInteger(merged.maxDepth),
    maxEntries: optionalPositiveInteger(merged.maxEntries),
    startLine: optionalPositiveInteger(merged.startLine),
    lineCount: optionalBoundedPositiveInteger(merged.lineCount, 10000),
    includeFiles: optionalBoolean(merged.includeFiles),
    maxBytes: optionalBoundedPositiveInteger(merged.maxBytes, 256 * 1024),
    includeDiff: optionalBoolean(merged.includeDiff),
    staged: optionalBoolean(merged.staged),
    expectedSha256: optionalString(merged.expectedSha256),
    message: optionalString(merged.message),
    ref: optionalString(merged.ref),
    script: optionalString(merged.script),
    scriptArgs: optionalStringArray(merged.scriptArgs),
    branch: optionalString(merged.branch),
    startPoint: optionalString(merged.startPoint),
    command: optionalString(merged.command),
    processId: optionalString(merged.processId),
    signal: optionalString(merged.signal),
    prompt: optionalString(merged.prompt),
    workflowId: optionalString(merged.workflowId),
    format: optionalString(merged.format),
    returnMode: optionalString(merged.returnMode ?? merged.return),
    maxWidth: optionalPositiveInteger(merged.maxWidth),
    maxHeight: optionalPositiveInteger(merged.maxHeight),
    workingDirectory: optionalString(merged.workingDirectory),
    timeoutSeconds: optionalPositiveInteger(merged.timeoutSeconds),
    maxOutputBytes: optionalBoundedPositiveInteger(merged.maxOutputBytes, 10 * 1024 * 1024),
    operations: optionalOperationArray(merged.operations),
    continueOnError: optionalBoolean(merged.continueOnError),
  };
}

function operationNameFrom(value: unknown): WorkspaceOperationName {
  const operation = optionalString(value);
  if (!operation) {
    throw operationError("invalid_request", "operation is required for this operation");
  }
  if (!workspaceOperationNames.includes(operation as WorkspaceOperationName)) {
    throw operationError("unknown_operation", `operation must be one of: ${workspaceOperationNames.join(", ")}`);
  }
  return operation as WorkspaceOperationName;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function applyTarget(operation: WorkspaceOperationName, target: unknown, merged: Record<string, unknown>): void {
  const value = optionalString(target);
  if (!value) return;
  if (operation === "process_read" || operation === "process_stop") {
    merged.processId ??= value;
    return;
  }
  if (operation === "codex_runs") {
    merged.workflowId ??= value;
    return;
  }
  if (operation === "explain_operation") {
    merged.operationName ??= value;
    return;
  }
  if (operation === "command" || operation === "process_start" || isCodexExecutionOperation(operation)) {
    merged.workingDirectory ??= value;
    return;
  }
  if (operation === "git_worktree_create") {
    merged.toPath ??= value;
    return;
  }
  if (operation === "move") {
    merged.fromPath ??= value;
    return;
  }
  merged.path ??= value;
}

function operationCategory(operation: WorkspaceOperationName): WorkspaceOperationRegistryEntry["category"] {
  if (operation === "batch") return "batch";
  if (isCodexExecutionOperation(operation) || operation === "codex_runs") return "codex";
  if (operation === "command" || operation === "package_run" || operation === "package_start") return "package";
  if (operation === "process_start" || operation === "process_list" || operation === "process_read" || operation === "process_stop") return "process";
  if (operation.startsWith("git_") || operation === "repo_status" || operation === "change_summary") return "git";
  if (operation === "screen_list" || operation === "screen_capture" || operation === "screen_capture_window" || operation === "screen_capture_process") return "screen";
  if (operation === "find_files" || operation === "search_text" || operation === "search_symbols") return "search";
  if (operation === "instructions" || operation === "agent_skills" || operation === "coding_context" || operation === "project_overview") return "coding";
  if (operation === "history" || operation === "history_insight" || operation === "explain_operation") return "metadata";
  return "files";
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

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(optionalString).filter((item): item is string => Boolean(item));
  return values.length ? values.slice(0, 100) : undefined;
}

function optionalOperationArray(value: unknown): WorkspaceOperationInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const operations = value
    .filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === "object" && !Array.isArray(operation))
    .slice(0, 25)
    .map(normalizeWorkspaceOperationInput);
  return operations.length ? operations : undefined;
}

function operationBoundary(operation: WorkspaceOperationName): WorkspaceOperationBoundary {
  if (operation === "batch") return "mixed";
  if (operation === "history" || operation === "history_insight" || operation === "coding_context" || operation === "project_overview" || operation === "instructions" || operation === "agent_skills" || operation === "process_list" || operation === "process_read" || operation === "process_stop" || operation === "codex_runs" || operation === "screen_list") {
    return "workspace-scoped-metadata";
  }
  if (operation === "command" || operation === "package_run" || operation === "package_start" || operation === "process_start" || isCodexExecutionOperation(operation) || operation === "screen_capture" || operation === "screen_capture_window" || operation === "screen_capture_process") {
    return "workspace-cwd-only";
  }
  return "workspace-path-enforced";
}

function operationBoundaryNote(operation: WorkspaceOperationName): string {
  if (operation === "batch") return "Each child operation keeps its own permission and boundary behavior.";
  if (operation === "command" || operation === "package_run" || operation === "package_start" || operation === "process_start") return "The process starts in the workspace, but local package scripts and shell commands are not filesystem sandboxes.";
  if (isCodexExecutionOperation(operation)) return "Codex starts in the workspace, but Codex and tools it invokes may access broader OS resources.";
  if (operation === "codex_runs") return "Returns bounded Codex workflow run records for this configured workspace without full prompts.";
  if (operation === "screen_list") return "Returns screenshot provider capability and permission metadata without capturing pixels.";
  if (operation === "screen_capture" || operation === "screen_capture_window" || operation === "screen_capture_process") return "Captures local screen pixels through the platform provider and is gated by explicit screen permission.";
  if (operation === "process_list" || operation === "process_read" || operation === "process_stop") return "Managed-process access is limited to allowed process kinds Computer Linker started for this configured workspace.";
  if (operation === "history" || operation === "history_insight") return "Returns audit metadata for this workspace without file contents or token values.";
  if (operation === "coding_context" || operation === "project_overview" || operation === "instructions" || operation === "agent_skills") return "Reads bounded workspace metadata and selected workspace files only.";
  if (operation === "git_stage" || operation === "git_unstage") return "Git pathspecs are validated inside the workspace before mutating the repository index.";
  if (operation === "git_commit") return "Staged Git paths are checked against the workspace before creating a commit.";
  return "All filesystem paths are resolved and validated inside the opened workspace before execution.";
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

function allowedProcessKinds(workspace: Workspace): ManagedProcessSnapshot["kind"][] {
  const kinds: ManagedProcessSnapshot["kind"][] = [];
  if (workspace.exposedPath.permissions.shell) kinds.push("shell");
  if (workspace.exposedPath.permissions.codex) kinds.push("codex");
  if (kinds.length === 0) {
    throw operationError("permission_denied", `shell or codex permission is required for managed processes on exposed path ${workspace.exposedPath.id} (${workspace.exposedPath.path})`);
  }
  return kinds;
}

function explainOperation(workspace: Workspace, operationName: string): Record<string, unknown> {
  if (!workspaceOperationNames.includes(operationName as WorkspaceOperationName)) {
    throw operationError("unknown_operation", `operationName must be one of: ${workspaceOperationNames.join(", ")}`);
  }
  const operation = operationName as WorkspaceOperationName;
  const registryEntry = workspaceOperationEntry(operation);
  const capabilityPolicy = workspaceCapabilityPolicy(workspace.exposedPath.permissions);
  const missingCapabilityList = missingCapabilities(registryEntry, new Set(capabilityPolicy.capabilities));
  const safety = {
    operation: registryEntry.operation,
    permission: registryEntry.permission,
    boundary: registryEntry.boundary,
    note: registryEntry.safetyNote,
  };
  const allowed = allowedWorkspaceOperations(workspace.exposedPath.permissions).includes(operation);
  const requiredPermission = registryEntry.permission;
  const missingPermission = requiredPermission === "mixed"
    ? undefined
    : workspace.exposedPath.permissions[requiredPermission] ? undefined : requiredPermission;

  return {
    operation,
    allowed,
    requiredPermission,
    missingPermission,
    workspace: {
      id: workspace.exposedPath.id,
      name: workspace.exposedPath.name,
      permissions: workspace.exposedPath.permissions,
      capabilityPolicy,
    },
    requiredCapabilities: registryEntry.capabilities,
    missingCapabilities: missingCapabilityList,
    networkAccess: registryEntry.networkAccess,
    catalog: registryEntry,
    registry: registryEntry,
    safety,
  };
}

export async function runWorkspaceOperation(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  return workspaceOperationEntry(input.operation).run.execute(registry, workspace, input);
}

async function runMetadataOperation(
  _registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  switch (input.operation) {
    case "explain_operation": {
      return explainOperation(workspace, required(input.operationName, "operationName"));
    }
    case "history": {
      return {
        events: workspaceHistory(workspace, {
          maxResults: input.maxResults,
          query: input.query,
        }),
      };
    }
    case "history_insight": {
      return workspaceHistoryInsight(workspace, {
        view: input.view,
        maxResults: input.maxResults,
        query: input.query,
      });
    }
    default:
      throw operationError("unknown_operation", `runMetadataOperation cannot execute operation: ${input.operation}`);
  }
}

async function runFileSearchOperation(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  switch (input.operation) {
    case "stat": {
      return { entry: await registry.statPath(workspace.id, input.path ?? ".") };
    }
    case "list": {
      return { entries: await registry.listDirectory(workspace.id, input.path ?? ".") };
    }
    case "list_details": {
      return { entries: await registry.listDirectoryEntries(workspace.id, input.path ?? ".") };
    }
    case "tree": {
      return {
        entries: await registry.tree(workspace.id, input.path ?? ".", {
          maxDepth: input.maxDepth,
          maxEntries: input.maxEntries,
          includeFiles: input.includeFiles,
        }),
      };
    }
    case "read": {
      const path = required(input.path, "path");
      return {
        path,
        ...readResult(await registry.readFileBytes(workspace.id, path), {
          startLine: input.startLine,
          lineCount: input.lineCount,
          maxBytes: input.maxBytes,
          encoding: input.encoding,
        }),
      };
    }
    case "read_many": {
      const maxBytes = normalizeBoundedPositiveInteger(input.maxBytes, 64 * 1024, 256 * 1024);
      return {
        files: await Promise.all(requiredPaths(input.paths).map(async (path) => {
          return {
            path,
            ...readResult(await registry.readFileBytes(workspace.id, path), {
              maxBytes,
              encoding: input.encoding,
            }),
          };
        })),
      };
    }
    case "write": {
      const path = required(input.path, "path");
      await registry.writeFile(workspace.id, path, requiredRaw(input.content, "content"), {
        createParents: input.createParents ?? false,
      });
      return { path };
    }
    case "create_file": {
      const path = required(input.path, "path");
      const content = requiredRaw(input.content, "content");
      await registry.createFile(workspace.id, path, content, {
        createParents: input.createParents ?? false,
      });
      return {
        path,
        created: true,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        sha256: sha256(content),
      };
    }
    case "write_if_unchanged": {
      const path = required(input.path, "path");
      const content = requiredRaw(input.content, "content");
      const expectedSha256 = required(input.expectedSha256, "expectedSha256").toLowerCase();
      const current = await registry.readFileForMutationCheck(workspace.id, path);
      const currentSha256 = sha256(current);
      if (currentSha256 !== expectedSha256) {
        return {
          path,
          written: false,
          currentSha256,
          expectedSha256,
          conflict: true,
        };
      }
      await registry.writeFile(workspace.id, path, content);
      return {
        path,
        written: true,
        previousSha256: currentSha256,
        sha256: sha256(content),
        conflict: false,
      };
    }
    case "edit": {
      return {
        replacements: await registry.editFile(
          workspace.id,
          required(input.path, "path"),
          requiredRaw(input.oldText, "oldText"),
          requiredRaw(input.newText, "newText"),
        ),
      };
    }
    case "mkdir": {
      const path = required(input.path, "path");
      await registry.createDirectory(workspace.id, path);
      return { path };
    }
    case "delete": {
      const path = required(input.path, "path");
      await registry.deletePath(workspace.id, path, Boolean(input.recursive));
      return { path };
    }
    case "move": {
      const fromPath = required(input.fromPath, "fromPath");
      const toPath = required(input.toPath, "toPath");
      await registry.movePath(workspace.id, fromPath, toPath);
      return { fromPath, toPath };
    }
    case "find_files": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return {
        matches: splitSearchOutput(await findFiles({
          cwd,
          pattern: input.pattern ?? "**/*",
          maxResults: normalizeMaxResults(input.maxResults),
        })),
      };
    }
    case "search_text": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return {
        matches: splitSearchOutput(await searchText({
          cwd,
          query: required(input.query, "query"),
          glob: input.glob,
          fixedStrings: input.fixedStrings ?? true,
          caseSensitive: input.caseSensitive ?? false,
          beforeContext: input.beforeContext,
          afterContext: input.afterContext,
          maxResults: normalizeMaxResults(input.maxResults),
        })),
      };
    }
    case "search_symbols": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return {
        symbols: await searchSymbols({
          cwd,
          query: input.query,
          glob: input.glob,
          caseSensitive: input.caseSensitive ?? false,
          maxResults: normalizeMaxResults(input.maxResults),
          maxBytes: normalizeBoundedPositiveInteger(input.maxBytes, 256 * 1024, 1024 * 1024),
        }),
      };
    }
    default:
      throw operationError("unknown_operation", `runFileSearchOperation cannot execute operation: ${input.operation}`);
  }
}

async function runCodexOperation(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  switch (input.operation) {
    case "codex_start": {
      assertPermission(workspace.exposedPath, "codex");
      const cwd = await registry.resolveExistingPath(workspace, input.workingDirectory ?? ".");
      const prompt = required(input.prompt, "prompt");
      const limits = managedCommandPolicyLimits(workspace.exposedPath.policy, "codex exec -", input);
      return {
        process: startManagedProcess({
          kind: "codex",
          workspaceId: workspace.exposedPath.id,
          workspaceRoot: workspace.root,
          cwd,
          command: "codex",
          args: ["exec", "-"],
          commandPreview: `codex exec -: ${previewCommand(prompt)}`,
          timeoutMs: limits.timeoutMs,
          maxOutputBytes: limits.maxOutputBytes,
          stdin: prompt,
        }),
      };
    }
    case "codex": {
      assertPermission(workspace.exposedPath, "codex");
      const cwd = await registry.resolveExistingPath(workspace, input.workingDirectory ?? ".");
      const limits = commandPolicyLimits(workspace.exposedPath.policy, "codex exec -", input, 1800);
      return runProcess("codex", ["exec", "-"], cwd, limits.timeoutMs, required(input.prompt, "prompt"), limits.maxOutputBytes);
    }
    case "codex_plan":
    case "codex_review":
    case "codex_fix":
    case "codex_test":
    case "codex_continue": {
      assertPermission(workspace.exposedPath, "codex");
      const cwd = await registry.resolveExistingPath(workspace, input.workingDirectory ?? ".");
      return codexWorkflow(workspace, cwd, input);
    }
    case "codex_runs": {
      assertPermission(workspace.exposedPath, "codex");
      return {
        runs: readCodexRunRecords({
          workspaceId: workspace.exposedPath.id,
          workflowId: input.workflowId,
          maxResults: input.maxResults,
        }),
      };
    }
    default:
      throw operationError("unknown_operation", `runCodexOperation cannot execute operation: ${input.operation}`);
  }
}

async function runScreenOperation(
  _registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  switch (input.operation) {
    case "screen_list": {
      assertPermission(workspace.exposedPath, "screen");
      return listScreenshotTargets();
    }
    case "screen_capture": {
      assertPermission(workspace.exposedPath, "screen");
      return captureScreenshot({
        source: "display",
        target: input.path,
        format: input.format,
        returnMode: input.returnMode,
        maxWidth: input.maxWidth,
        maxHeight: input.maxHeight,
      });
    }
    case "screen_capture_window": {
      assertPermission(workspace.exposedPath, "screen");
      return captureScreenshot({
        source: "window",
        target: required(input.path, "path"),
        format: input.format,
        returnMode: input.returnMode,
        maxWidth: input.maxWidth,
        maxHeight: input.maxHeight,
      });
    }
    case "screen_capture_process": {
      assertPermission(workspace.exposedPath, "screen");
      return captureScreenshot({
        source: "process",
        target: required(input.path, "path"),
        format: input.format,
        returnMode: input.returnMode,
        maxWidth: input.maxWidth,
        maxHeight: input.maxHeight,
      });
    }
    default:
      throw operationError("unknown_operation", `runScreenOperation cannot execute operation: ${input.operation}`);
  }
}

async function dispatchWorkspaceOperation(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  switch (input.operation) {
    case "instructions": {
      return {
        files: await registry.instructions(workspace.id, input.path ?? ".", {
          maxBytes: input.maxBytes,
        }),
      };
    }
    case "agent_skills": {
      assertPermission(workspace.exposedPath, "read");
      return agentSkills(registry, workspace, {
        maxResults: input.maxResults,
        maxBytes: input.maxBytes,
      });
    }
    case "coding_context": {
      assertPermission(workspace.exposedPath, "read");
      return codingContext(registry, workspace, {
        path: input.path ?? ".",
        maxDepth: input.maxDepth,
        maxEntries: input.maxEntries,
        maxBytes: input.maxBytes,
        maxResults: input.maxResults,
      });
    }
    case "project_overview": {
      assertPermission(workspace.exposedPath, "read");
      return projectOverview(registry, workspace, {
        path: input.path ?? ".",
        maxDepth: input.maxDepth,
        maxEntries: input.maxEntries,
      });
    }
    case "change_summary": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return changeSummary(cwd, { maxBytes: input.maxBytes });
    }
    case "repo_status": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return repoStatus(cwd, {
        includeDiff: input.includeDiff ?? true,
        maxBytes: input.maxBytes,
      });
    }
    case "git_changes": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return gitChanges(cwd);
    }
    case "git_diff": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      const paths = await validateGitPathspecs(registry, workspace, cwd, input.paths);
      return gitDiff(cwd, {
        paths: paths.map((path) => path.inputPath),
        pathspecs: paths.map((path) => path.gitPathspec),
        staged: input.staged ?? false,
        maxBytes: input.maxBytes,
      });
    }
    case "git_log": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      const paths = await validateGitPathspecs(registry, workspace, cwd, input.paths);
      return gitLog(cwd, {
        paths: paths.map((path) => path.inputPath),
        pathspecs: paths.map((path) => path.gitPathspec),
        maxResults: input.maxResults,
      });
    }
    case "git_show": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      const paths = await validateGitPathspecs(registry, workspace, cwd, input.paths);
      return gitShow(cwd, {
        ref: input.ref,
        paths: paths.map((path) => path.inputPath),
        pathspecs: paths.map((path) => path.gitPathspec),
        maxBytes: input.maxBytes,
      });
    }
    case "git_stage": {
      assertPermission(workspace.exposedPath, "write");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      const paths = requireGitPathspecs(await validateGitPathspecs(registry, workspace, cwd, input.paths));
      return gitIndexUpdate(cwd, {
        action: "stage",
        commandArgs: ["add", "--"],
        paths: paths.map((path) => path.inputPath),
        pathspecs: paths.map((path) => path.gitPathspec),
      });
    }
    case "git_unstage": {
      assertPermission(workspace.exposedPath, "write");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      const paths = requireGitPathspecs(await validateGitPathspecs(registry, workspace, cwd, input.paths));
      return gitIndexUpdate(cwd, {
        action: "unstage",
        commandArgs: ["restore", "--staged", "--"],
        paths: paths.map((path) => path.inputPath),
        pathspecs: paths.map((path) => path.gitPathspec),
      });
    }
    case "git_commit": {
      assertPermission(workspace.exposedPath, "write");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return gitCommit(workspace, cwd, required(input.message, "message"));
    }
    case "git_worktree_list": {
      assertPermission(workspace.exposedPath, "read");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return gitWorktreeList(cwd);
    }
    case "git_worktree_create": {
      assertPermission(workspace.exposedPath, "write");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      const target = await registry.resolveWritablePath(workspace, required(input.toPath, "toPath"));
      return gitWorktreeCreate(cwd, target, {
        branch: input.branch,
        startPoint: input.startPoint,
        targetPath: formatWorkspacePath(target, workspace),
      });
    }
    case "patch": {
      assertPermission(workspace.exposedPath, "write");
      const patch = requiredRaw(input.patch, "patch");
      await validatePatchPaths(registry, workspace, patch);
      const check = await runProcess("git", ["apply", "--check", "-"], workspace.root, 30_000, patch);
      if (check.exitCode !== 0) {
        return { applied: false, check };
      }
      const apply = await runProcess("git", ["apply", "-"], workspace.root, 30_000, patch);
      return { applied: apply.exitCode === 0, check, apply };
    }
    case "package_run": {
      assertPermission(workspace.exposedPath, "shell");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return packageRun(registry, workspace, cwd, {
        script: required(input.script, "script"),
        scriptArgs: input.scriptArgs,
        timeoutSeconds: input.timeoutSeconds,
        maxOutputBytes: input.maxOutputBytes,
      });
    }
    case "package_start": {
      assertPermission(workspace.exposedPath, "shell");
      const cwd = await registry.resolveExistingPath(workspace, input.path ?? ".");
      return packageStart(registry, workspace, cwd, {
        script: required(input.script, "script"),
        scriptArgs: input.scriptArgs,
        timeoutSeconds: input.timeoutSeconds,
        maxOutputBytes: input.maxOutputBytes,
      });
    }
    case "command": {
      assertPermission(workspace.exposedPath, "shell");
      const cwd = await registry.resolveExistingPath(workspace, input.workingDirectory ?? ".");
      const command = required(input.command, "command");
      const limits = commandPolicyLimits(workspace.exposedPath.policy, command, input, 120);
      const shell = shellCommand(command);
      return runProcess(shell.command, shell.args, cwd, limits.timeoutMs, undefined, limits.maxOutputBytes);
    }
    case "process_start": {
      assertPermission(workspace.exposedPath, "shell");
      const cwd = await registry.resolveExistingPath(workspace, input.workingDirectory ?? ".");
      const command = required(input.command, "command");
      const limits = managedCommandPolicyLimits(workspace.exposedPath.policy, command, input);
      return {
        process: startManagedProcess({
          kind: "shell",
          workspaceId: workspace.exposedPath.id,
          workspaceRoot: workspace.root,
          cwd,
          command,
          commandPreview: previewCommand(command),
          timeoutMs: limits.timeoutMs,
          maxOutputBytes: limits.maxOutputBytes,
        }),
      };
    }
    case "process_list": {
      const kinds = allowedProcessKinds(workspace);
      return {
        processes: listManagedProcesses({
          workspaceId: workspace.exposedPath.id,
          workspaceRoot: workspace.root,
          kinds,
        }),
      };
    }
    case "process_read": {
      const kinds = allowedProcessKinds(workspace);
      return {
        process: readManagedProcess({
          processId: required(input.processId, "processId"),
          workspaceId: workspace.exposedPath.id,
          workspaceRoot: workspace.root,
          kinds,
        }),
      };
    }
    case "process_stop": {
      const kinds = allowedProcessKinds(workspace);
      return {
        process: await stopManagedProcess({
          processId: required(input.processId, "processId"),
          workspaceId: workspace.exposedPath.id,
          workspaceRoot: workspace.root,
          signal: input.signal,
          kinds,
        }),
      };
    }
    case "batch": {
      const operations = requiredOperations(input.operations);
      const results = [];
      let stoppedOnError = false;
      for (const [index, operation] of operations.entries()) {
        if (operation.operation === "batch") {
          writeBatchItemAudit(workspace, index, operation, false, 0, "nested batch operations are not supported");
          const result = {
            index,
            operation: operation.operation,
            ok: false,
            error: "nested batch operations are not supported",
          };
          results.push(result);
          if (!input.continueOnError) {
            stoppedOnError = index < operations.length - 1;
            break;
          }
          continue;
        }

        const startedAt = performance.now();
        try {
          const data = await runWorkspaceOperation(registry, workspace, operation);
          writeBatchItemAudit(workspace, index, operation, true, Math.round(performance.now() - startedAt));
          results.push({
            index,
            operation: operation.operation,
            ok: true,
            data,
          });
        } catch (error) {
          writeBatchItemAudit(workspace, index, operation, false, Math.round(performance.now() - startedAt), errorMessage(error));
          results.push({
            index,
            operation: operation.operation,
            ok: false,
            error: errorMessage(error),
          });
          if (!input.continueOnError) {
            stoppedOnError = index < operations.length - 1;
            break;
          }
        }
      }
      const failed = results.filter((result) => !result.ok).length;
      return {
        results,
        completed: results.length === operations.length && failed === 0,
        attempted: results.length,
        succeeded: results.length - failed,
        failed,
        stoppedOnError,
        continueOnError: Boolean(input.continueOnError),
        nonAtomic: true,
        sideEffects: "ordered-non-atomic",
        retryGuidance: "Batch is not atomic. Earlier successful child operations may have committed side effects; inspect results before replaying only the needed operations.",
      };
    }
  }
}

export function workspaceOperationAuditFields(input: WorkspaceOperationInput): Partial<AuditEventInput> {
  return {
    operation: input.operation,
    target: auditTarget(input),
    path: input.path ?? input.fromPath,
    workingDirectory: input.workingDirectory,
    commandPreview: input.command ? previewCommand(input.command) : input.prompt ? previewCommand(input.prompt) : undefined,
    replay: workspaceOperationReplayTemplate(input),
    detail: input.operation === "process_read" || input.operation === "process_stop"
      ? input.processId
      : input.operation === "move"
      ? input.toPath
      : input.operation === "git_worktree_create"
      ? input.toPath
      : input.operation === "git_stage" || input.operation === "git_unstage"
      ? input.paths?.join(",")
      : input.operation === "git_commit"
      ? input.message ? previewCommand(input.message) : "message"
      : input.operation === "write_if_unchanged"
      ? "expectedSha256"
      : input.operation === "find_files"
        ? input.pattern
      : input.operation === "search_text"
          ? input.glob ?? input.query
      : input.operation === "search_symbols"
          ? input.glob ?? input.query
      : input.operation === "package_run" || input.operation === "package_start"
        ? input.script
      : input.operation === "batch"
            ? input.operations?.map((operation) => operation.operation).join(",")
      : input.operation === "codex_runs"
            ? input.workflowId
      : input.operation === "screen_capture" || input.operation === "screen_capture_window" || input.operation === "screen_capture_process"
            ? input.path
          : input.operation,
  };
}

function workspaceOperationReplayTemplate(input: WorkspaceOperationInput): WorkspaceAuditReplayTemplate {
  const target = auditTarget(input);
  const baseInput: WorkspaceAuditReplayTemplate["input"] = {
    op: input.operation,
    target,
    input: {},
    options: {},
  };

  switch (input.operation) {
    case "stat":
    case "list":
    case "list_details":
    case "instructions":
    case "change_summary":
    case "repo_status":
    case "git_changes":
    case "git_worktree_list":
    case "read":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          startLine: input.startLine,
          lineCount: input.lineCount,
          encoding: input.encoding,
          includeDiff: input.includeDiff,
          maxBytes: input.maxBytes,
        },
      });
    case "read_many":
      return replayableTemplate(baseInput, {
        input: {
          paths: input.paths,
          encoding: input.encoding,
          maxBytes: input.maxBytes,
        },
      });
    case "tree":
    case "coding_context":
    case "project_overview":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          maxDepth: input.maxDepth,
          maxEntries: input.maxEntries,
          includeFiles: input.includeFiles,
          maxBytes: input.maxBytes,
          maxResults: input.maxResults,
        },
      });
    case "history":
    case "history_insight":
      return replayableTemplate(baseInput, {
        input: {
          view: input.view,
          query: input.query,
          maxResults: input.maxResults,
        },
      });
    case "write":
    case "create_file":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          createParents: input.createParents,
        },
      }, {
        replayable: false,
        reason: "File write contents are not stored in the audit log; provide content before replaying.",
        requiresInput: ["content"],
      });
    case "write_if_unchanged":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          expectedSha256: input.expectedSha256,
        },
      }, {
        replayable: false,
        reason: "File write contents are not stored in the audit log; provide content before replaying.",
        requiresInput: ["content"],
      });
    case "edit":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
        },
      }, {
        replayable: false,
        reason: "Edit replacement text is not stored in the audit log; provide oldText and newText before replaying.",
        requiresInput: ["oldText", "newText"],
      });
    case "patch":
      return replayableTemplate(baseInput, {
        input: {},
      }, {
        replayable: false,
        reason: "Patch bodies are not stored in the audit log; provide patch before replaying.",
        requiresInput: ["patch"],
      });
    case "mkdir":
    case "delete":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          recursive: input.recursive,
        },
      });
    case "move":
      return replayableTemplate(baseInput, {
        input: {
          fromPath: input.fromPath,
          toPath: input.toPath,
        },
      });
    case "find_files":
      return replayableTemplate(baseInput, {
        input: {
          pattern: input.pattern,
          maxResults: input.maxResults,
        },
      });
    case "search_text":
    case "search_symbols":
      return replayableTemplate(baseInput, {
        input: {
          query: input.query,
          glob: input.glob,
          fixedStrings: input.fixedStrings,
          caseSensitive: input.caseSensitive,
          beforeContext: input.beforeContext,
          afterContext: input.afterContext,
          maxResults: input.maxResults,
        },
      });
    case "package_run":
    case "package_start":
      return replayableTemplate(baseInput, {
        input: {
          script: input.script,
          scriptArgs: input.scriptArgs,
          workingDirectory: input.workingDirectory,
          timeoutSeconds: input.timeoutSeconds,
          maxBytes: input.maxBytes,
        },
      });
    case "process_read":
    case "process_stop":
      return replayableTemplate(baseInput, {
        input: {
          processId: input.processId,
          signal: input.signal,
          maxBytes: input.maxBytes,
        },
      });
    case "git_diff":
    case "git_log":
    case "git_show":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          paths: input.paths,
          ref: input.ref,
          staged: input.staged,
          maxResults: input.maxResults,
          maxBytes: input.maxBytes,
        },
      });
    case "git_stage":
    case "git_unstage":
      return replayableTemplate(baseInput, {
        input: {
          paths: input.paths,
        },
      });
    case "git_commit":
      return replayableTemplate(baseInput, {
        input: {
          message: input.message ? previewCommand(input.message) : undefined,
        },
      }, {
        replayable: false,
        reason: "Git commit messages are stored only as a preview; provide the full message before replaying.",
        requiresInput: ["message"],
      });
    case "git_worktree_create":
      return replayableTemplate(baseInput, {
        input: {
          toPath: input.toPath,
          branch: input.branch,
          startPoint: input.startPoint,
        },
      });
    case "process_list":
      return replayableTemplate(baseInput, {
        input: {},
      });
    case "command":
    case "process_start":
      return replayableTemplate(baseInput, {
        input: {
          workingDirectory: input.workingDirectory,
          timeoutSeconds: input.timeoutSeconds,
          maxBytes: input.maxBytes,
        },
      }, {
        replayable: false,
        reason: "Raw shell commands are not stored in the audit log; provide command before replaying.",
        requiresInput: ["command"],
      });
    case "codex":
    case "codex_start":
    case "codex_plan":
    case "codex_review":
    case "codex_fix":
    case "codex_test":
    case "codex_continue":
      return replayableTemplate(baseInput, {
        input: {
          workflowId: input.workflowId,
          script: input.script,
          workingDirectory: input.workingDirectory,
          timeoutSeconds: input.timeoutSeconds,
          maxBytes: input.maxBytes,
        },
      }, {
        replayable: false,
        reason: "Codex prompts are not stored in the audit log; provide prompt before replaying.",
        requiresInput: ["prompt"],
      });
    case "codex_runs":
      return replayableTemplate(baseInput, {
        input: {
          workflowId: input.workflowId,
          maxResults: input.maxResults,
        },
      });
    case "screen_list":
      return replayableTemplate(baseInput, {
        input: {},
      });
    case "screen_capture":
    case "screen_capture_window":
    case "screen_capture_process":
      return replayableTemplate(baseInput, {
        input: {
          path: input.path,
          format: input.format,
          returnMode: input.returnMode,
          maxWidth: input.maxWidth,
          maxHeight: input.maxHeight,
        },
      }, {
        replayable: false,
        reason: "Screenshot captures can expose current screen pixels; request a fresh explicit capture instead of replaying from history.",
        requiresInput: ["screen-capture-confirmation"],
      });
    case "batch":
      return replayableTemplate(baseInput, {
        input: {},
      }, {
        replayable: false,
        reason: "Batch is ordered and non-atomic, so earlier successful child operations may have already committed side effects. Child payloads are not stored in the audit log; provide explicit operations and user confirmation before replaying.",
        requiresInput: ["operations", "userConfirmation"],
      });
    default:
      return replayableTemplate(baseInput, {
        input: {},
      });
  }
}

function replayableTemplate(
  baseInput: WorkspaceAuditReplayTemplate["input"],
  values: { input?: Record<string, unknown>; options?: Record<string, unknown> },
  metadata: Pick<WorkspaceAuditReplayTemplate, "replayable" | "reason" | "requiresInput"> = { replayable: true },
): WorkspaceAuditReplayTemplate {
  return {
    action: "workspace_operation",
    replayable: metadata.replayable,
    reason: metadata.reason,
    requiresInput: metadata.requiresInput,
    input: {
      op: baseInput.op,
      target: baseInput.target,
      input: cleanReplayObject(values.input ?? {}),
      options: cleanReplayObject(values.options ?? {}),
    },
  };
}

function cleanReplayObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function writeBatchItemAudit(
  workspace: Workspace,
  index: number,
  operation: WorkspaceOperationInput,
  success: boolean,
  durationMs: number,
  error?: string,
): void {
  writeAuditEvent({
    type: "tool_call",
    tool: "workspace_operation.batch_item",
    success,
    durationMs,
    workspaceId: workspace.exposedPath.id,
    workspaceRoot: workspace.root,
    ...workspaceOperationAuditFields(operation),
    detail: `batch[${index}]: ${operation.operation}`,
    error,
  });
}

function required(value: string | undefined, name: string): string {
  const text = value?.trim();
  if (!text) throw operationError("invalid_request", `${name} is required for this operation`);
  return text;
}

function requiredRaw(value: string | undefined, name: string): string {
  if (!value) throw operationError("invalid_request", `${name} is required for this operation`);
  return value;
}

function requiredPaths(value: string[] | undefined): string[] {
  if (!value || value.length === 0) {
    throw operationError("invalid_request", "paths is required for this operation");
  }
  if (value.length > 100) {
    throw operationError("invalid_request", "paths supports at most 100 files per call");
  }
  return value.map((path) => required(path, "paths[]"));
}

function requiredOperations(value: WorkspaceOperationInput[] | undefined): WorkspaceOperationInput[] {
  if (!value || value.length === 0) {
    throw operationError("invalid_request", "operations is required for this operation");
  }
  if (value.length > 25) {
    throw operationError("invalid_request", "batch supports at most 25 operations per call");
  }
  for (const [index, operation] of value.entries()) {
    if (!workspaceOperationNames.includes(operation.operation)) {
      throw operationError("unknown_operation", `operations[${index}].operation must be one of: ${workspaceOperationNames.join(", ")}`);
    }
  }
  return value;
}

function readResult(
  bytes: Buffer,
  options: { startLine?: number; lineCount?: number; maxBytes?: number; encoding?: string },
): {
  content: string;
  encoding: "utf8" | "base64";
  sizeBytes: number;
  sha256: string;
  truncated: boolean;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
} {
  const encoding = normalizeReadEncoding(options.encoding);
  const sizeBytes = bytes.length;
  const startLine = normalizeOptionalPositiveInteger(options.startLine);
  const lineCount = normalizeOptionalPositiveInteger(options.lineCount);
  const maxBytes = options.maxBytes === undefined ? undefined : normalizeBoundedPositiveInteger(options.maxBytes, sizeBytes, 256 * 1024);

  if (encoding === "base64") {
    if (startLine || lineCount) {
      throw operationError("invalid_request", "startLine and lineCount are only supported for UTF-8 file reads");
    }
    const selectedBytes = maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes);
    return {
      content: selectedBytes.toString("base64"),
      encoding,
      sizeBytes,
      sha256: sha256(bytes),
      truncated: selectedBytes.length < bytes.length,
    };
  }

  const content = decodeUtf8ReadBytes(bytes);
  let selected = content;
  let endLine: number | undefined;
  let totalLines: number | undefined;

  if (startLine || lineCount) {
    const lines = content.split(/\r?\n/);
    totalLines = lines.length;
    const startIndex = Math.max(0, (startLine ?? 1) - 1);
    const endIndex = lineCount ? startIndex + lineCount : lines.length;
    selected = lines.slice(startIndex, endIndex).join("\n");
    endLine = Math.min(lines.length, endIndex);
  }

  const truncatedContent = maxBytes === undefined ? selected : truncateText(selected, maxBytes);
  return {
    content: truncatedContent,
    encoding,
    sizeBytes,
    sha256: sha256(bytes),
    truncated: truncatedContent !== selected,
    startLine: startLine ?? undefined,
    endLine,
    totalLines,
  };
}

function normalizeReadEncoding(value: string | undefined): "utf8" | "base64" {
  const encoding = (value ?? "utf8").toLowerCase();
  if (encoding === "utf8" || encoding === "utf-8") return "utf8";
  if (encoding === "base64") return "base64";
  throw operationError("invalid_request", "encoding must be one of: utf8, base64");
}

function decodeUtf8ReadBytes(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw operationError(
      "invalid_request",
      "File is not valid UTF-8 text. Use encoding=base64 for binary reads.",
      { cause: error },
    );
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value && value > 0 ? value : undefined;
}

function normalizeMaxResults(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 1000) : 200;
}

function normalizeTimeoutMs(value: number | undefined, defaultSeconds: number): number {
  const seconds = Number.isInteger(value) && value && value > 0 ? Math.min(value, 3600) : defaultSeconds;
  return seconds * 1000;
}

function workspaceHistory(
  workspace: Workspace,
  options: { maxResults?: number; query?: string },
): AuditEvent[] {
  const events = readAuditEvents({
    query: options.query,
  }).filter((event) => (
    event.workspaceId === workspace.id ||
    event.workspaceId === workspace.exposedPath.id ||
    event.workspaceRef === workspace.exposedPath.id ||
    event.workspaceRef === workspace.exposedPath.name ||
    event.workspaceRef === workspace.exposedPath.path ||
    event.workspaceRoot === workspace.root
  ));

  return events.slice(0, normalizeMaxResults(options.maxResults));
}

function workspaceHistoryInsight(
  workspace: Workspace,
  options: { view?: string; maxResults?: number; query?: string },
): unknown {
  const events = workspaceHistory(workspace, {
    maxResults: options.maxResults,
    query: options.query,
  });
  return historyInsightFromEvents(events, {
    view: options.view,
    limit: normalizeMaxResults(options.maxResults),
    query: options.query,
    workspaceId: workspace.exposedPath.id,
  });
}

type CodexWorkflowOperationName = Extract<WorkspaceOperationName, "codex_plan" | "codex_review" | "codex_fix" | "codex_test" | "codex_continue">;

async function codexWorkflow(
  workspace: Workspace,
  cwd: string,
  input: WorkspaceOperationInput,
): Promise<unknown> {
  if (!isCodexWorkflowOperation(input.operation)) {
    throw operationError("unknown_operation", `Unsupported Codex workflow: ${input.operation}`);
  }

  const maxBytes = normalizeBoundedPositiveInteger(input.maxBytes, 64 * 1024, 256 * 1024);
  const preRunChangeSummary = await changeSummary(cwd, { maxBytes });
  const history = input.operation === "codex_continue"
    ? historyInsightFromEvents(workspaceHistory(workspace, { maxResults: input.maxResults ?? 50 }), {
        view: "debug_bundle",
        limit: normalizeMaxResults(input.maxResults ?? 50),
        workspaceId: workspace.exposedPath.id,
      })
    : undefined;
  const workflowId = input.workflowId ?? codexWorkflowId(input.operation, workspace.exposedPath.id, input.prompt);
  const workflowPrompt = buildCodexWorkflowPrompt(input.operation, {
    userPrompt: codexWorkflowUserPrompt(input),
    script: input.script,
    workflowId,
    workspace,
    workingDirectory: formatWorkspacePath(cwd, workspace),
    preRunChangeSummary,
    history,
  });
  const limits = commandPolicyLimits(workspace.exposedPath.policy, "codex exec -", input, 1800);
  const result = await runProcess("codex", ["exec", "-"], cwd, limits.timeoutMs, workflowPrompt, limits.maxOutputBytes);
  const postRunChangeSummary = await changeSummary(cwd, { maxBytes });
  const workflow = {
    id: workflowId,
    type: input.operation,
    workspaceId: workspace.exposedPath.id,
    workingDirectory: formatWorkspacePath(cwd, workspace),
    promptPreview: previewCommand(workflowPrompt),
    userPromptPreview: input.prompt ? previewCommand(input.prompt) : undefined,
    continuedFromWorkflowId: input.operation === "codex_continue" ? input.workflowId : undefined,
  };
  const runRecord = writeCodexRunRecord({
    workflowId,
    workflowType: input.operation,
    workspaceId: workspace.exposedPath.id,
    workspaceRoot: workspace.root,
    workingDirectory: workflow.workingDirectory,
    continuedFromWorkflowId: workflow.continuedFromWorkflowId,
    promptPreview: workflow.promptPreview,
    userPromptPreview: workflow.userPromptPreview,
    result,
    preRunChangeSummary,
    postRunChangeSummary,
    historyInsight: history,
    maxPreviewBytes: maxBytes,
  });

  return {
    workflow,
    result,
    preRunChangeSummary,
    postRunChangeSummary,
    historyInsight: history,
    runRecord,
  };
}

function isCodexWorkflowOperation(operation: WorkspaceOperationName): operation is CodexWorkflowOperationName {
  return operation === "codex_plan" ||
    operation === "codex_review" ||
    operation === "codex_fix" ||
    operation === "codex_test" ||
    operation === "codex_continue";
}

function codexWorkflowUserPrompt(input: WorkspaceOperationInput): string {
  if (input.operation === "codex_plan" || input.operation === "codex_fix") {
    return required(input.prompt, "prompt");
  }
  if (input.operation === "codex_review") {
    return input.prompt ?? "Review the current workspace changes for bugs, regressions, security risks, and missing tests.";
  }
  if (input.operation === "codex_test") {
    return input.prompt ?? (input.script ? `Run or inspect the package script named ${input.script} and summarize failures.` : "Run or inspect the appropriate project tests and summarize failures.");
  }
  return input.prompt ?? "Continue from the recent Computer Linker history, resolve the latest failure if one exists, and summarize the next concrete action.";
}

function buildCodexWorkflowPrompt(
  operation: CodexWorkflowOperationName,
  context: {
    userPrompt: string;
    script?: string;
    workflowId: string;
    workspace: Workspace;
    workingDirectory: string;
    preRunChangeSummary: unknown;
    history?: unknown;
  },
): string {
  return [
    `Computer Linker Codex workflow: ${operation}`,
    `Workflow id: ${context.workflowId}`,
    `Workspace: ${context.workspace.exposedPath.id} (${context.workspace.exposedPath.name})`,
    `Working directory: ${context.workingDirectory}`,
    "",
    "User request:",
    context.userPrompt,
    "",
    "Current change summary:",
    serializePromptContext(context.preRunChangeSummary),
    context.history ? ["", "Recent Computer Linker history/debug bundle:", serializePromptContext(context.history)].join("\n") : "",
    "",
    codexWorkflowInstructions(operation, context.script),
  ].filter(Boolean).join("\n");
}

function codexWorkflowInstructions(operation: CodexWorkflowOperationName, script?: string): string {
  switch (operation) {
    case "codex_plan":
      return [
        "Instructions:",
        "- Produce a concrete implementation plan.",
        "- Do not edit files unless the user explicitly asked for implementation inside the request.",
        "- Identify affected files, risks, and verification commands.",
      ].join("\n");
    case "codex_review":
      return [
        "Instructions:",
        "- Review as a code reviewer.",
        "- Lead with bugs, regressions, security risks, and missing tests.",
        "- Include file references where possible and avoid broad style commentary.",
      ].join("\n");
    case "codex_fix":
      return [
        "Instructions:",
        "- Implement the requested fix in this workspace.",
        "- Keep edits scoped and preserve existing behavior unless the request requires a change.",
        "- Run or recommend the relevant verification and summarize the resulting diff.",
      ].join("\n");
    case "codex_test":
      return [
        "Instructions:",
        script ? `- Prefer package script: ${script}.` : "- Select the most relevant test command from project metadata.",
        "- Run or inspect tests, capture failures, and propose the smallest next fix.",
        "- If tests cannot run, explain the blocker and the exact command that should be run.",
      ].join("\n");
    case "codex_continue":
      return [
        "Instructions:",
        "- Continue from the supplied recent Computer Linker history.",
        "- If a failed replay template is present, use it to understand the failed operation before acting.",
        "- Summarize what was continued, what changed, and what remains.",
      ].join("\n");
  }
}

function codexWorkflowId(operation: CodexWorkflowOperationName, workspaceId: string, prompt: string | undefined): string {
  const digest = createHash("sha256")
    .update(`${operation}\n${workspaceId}\n${prompt ?? ""}\n${Date.now()}`)
    .digest("hex")
    .slice(0, 12);
  return `${operation}_${digest}`;
}

function serializePromptContext(value: unknown): string {
  return truncateText(JSON.stringify(value, null, 2), 64 * 1024);
}

function auditTarget(input: WorkspaceOperationInput): string | undefined {
  if (input.operation === "process_read" || input.operation === "process_stop") return input.processId;
  if (input.operation === "codex_runs") return input.workflowId;
  if (input.operation === "explain_operation") return input.operationName;
  if (input.operation === "command" || input.operation === "process_start" || isCodexExecutionOperation(input.operation)) return input.workingDirectory ?? ".";
  if (input.operation === "git_worktree_create") return input.toPath;
  if (input.operation === "move") return input.toPath;
  if (input.operation === "git_stage" || input.operation === "git_unstage") return input.paths?.join(",");
  return input.path ?? input.fromPath;
}

async function projectOverview(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  options: { path: string; maxDepth?: number; maxEntries?: number },
): Promise<unknown> {
  const target = await registry.resolveExistingPath(workspace, options.path);
  const targetInfo = await stat(target);
  const targetDirectory = targetInfo.isDirectory() ? target : dirname(target);
  const targetWorkspacePath = formatWorkspacePath(targetDirectory, workspace);
  const projectRoot = await nearestProjectRoot(registry, workspace, targetDirectory) ?? targetDirectory;
  const projectRootPath = formatWorkspacePath(projectRoot, workspace);
  const packageJson = await readPackageJson(registry, workspace, projectRoot);
  const treeEntries = await registry.tree(workspace.id, targetWorkspacePath, {
    maxDepth: options.maxDepth ?? 3,
    maxEntries: options.maxEntries ?? 300,
    includeFiles: true,
  });
  const lockfiles = await existingWorkspaceFiles(registry, workspace, projectRoot, [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ]);
  const configFiles = await existingWorkspaceFiles(registry, workspace, projectRoot, [
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "eslint.config.js",
    ".eslintrc.json",
    "prettier.config.js",
    ".prettierrc",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "Dockerfile",
    "docker-compose.yml",
    "compose.yml",
    "Makefile",
  ]);
  const instructions = await registry.instructions(workspace.id, targetWorkspacePath, { maxBytes: 1 });

  return {
    path: targetWorkspacePath,
    projectRoot: projectRootPath,
    packageManagers: packageManagers(packageJson?.packageManager, lockfiles),
    packageScripts: packageJson?.scripts ? Object.keys(packageJson.scripts).sort() : [],
    packageName: typeof packageJson?.name === "string" ? packageJson.name : undefined,
    packageType: typeof packageJson?.type === "string" ? packageJson.type : undefined,
    configFiles,
    instructionFiles: instructions.map((file) => file.path),
    languages: languageHints(treeEntries),
    git: {
      detected: Boolean(await nearestExistingWorkspacePath(registry, workspace, targetDirectory, ".git")),
    },
    suggestedNextOperations: suggestedNextOperations(workspace),
  };
}

async function codingContext(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  options: { path: string; maxDepth?: number; maxEntries?: number; maxBytes?: number; maxResults?: number },
): Promise<unknown> {
  const target = await registry.resolveExistingPath(workspace, options.path);
  const targetInfo = await stat(target);
  const targetDirectory = targetInfo.isDirectory() ? target : dirname(target);
  const targetWorkspacePath = formatWorkspacePath(targetDirectory, workspace);
  const maxBytes = normalizeBoundedPositiveInteger(options.maxBytes, 32 * 1024, 128 * 1024);
  const maxResults = Math.min(normalizeMaxResults(options.maxResults), 50);

  return {
    path: targetWorkspacePath,
    overview: await projectOverview(registry, workspace, {
      path: targetWorkspacePath,
      maxDepth: options.maxDepth ?? 3,
      maxEntries: options.maxEntries ?? 300,
    }),
    instructions: await registry.instructions(workspace.id, targetWorkspacePath, {
      maxBytes,
    }),
    tree: await registry.tree(workspace.id, targetWorkspacePath, {
      maxDepth: options.maxDepth ?? 2,
      maxEntries: options.maxEntries ?? 100,
      includeFiles: true,
    }),
    agentSkills: await agentSkills(registry, workspace, {
      maxResults,
      maxBytes,
    }),
    changeSummary: await changeSummary(targetDirectory, {
      maxBytes,
    }),
  };
}

async function agentSkills(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  options: { maxResults?: number; maxBytes?: number },
): Promise<unknown> {
  const maxResults = normalizeMaxResults(options.maxResults);
  const maxBytes = normalizeBoundedPositiveInteger(options.maxBytes, 32 * 1024, 128 * 1024);
  const skills = [];
  const searchedRoots: string[] = [];

  for (const root of AGENT_SKILL_ROOTS) {
    if (skills.length >= maxResults) break;
    let absoluteRoot;
    try {
      absoluteRoot = await registry.resolveExistingPath(workspace, root);
    } catch {
      continue;
    }
    searchedRoots.push(root);

    for (const skillFile of await findSkillFiles(absoluteRoot, workspace, maxResults - skills.length)) {
      const path = formatWorkspacePath(skillFile, workspace);
      const content = await registry.readFile(workspace.id, path);
      skills.push(parseSkillFile(path, content.slice(0, maxBytes), Buffer.byteLength(content, "utf8") > maxBytes));
      if (skills.length >= maxResults) break;
    }
  }

  return {
    scope: "workspace",
    searchedRoots,
    skills,
  };
}

async function packageRun(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  cwd: string,
  options: { script: string; scriptArgs?: string[]; timeoutSeconds?: number; maxOutputBytes?: number },
): Promise<unknown> {
  const resolved = await resolvePackageScript(registry, workspace, cwd, options);
  assertPackageScriptAllowedByPolicy(workspace.exposedPath.policy, options.script);
  const commandText = `${resolved.packageManager} ${resolved.args.join(" ")}`;
  const limits = commandPolicyLimits(workspace.exposedPath.policy, commandText, options, 120);
  const process = await runProcess(resolved.packageManager, resolved.args, resolved.packageRootAbsolute, limits.timeoutMs, undefined, limits.maxOutputBytes);
  return {
    packageRoot: resolved.packageRoot,
    packageManager: resolved.packageManager,
    script: options.script,
    scriptArgs: resolved.scriptArgs,
    process,
  };
}

async function packageStart(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  cwd: string,
  options: { script: string; scriptArgs?: string[]; timeoutSeconds?: number; maxOutputBytes?: number },
): Promise<unknown> {
  const resolved = await resolvePackageScript(registry, workspace, cwd, options);
  assertPackageScriptAllowedByPolicy(workspace.exposedPath.policy, options.script);
  const commandText = `${resolved.packageManager} ${resolved.args.join(" ")}`;
  const limits = managedCommandPolicyLimits(workspace.exposedPath.policy, commandText, options);
  return {
    packageRoot: resolved.packageRoot,
    packageManager: resolved.packageManager,
    script: options.script,
    scriptArgs: resolved.scriptArgs,
    process: startManagedProcess({
      kind: "shell",
      workspaceId: workspace.exposedPath.id,
      workspaceRoot: workspace.root,
      cwd: resolved.packageRootAbsolute,
      command: resolved.packageManager,
      args: resolved.args,
      commandPreview: previewCommand(commandText),
      timeoutMs: limits.timeoutMs,
      maxOutputBytes: limits.maxOutputBytes,
    }),
  };
}

async function resolvePackageScript(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  cwd: string,
  options: { script: string; scriptArgs?: string[] },
): Promise<{ packageRoot: string; packageRootAbsolute: string; packageManager: string; scriptArgs: string[]; args: string[] }> {
  const targetInfo = await stat(cwd);
  const targetDirectory = targetInfo.isDirectory() ? cwd : dirname(cwd);
  const projectRoot = await nearestProjectRoot(registry, workspace, targetDirectory);
  if (!projectRoot) throw new Error("No package.json found for package script operation");

  const packageJson = await readPackageJson(registry, workspace, projectRoot);
  const scripts = packageJson?.scripts ?? {};
  if (!Object.prototype.hasOwnProperty.call(scripts, options.script)) {
    throw new Error(`Unknown package script: ${options.script}`);
  }

  const packageManager = await packageManagerForRun(registry, workspace, projectRoot, packageJson?.packageManager);
  const scriptArgs = (options.scriptArgs ?? []).map((arg) => {
    if (arg.includes("\0")) throw new Error("scriptArgs must not contain NUL bytes");
    return arg;
  });
  return {
    packageRoot: formatWorkspacePath(projectRoot, workspace),
    packageRootAbsolute: projectRoot,
    packageManager,
    scriptArgs,
    args: packageRunArgs(packageManager, options.script, scriptArgs),
  };
}

async function findSkillFiles(root: string, workspace: Workspace, maxResults: number): Promise<string[]> {
  const results: string[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > 4) return;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      return;
    }

    const directories: string[] = [];
    for await (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(absolutePath);
        if (results.length >= maxResults) return;
      } else if (entry.isDirectory() && !SKIPPED_SKILL_DIRECTORIES.has(entry.name)) {
        directories.push(absolutePath);
      }
    }

    directories.sort((a, b) => basename(a).localeCompare(basename(b)));
    for (const child of directories) {
      if (results.length >= maxResults) return;
      if (!formatWorkspacePath(child, workspace).startsWith("..")) {
        await walk(child, depth + 1);
      }
    }
  }

  await walk(root, 1);
  return results.sort((a, b) => a.localeCompare(b));
}

function parseSkillFile(path: string, content: string, truncated: boolean): Record<string, unknown> {
  const lines = content.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();
  const description = firstDescription(lines);
  return {
    name: basename(dirname(path)),
    path,
    title: title || basename(dirname(path)),
    description,
    truncated,
  };
}

function firstDescription(lines: string[]): string | undefined {
  const frontmatterDescription = lines
    .map((line) => line.match(/^description:\s*(.+)$/i)?.[1]?.trim())
    .find(Boolean);
  if (frontmatterDescription) return truncateDescription(frontmatterDescription);

  for (const line of lines) {
    const text = line.trim();
    if (!text || text === "---" || text.startsWith("#") || text.includes(":")) continue;
    return truncateDescription(text);
  }
  return undefined;
}

function truncateDescription(value: string): string {
  return value.length > 300 ? `${value.slice(0, 297)}...` : value;
}

async function nearestProjectRoot(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  startDirectory: string,
): Promise<string | undefined> {
  let current = startDirectory;
  while (true) {
    for (const name of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "composer.json"]) {
      if (await workspacePathExists(registry, workspace, join(current, name))) return current;
    }
    if (current === workspace.root) return undefined;
    current = dirname(current);
  }
}

async function nearestExistingWorkspacePath(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  startDirectory: string,
  name: string,
): Promise<string | undefined> {
  let current = startDirectory;
  while (true) {
    const candidate = join(current, name);
    if (await workspacePathExists(registry, workspace, candidate)) return candidate;
    if (current === workspace.root) return undefined;
    current = dirname(current);
  }
}

async function existingWorkspaceFiles(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  directory: string,
  names: string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const name of names) {
    const absolutePath = join(directory, name);
    if (await workspacePathExists(registry, workspace, absolutePath)) {
      files.push(formatWorkspacePath(absolutePath, workspace));
    }
  }
  return files;
}

async function readPackageJson(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  directory: string,
): Promise<{ name?: unknown; type?: unknown; packageManager?: unknown; scripts?: Record<string, unknown> } | undefined> {
  const packagePath = join(directory, "package.json");
  if (!(await workspacePathExists(registry, workspace, packagePath))) return undefined;
  const content = await readFile(await registry.resolveExistingPath(workspace, formatWorkspacePath(packagePath, workspace)), "utf8");
  const parsed = JSON.parse(content) as { name?: unknown; type?: unknown; packageManager?: unknown; scripts?: unknown };
  return {
    name: parsed.name,
    type: parsed.type,
    packageManager: parsed.packageManager,
    scripts: parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)
      ? parsed.scripts as Record<string, unknown>
      : undefined,
  };
}

async function workspacePathExists(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  absolutePath: string,
): Promise<boolean> {
  try {
    await registry.resolveExistingPath(workspace, formatWorkspacePath(absolutePath, workspace));
    return true;
  } catch {
    return false;
  }
}

function packageManagers(packageManager: unknown, lockfiles: string[]): string[] {
  const managers = new Set<string>();
  if (typeof packageManager === "string" && packageManager.trim()) {
    managers.add(packageManager.split("@")[0] ?? packageManager);
  }
  for (const lockfile of lockfiles.map((path) => basename(path))) {
    if (lockfile === "package-lock.json") managers.add("npm");
    if (lockfile === "pnpm-lock.yaml") managers.add("pnpm");
    if (lockfile === "yarn.lock") managers.add("yarn");
    if (lockfile === "bun.lock" || lockfile === "bun.lockb") managers.add("bun");
  }
  return [...managers].sort();
}

async function packageManagerForRun(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  projectRoot: string,
  packageManager: unknown,
): Promise<string> {
  if (typeof packageManager === "string" && packageManager.trim()) {
    return packageManager.split("@")[0] || "npm";
  }
  const lockfiles = await existingWorkspaceFiles(registry, workspace, projectRoot, [
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
  ]);
  const names = lockfiles.map((path) => basename(path));
  if (names.includes("pnpm-lock.yaml")) return "pnpm";
  if (names.includes("yarn.lock")) return "yarn";
  if (names.includes("bun.lock") || names.includes("bun.lockb")) return "bun";
  return "npm";
}

function packageRunArgs(manager: string, script: string, scriptArgs: string[]): string[] {
  if (manager === "npm") return ["run", script, "--", ...scriptArgs];
  if (manager === "pnpm") return ["run", script, "--", ...scriptArgs];
  if (manager === "yarn") return ["run", script, ...scriptArgs];
  if (manager === "bun") return ["run", script, ...scriptArgs];
  return ["run", script, "--", ...scriptArgs];
}

function languageHints(entries: Array<{ path: string; name: string; type: string }>): Array<{ language: string; files: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    const language = languageForPath(entry.path || entry.name);
    if (!language) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

function languageForPath(path: string): string | undefined {
  const name = basename(path);
  if (name === "Dockerfile") return "Dockerfile";
  if (name === "Makefile") return "Make";
  switch (extname(path)) {
    case ".ts":
    case ".tsx":
      return "TypeScript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "JavaScript";
    case ".py":
      return "Python";
    case ".go":
      return "Go";
    case ".rs":
      return "Rust";
    case ".swift":
      return "Swift";
    case ".java":
      return "Java";
    case ".kt":
    case ".kts":
      return "Kotlin";
    case ".rb":
      return "Ruby";
    case ".php":
      return "PHP";
    case ".css":
      return "CSS";
    case ".html":
      return "HTML";
    case ".md":
      return "Markdown";
    case ".json":
      return "JSON";
    case ".yml":
    case ".yaml":
      return "YAML";
    default:
      return undefined;
  }
}

function suggestedNextOperations(workspace: Workspace): string[] {
  return [
    "coding_context",
    "instructions",
    "agent_skills",
    "change_summary",
    "repo_status",
    "git_changes",
    "git_diff",
    "git_log",
    "git_show",
    "git_worktree_list",
    "tree",
    "search_symbols",
    "search_text",
    "read_many",
    ...(workspace.exposedPath.permissions.write ? ["git_stage", "git_unstage", "git_commit", "git_worktree_create"] : []),
    ...(workspace.exposedPath.permissions.shell ? ["package_run", "package_start", "command", "process_start", "process_list"] : []),
    ...(workspace.exposedPath.permissions.codex ? ["codex_plan", "codex_review", "codex_fix", "codex_test", "codex_continue", "codex_runs", "codex"] : []),
  ];
}

async function validatePatchPaths(registry: WorkspaceRegistry, workspace: Workspace, patch: string): Promise<void> {
  const paths = extractPatchPaths(patch);
  if (paths.length === 0) {
    throw new Error("patch must include at least one workspace path");
  }

  for (const path of paths) {
    if (path.startsWith("/") || path.includes("\0")) {
      throw new Error(`Patch path is not allowed: ${path}`);
    }
    await registry.resolveWritablePath(workspace, path);
    assertSensitivePathMutationAllowed(path, workspace.exposedPath.policy, "patch");
  }
}

function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const parts = line.slice("diff --git ".length).trim().split(/\s+/);
      for (const part of parts) addPatchPath(paths, stripGitPrefix(part));
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      addPatchPath(paths, stripGitPrefix(line.slice(4).trim().split(/\s+/)[0] ?? ""));
      continue;
    }

    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      addPatchPath(paths, line.replace(/^rename (from|to) /, "").trim());
      continue;
    }

    if (line.startsWith("copy from ") || line.startsWith("copy to ")) {
      addPatchPath(paths, line.replace(/^copy (from|to) /, "").trim());
    }
  }

  return [...paths];
}

function addPatchPath(paths: Set<string>, path: string): void {
  if (!path || path === "/dev/null") return;
  paths.add(path);
}

function stripGitPrefix(path: string): string {
  const normalized = path.replace(/^"|"$/g, "");
  return normalized.startsWith("a/") || normalized.startsWith("b/") ? normalized.slice(2) : normalized;
}

async function repoStatus(
  cwd: string,
  options: { includeDiff: boolean; maxBytes?: number },
): Promise<unknown> {
  const maxBytes = normalizeBoundedPositiveInteger(options.maxBytes, 64 * 1024, 256 * 1024);
  const status = await runProcess("git", ["status", "--short", "--branch"], cwd, 10_000);
  if (status.exitCode !== 0) {
    return {
      isGitRepository: false,
      status,
    };
  }

  const diffStat = await runProcess("git", ["diff", "--stat"], cwd, 10_000);
  const stagedDiffStat = await runProcess("git", ["diff", "--cached", "--stat"], cwd, 10_000);
  const result: Record<string, unknown> = {
    isGitRepository: true,
    status: status.stdout,
    diffStat: diffStat.stdout,
    stagedDiffStat: stagedDiffStat.stdout,
  };

  if (options.includeDiff) {
    const diff = await runProcess("git", ["diff", "--"], cwd, 10_000);
    const stagedDiff = await runProcess("git", ["diff", "--cached", "--"], cwd, 10_000);
    const sanitizedDiff = sanitizeGitPatchOutput(diff.stdout);
    const sanitizedStagedDiff = sanitizeGitPatchOutput(stagedDiff.stdout);
    result.diff = truncateText(sanitizedDiff.output, maxBytes);
    result.diffTruncated = Buffer.byteLength(sanitizedDiff.output, "utf8") > maxBytes;
    result.diffRedacted = sanitizedDiff.redacted;
    result.diffRedactedPaths = sanitizedDiff.redactedPaths;
    result.stagedDiff = truncateText(sanitizedStagedDiff.output, maxBytes);
    result.stagedDiffTruncated = Buffer.byteLength(sanitizedStagedDiff.output, "utf8") > maxBytes;
    result.stagedDiffRedacted = sanitizedStagedDiff.redacted;
    result.stagedDiffRedactedPaths = sanitizedStagedDiff.redactedPaths;
  }

  return result;
}

async function gitChanges(cwd: string): Promise<unknown> {
  const process = await runProcess("git", ["status", "--porcelain=v1", "--branch"], cwd, 10_000);
  if (process.exitCode !== 0) {
    return {
      isGitRepository: false,
      process,
      clean: false,
      entries: [],
      counts: { total: 0, staged: 0, unstaged: 0, untracked: 0, ignored: 0 },
    };
  }

  const parsed = parseGitChanges(process.stdout);
  return {
    isGitRepository: true,
    ...parsed,
  };
}

async function changeSummary(cwd: string, options: { maxBytes?: number }): Promise<unknown> {
  const maxBytes = normalizeBoundedPositiveInteger(options.maxBytes, 64 * 1024, 256 * 1024);
  const status = await runProcess("git", ["status", "--porcelain=v1", "--branch"], cwd, 10_000);
  if (status.exitCode !== 0) {
    return {
      isGitRepository: false,
      status,
      clean: false,
      branchLine: undefined,
      counts: { total: 0, staged: 0, unstaged: 0, untracked: 0, ignored: 0 },
      entries: [],
      diffStat: "",
      stagedDiffStat: "",
      diffStatTruncated: false,
      stagedDiffStatTruncated: false,
    };
  }

  const parsed = parseGitChanges(status.stdout);
  const diffStat = await runProcess("git", ["diff", "--stat"], cwd, 10_000);
  const stagedDiffStat = await runProcess("git", ["diff", "--cached", "--stat"], cwd, 10_000);
  return {
    isGitRepository: true,
    branchLine: parsed.branchLine,
    clean: parsed.clean,
    counts: parsed.counts,
    entries: parsed.entries,
    diffStat: truncateText(diffStat.stdout, maxBytes),
    stagedDiffStat: truncateText(stagedDiffStat.stdout, maxBytes),
    diffStatTruncated: Buffer.byteLength(diffStat.stdout, "utf8") > maxBytes,
    stagedDiffStatTruncated: Buffer.byteLength(stagedDiffStat.stdout, "utf8") > maxBytes,
  };
}

async function gitDiff(
  cwd: string,
  options: { paths: string[]; pathspecs: string[]; staged: boolean; maxBytes?: number },
): Promise<unknown> {
  const maxBytes = normalizeBoundedPositiveInteger(options.maxBytes, 64 * 1024, 256 * 1024);
  const repositoryCheck = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], cwd, 10_000);
  if (repositoryCheck.exitCode !== 0) {
    return {
      isGitRepository: false,
      staged: options.staged,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process: repositoryCheck,
      diff: "",
      truncated: false,
    };
  }

  const args = ["diff"];
  if (options.staged) args.push("--cached");
  args.push("--", ...options.pathspecs);
  const process = await runProcess("git", args, cwd, 10_000);
  if (process.exitCode !== 0) {
    return {
      isGitRepository: false,
      staged: options.staged,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process,
      diff: "",
      truncated: false,
    };
  }

  const sanitized = sanitizeGitPatchOutput(process.stdout);
  const sizeBytes = Buffer.byteLength(sanitized.output, "utf8");
  return {
    isGitRepository: true,
    staged: options.staged,
    paths: options.paths,
    pathspecs: options.pathspecs,
    diff: truncateText(sanitized.output, maxBytes),
    sizeBytes,
    truncated: sizeBytes > maxBytes,
    redacted: sanitized.redacted,
    redactedPaths: sanitized.redactedPaths,
  };
}

async function gitLog(
  cwd: string,
  options: { paths: string[]; pathspecs: string[]; maxResults?: number },
): Promise<unknown> {
  const maxResults = Math.min(normalizeMaxResults(options.maxResults), 200);
  const repositoryCheck = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], cwd, 10_000);
  if (repositoryCheck.exitCode !== 0) {
    return {
      isGitRepository: false,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process: repositoryCheck,
      commits: [],
    };
  }

  const args = [
    "log",
    `--max-count=${maxResults}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
    "--",
    ...options.pathspecs,
  ];
  const process = await runProcess("git", args, cwd, 10_000);
  if (process.exitCode !== 0) {
    return {
      isGitRepository: true,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process,
      commits: [],
    };
  }

  return {
    isGitRepository: true,
    paths: options.paths,
    pathspecs: options.pathspecs,
    commits: parseGitLog(process.stdout),
  };
}

async function gitShow(
  cwd: string,
  options: { ref?: string; paths: string[]; pathspecs: string[]; maxBytes?: number },
): Promise<unknown> {
  const ref = optionalGitRef(options.ref, "ref") ?? "HEAD";
  const maxBytes = normalizeBoundedPositiveInteger(options.maxBytes, 64 * 1024, 256 * 1024);
  const repositoryCheck = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], cwd, 10_000);
  if (repositoryCheck.exitCode !== 0) {
    return {
      isGitRepository: false,
      ref,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process: repositoryCheck,
      output: "",
      truncated: false,
    };
  }

  const args = ["show", "--stat", "--patch", "--format=fuller", ref, "--", ...options.pathspecs];
  const process = await runProcess("git", args, cwd, 10_000);
  if (process.exitCode !== 0) {
    return {
      isGitRepository: true,
      ref,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process,
      output: "",
      truncated: false,
    };
  }

  const sanitized = sanitizeGitPatchOutput(process.stdout);
  const sizeBytes = Buffer.byteLength(sanitized.output, "utf8");
  return {
    isGitRepository: true,
    ref,
    paths: options.paths,
    pathspecs: options.pathspecs,
    output: truncateText(sanitized.output, maxBytes),
    sizeBytes,
    truncated: sizeBytes > maxBytes,
    redacted: sanitized.redacted,
    redactedPaths: sanitized.redactedPaths,
  };
}

async function gitIndexUpdate(
  cwd: string,
  options: { action: "stage" | "unstage"; commandArgs: string[]; paths: string[]; pathspecs: string[] },
): Promise<unknown> {
  const repositoryCheck = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], cwd, 10_000);
  if (repositoryCheck.exitCode !== 0) {
    return {
      isGitRepository: false,
      action: options.action,
      paths: options.paths,
      pathspecs: options.pathspecs,
      process: repositoryCheck,
      updated: false,
    };
  }

  const process = await runProcess("git", [...options.commandArgs, ...options.pathspecs], cwd, 30_000);
  return {
    isGitRepository: true,
    action: options.action,
    paths: options.paths,
    pathspecs: options.pathspecs,
    process,
    updated: process.exitCode === 0,
  };
}

async function gitCommit(
  workspace: Workspace,
  cwd: string,
  message: string,
): Promise<unknown> {
  const repositoryCheck = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], cwd, 10_000);
  if (repositoryCheck.exitCode !== 0) {
    return {
      isGitRepository: false,
      committed: false,
      process: repositoryCheck,
      stagedPaths: [],
    };
  }

  const rootResult = await runProcess("git", ["rev-parse", "--show-toplevel"], cwd, 10_000);
  if (rootResult.exitCode !== 0) {
    return {
      isGitRepository: false,
      committed: false,
      process: rootResult,
      stagedPaths: [],
    };
  }

  const repositoryRoot = rootResult.stdout.trim();
  const staged = await runProcess("git", ["diff", "--cached", "--name-only", "-z"], cwd, 10_000);
  if (staged.exitCode !== 0) {
    return {
      isGitRepository: true,
      committed: false,
      repositoryRoot,
      process: staged,
      stagedPaths: [],
    };
  }

  const stagedPaths = staged.stdout.split("\0").filter(Boolean);
  if (stagedPaths.length === 0) {
    return {
      isGitRepository: true,
      committed: false,
      repositoryRoot,
      stagedPaths,
      error: "no staged files to commit",
    };
  }

  const workspaceRoot = resolve(workspace.root);
  const outsidePaths = stagedPaths.filter((path) => {
    const absolutePath = resolve(repositoryRoot, path);
    return !isInsideResolvedRoot(absolutePath, workspaceRoot);
  });
  if (outsidePaths.length > 0) {
    return {
      isGitRepository: true,
      committed: false,
      repositoryRoot,
      stagedPaths,
      outsideWorkspacePaths: outsidePaths,
      error: "staged files include paths outside the workspace",
    };
  }

  const process = await runProcess("git", ["commit", "-m", message], cwd, 60_000);
  return {
    isGitRepository: true,
    committed: process.exitCode === 0,
    repositoryRoot,
    stagedPaths,
    process,
  };
}

async function validateGitPathspecs(
  registry: WorkspaceRegistry,
  workspace: Workspace,
  cwd: string,
  paths: string[] | undefined,
): Promise<Array<{ inputPath: string; gitPathspec: string }>> {
  if (!paths || paths.length === 0) return [];
  if (paths.length > 100) throw operationError("invalid_request", "paths supports at most 100 files per call");

  const normalized = [];
  for (const path of paths.map((value) => required(value, "paths[]"))) {
    if (path.startsWith("/") || path.startsWith("-") || path.includes("\0")) {
      throw new Error(`Git pathspec is not allowed: ${path}`);
    }
    const absolutePath = registry.resolvePath(workspace, path);
    try {
      await registry.resolveExistingPath(workspace, path);
    } catch {
      await registry.resolveExistingPath(workspace, dirname(path));
    }
    normalized.push({
      inputPath: path,
      gitPathspec: formatGitPathspec(absolutePath, cwd),
    });
  }
  return normalized;
}

function formatGitPathspec(path: string, cwd: string): string {
  const pathspec = relative(cwd, path);
  return pathspec ? pathspec.split(sep).join("/") : ".";
}

function isInsideResolvedRoot(path: string, root: string): boolean {
  const relationship = relative(root, path);
  return relationship === "" || (relationship !== ".." && !relationship.startsWith(`..${sep}`));
}

function requireGitPathspecs(
  paths: Array<{ inputPath: string; gitPathspec: string }>,
): Array<{ inputPath: string; gitPathspec: string }> {
  if (paths.length === 0) {
    throw operationError("invalid_request", "paths is required for this operation");
  }
  return paths;
}

function parseGitChanges(output: string): {
  branchLine?: string;
  clean: boolean;
  counts: { total: number; staged: number; unstaged: number; untracked: number; ignored: number };
  entries: Array<Record<string, unknown>>;
} {
  const entries = [];
  let branchLine: string | undefined;

  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith("## ")) {
      branchLine = line.slice(3);
      continue;
    }

    const indexStatus = line[0] ?? " ";
    const workingTreeStatus = line[1] ?? " ";
    const rawPath = line.slice(3);
    const renameParts = rawPath.includes(" -> ") ? rawPath.split(" -> ") : undefined;
    const rawStatus = `${indexStatus}${workingTreeStatus}`;
    const untracked = rawStatus === "??";
    const ignored = rawStatus === "!!";
    entries.push({
      path: renameParts?.[1] ?? rawPath,
      originalPath: renameParts?.[0],
      rawStatus,
      indexStatus: statusName(indexStatus),
      workingTreeStatus: statusName(workingTreeStatus),
      staged: !untracked && !ignored && indexStatus !== " ",
      unstaged: !untracked && !ignored && workingTreeStatus !== " ",
      untracked,
      ignored,
    });
  }

  return {
    branchLine,
    clean: entries.length === 0,
    counts: {
      total: entries.length,
      staged: entries.filter((entry) => entry.staged).length,
      unstaged: entries.filter((entry) => entry.unstaged).length,
      untracked: entries.filter((entry) => entry.untracked).length,
      ignored: entries.filter((entry) => entry.ignored).length,
    },
    entries,
  };
}

function parseGitLog(output: string): Array<Record<string, unknown>> {
  return output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, shortHash, authorName, authorEmail, authoredAt, subject] = entry.split("\x1f");
      return {
        hash,
        shortHash,
        authorName,
        authorEmail,
        authoredAt,
        subject,
      };
    });
}

function statusName(status: string): string | undefined {
  switch (status) {
    case " ":
      return undefined;
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    case "?":
      return "untracked";
    case "!":
      return "ignored";
    default:
      return status;
  }
}

async function gitWorktreeList(cwd: string): Promise<unknown> {
  const result = await runProcess("git", ["worktree", "list", "--porcelain"], cwd, 10_000);
  if (result.exitCode !== 0) {
    return {
      isGitRepository: false,
      process: result,
      worktrees: [],
    };
  }

  return {
    isGitRepository: true,
    worktrees: parseGitWorktrees(result.stdout),
  };
}

async function gitWorktreeCreate(
  cwd: string,
  target: string,
  options: { branch?: string; startPoint?: string; targetPath: string },
): Promise<unknown> {
  const branch = optionalGitRef(options.branch, "branch");
  const startPoint = optionalGitRef(options.startPoint, "startPoint");
  const args = ["worktree", "add"];
  if (branch) args.push("-b", branch);
  args.push(target);
  if (startPoint) args.push(startPoint);
  const process = await runProcess("git", args, cwd, 60_000);
  return {
    created: process.exitCode === 0,
    targetPath: options.targetPath,
    branch,
    startPoint,
    process,
  };
}

function parseGitWorktrees(output: string): Array<Record<string, unknown>> {
  const worktrees = [];
  let current: Record<string, unknown> | undefined;

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      if (current) worktrees.push(current);
      current = undefined;
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      if (current) worktrees.push(current);
      current = { path: value };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value;
    else if (key === "bare" || key === "detached" || key === "locked" || key === "prunable") current[key] = true;
    else current[key] = value || true;
  }

  if (current) worktrees.push(current);
  return worktrees;
}

function optionalGitRef(value: string | undefined, name: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.startsWith("-") || text.includes("\0") || text.includes(":")) {
    throw new Error(`${name} is not allowed`);
  }
  return text;
}

function normalizeBoundedPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, max) : fallback;
}

function truncateText(value: string, maxBytes: number): string {
  return Buffer.byteLength(value, "utf8") > maxBytes
    ? Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8")
    : value;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  stdin?: string,
  maxOutputBytes?: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const executable = executableCommand(command, args);
    const child = execFile(executable.command, executable.args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 10,
      windowsVerbatimArguments: executable.windowsVerbatimArguments,
    }, (error, stdout, stderr) => {
      if (error && !isExecError(error)) {
        reject(error);
        return;
      }

      const boundedStdout = maxOutputBytes === undefined ? { text: stdout, truncated: false } : boundedProcessOutput(stdout, maxOutputBytes);
      const boundedStderr = maxOutputBytes === undefined ? { text: stderr, truncated: false } : boundedProcessOutput(stderr, maxOutputBytes);
      resolve({
        exitCode: error ? error.code ?? null : 0,
        signal: error?.signal ?? undefined,
        timedOut: Boolean(error?.killed && error?.signal === "SIGTERM"),
        stdout: boundedStdout.text,
        stderr: boundedStderr.text,
        stdoutTruncated: boundedStdout.truncated || undefined,
        stderrTruncated: boundedStderr.truncated || undefined,
      });
    });

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

function boundedProcessOutput(value: string, maxOutputBytes: number): { text: string; truncated: boolean } {
  const truncated = Buffer.byteLength(value, "utf8") > maxOutputBytes;
  return {
    text: truncated ? truncateText(value, maxOutputBytes) : value,
    truncated,
  };
}

function isExecError(error: unknown): error is Error & { code?: number; signal?: string; killed?: boolean } {
  return error instanceof Error && ("code" in error || "signal" in error || "killed" in error);
}

function splitSearchOutput(output: string): string[] {
  if (output === "No matches." || output === "No files found.") return [];
  return output.split("\n").filter((line) => line && line !== "--");
}

const AGENT_SKILL_ROOTS = [".codex/skills", ".claude/skills", "skills"];
const SKIPPED_SKILL_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
]);
