import { configPath } from "./config.js";
import { genericMcpTools } from "./mcp-surface.js";
import type { LocalPortConfig } from "./permissions.js";

export type ChatGptProfileMode = "safe" | "coding" | "full";

export interface ChatGptProfileOptions {
  publicBaseUrl?: string;
}

export interface ChatGptModelGuide {
  summary: string;
  mcpEntrypoint: "computer_operation";
  jsonApiEntrypoint: {
    endpoint: "POST /api/v1/control";
    action: "computer_operation";
    availability: "local-or-trusted-private-only";
    publicTunnelDefault: "blocked-when-publicMcpOnly";
  };
  startupChecklist: string[];
  operationSelection: Array<{
    intent: string;
    op: string;
    when: string;
  }>;
  guardrails: string[];
}

export interface ChatGptWorkflowRecipe {
  name: string;
  purpose: string;
  steps: Array<{
    tool: "get_computer_info" | "computer_operation" | "get_operation_history";
    input?: Record<string, unknown>;
    why: string;
  }>;
}

export interface ConnectionProfile {
  name: "workspace-linker";
  machineId?: string;
  machineName: string;
  configPath: string;
  stdio: {
    command: string;
    args: string[];
  };
  http: {
    localMcpUrl: string;
    publicMcpUrl: string;
    localApiUrl: string;
    publicApiUrl: string | null;
    publicApiAvailable: boolean;
    auth: {
      mode: "loopback-only" | "owner-token-or-oauth";
      header?: string;
      bearerToken?: string;
    };
  };
}

export interface ChatGptConnectProfile {
  kind: "chatgpt-mcp-app";
  schemaVersion: 1;
  mode: ChatGptProfileMode;
  name: string;
  description: string;
  machineId?: string;
  machineName: string;
  configPath: string;
  mcpServerUrl: string;
  publicBaseUrl: string | null;
  localMcpUrl: string;
  auth: {
    preferred: "oauth";
    fallback: "bearer";
    oauth: {
      discovery: string;
      scopes: string[];
    };
    bearer: {
      header: string | null;
      token?: string;
      alternateHeader: string | null;
    };
    notes: string[];
  };
  appManifest: {
    appName: string;
    appType: "remote-mcp";
    serverUrl: string;
    authType: "oauth-or-bearer";
  };
  setup: {
    developerMode: true;
    requiredReachability: "public-https";
    connectionType: "Remote MCP";
    mode: ChatGptProfileMode;
    firstPrompt: string;
    verifyWith: string[];
  };
  tools: string[];
  operationShape: {
    recommendedTool: "computer_operation";
    envelope: {
      scope: string;
      op: string;
      target: string;
      input: Record<string, unknown>;
      options: Record<string, unknown>;
    };
    notes: string[];
  };
  recommendedFlow: Array<{
    step: number;
    tool: string;
    purpose: string;
    input?: Record<string, unknown>;
  }>;
  modelGuide: ChatGptModelGuide;
  workflowRecipes: ChatGptWorkflowRecipe[];
  gptInstructions: string[];
  warnings: string[];
}

export interface ChatGptAppManifest {
  kind: "chatgpt-app-manifest";
  schemaVersion: 1;
  mode: ChatGptProfileMode;
  appName: string;
  description: string;
  appType: "remote-mcp";
  mcpServerUrl: string;
  auth: {
    preferred: "oauth";
    fallback: "bearer";
    scopes: string[];
  };
  tools: string[];
  firstPrompt: string;
  warnings: string[];
}

export interface ChatGptConnectorConfig {
  kind: "chatgpt-connector-config";
  schemaVersion: 1;
  mode: ChatGptProfileMode;
  displayName: string;
  mcpServerUrl: string;
  connectionType: "Remote MCP";
  auth: {
    type: "oauth-or-bearer";
    oauthScopes: string[];
    bearerHeader: string | null;
    alternateBearerHeader: string | null;
  };
  setup: ChatGptConnectProfile["setup"];
  recommendedFlow: ChatGptConnectProfile["recommendedFlow"];
  modelGuide: ChatGptConnectProfile["modelGuide"];
  workflowRecipes: ChatGptConnectProfile["workflowRecipes"];
  gptInstructions: string[];
  warnings: string[];
}

export function connectionProfile(config: LocalPortConfig, includeSecrets = false): ConnectionProfile {
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 3939;
  const publicBaseUrl = config.publicBaseUrl ?? localPublicBaseUrl(host, port);
  const mcpUrl = new URL("/mcp", publicBaseUrl);
  const publicApiAvailable = !config.publicMcpOnly;
  const apiUrl = publicApiAvailable ? new URL("/api/v1", publicBaseUrl) : undefined;
  const localMcpUrl = `http://${host}:${port}/mcp`;
  const localApiUrl = `http://${host}:${port}/api/v1`;

  return {
    name: "workspace-linker",
    machineId: config.machineId,
    machineName: config.machineName,
    configPath: configPath(),
    stdio: {
      command: "workspace-linker",
      args: ["serve"],
    },
    http: {
      localMcpUrl,
      publicMcpUrl: mcpUrl.href,
      localApiUrl,
      publicApiUrl: apiUrl?.href ?? null,
      publicApiAvailable,
      auth: config.ownerToken
        ? {
            mode: "owner-token-or-oauth",
            header: includeSecrets ? `Authorization: Bearer ${config.ownerToken}` : "Authorization: Bearer <ownerToken>",
            bearerToken: includeSecrets ? config.ownerToken : undefined,
          }
        : {
            mode: "loopback-only",
          },
    },
  };
}

export function parseChatGptProfileMode(value: string | undefined, command = "chatgpt --mode"): ChatGptProfileMode {
  if (!value) return "coding";
  if (value === "safe" || value === "coding" || value === "full") return value;
  throw new Error(`${command} must be one of: safe, coding, full`);
}

export function chatGptConnectProfile(config: LocalPortConfig, includeSecrets = false, mode: ChatGptProfileMode = "coding", options: ChatGptProfileOptions = {}): ChatGptConnectProfile {
  const effectiveConfig = options.publicBaseUrl ? { ...config, publicBaseUrl: options.publicBaseUrl } : config;
  const profile = connectionProfile(effectiveConfig, includeSecrets);
  const publicBaseUrl = effectiveConfig.publicBaseUrl ?? null;
  const modeSpec = chatGptModeSpec(mode);
  const warnings = chatGptWarnings(config, profile.http.publicMcpUrl, mode, options);
  const bearerHeader = config.ownerToken
    ? includeSecrets
      ? `Authorization: Bearer ${config.ownerToken}`
      : "Authorization: Bearer <ownerToken>"
    : null;

  return {
    kind: "chatgpt-mcp-app",
    schemaVersion: 1,
    mode,
    name: `Workspace Linker (${config.machineName})`,
    description: "Permissioned MCP access to predefined local coding workspaces on this computer.",
    machineId: config.machineId,
    machineName: config.machineName,
    configPath: profile.configPath,
    mcpServerUrl: profile.http.publicMcpUrl,
    publicBaseUrl,
    localMcpUrl: profile.http.localMcpUrl,
    auth: {
      preferred: "oauth",
      fallback: "bearer",
      oauth: {
        discovery: "Use MCP OAuth discovery from the MCP server URL when the client supports it.",
        scopes: ["workspace-linker"],
      },
      bearer: {
        header: bearerHeader,
        token: includeSecrets ? config.ownerToken : undefined,
        alternateHeader: config.ownerToken
          ? includeSecrets
            ? `x-workspace-linker-token: ${config.ownerToken}`
            : "x-workspace-linker-token: <ownerToken>"
          : null,
      },
      notes: [
        "Prefer OAuth for ChatGPT custom MCP apps.",
        "Use bearer auth only in clients that support custom headers.",
        "Do not paste the owner token into untrusted clients or shared chats.",
      ],
    },
    appManifest: {
      appName: `Workspace Linker (${config.machineName})`,
      appType: "remote-mcp",
      serverUrl: profile.http.publicMcpUrl,
      authType: "oauth-or-bearer",
    },
    setup: {
      developerMode: true,
      requiredReachability: "public-https",
      connectionType: "Remote MCP",
      mode,
      firstPrompt: modeSpec.firstPrompt,
      verifyWith: modeSpec.verifyWith,
    },
    tools: [...genericMcpTools],
    operationShape: {
      recommendedTool: "computer_operation",
      envelope: modeSpec.envelope,
      notes: [
        "Always use the stable envelope: scope, op, target, input, options.",
        "For public ChatGPT connections, use MCP tools; the JSON API is for local or trusted private automation.",
        "Use get_computer_info, operationRegistry, allowedOperations, and scope capabilityPolicy before write, shell, process, git write, package, or codex operations.",
        "target usually maps to path; for command, process_start, codex, and codex_start it maps to workingDirectory.",
      ],
    },
    recommendedFlow: [
      {
        step: 1,
        tool: "get_computer_info",
        purpose: "Learn machine identity, scopes, operationRegistry, permissions, tunnel/auth state, and safety boundaries.",
      },
      {
        step: 2,
        tool: "computer_operation",
        purpose: modeSpec.operationPurpose,
        input: modeSpec.flowInput,
      },
      {
        step: 3,
        tool: "get_operation_history",
        purpose: "Inspect the last action or connection/debug history when needed.",
        input: { scope: "app", view: "last", limit: 20 },
      },
    ],
    modelGuide: chatGptModelGuide(mode),
    workflowRecipes: chatGptWorkflowRecipes(mode),
    gptInstructions: [
      "Do not invent file paths outside listed scopes.",
      "Choose a scope returned by get_computer_info before calling computer_operation.",
      "Do not call shell, process, package, git write, or codex operations unless allowedOperations includes the operation.",
      "Prefer code.context, file.search, file.read, git.status, git.diff, and history.last before editing.",
      "Use get_operation_history for last-operation summaries, session/connection summaries, workspace timelines, failed replay templates, or debug bundles.",
      "Do not use /api/v1/control through public tunnel URLs unless the operator explicitly exposed the JSON API through a trusted private route.",
      "If an operation is blocked, inspect get_computer_info.scopes[].allowedOperations and get_computer_info.operationRegistry before retrying.",
      ...modeSpec.instructions,
    ],
    warnings,
  };
}

export function chatGptAppManifest(config: LocalPortConfig, mode: ChatGptProfileMode = "coding", options: ChatGptProfileOptions = {}): ChatGptAppManifest {
  const profile = chatGptConnectProfile(config, false, mode, options);
  return {
    kind: "chatgpt-app-manifest",
    schemaVersion: 1,
    mode,
    appName: profile.appManifest.appName,
    description: profile.description,
    appType: "remote-mcp",
    mcpServerUrl: profile.mcpServerUrl,
    auth: {
      preferred: "oauth",
      fallback: "bearer",
      scopes: profile.auth.oauth.scopes,
    },
    tools: profile.tools,
    firstPrompt: profile.setup.firstPrompt,
    warnings: profile.warnings,
  };
}

export function chatGptConnectorConfig(config: LocalPortConfig, includeSecrets = false, mode: ChatGptProfileMode = "coding", options: ChatGptProfileOptions = {}): ChatGptConnectorConfig {
  const profile = chatGptConnectProfile(config, includeSecrets, mode, options);
  return {
    kind: "chatgpt-connector-config",
    schemaVersion: 1,
    mode,
    displayName: profile.name,
    mcpServerUrl: profile.mcpServerUrl,
    connectionType: "Remote MCP",
    auth: {
      type: "oauth-or-bearer",
      oauthScopes: profile.auth.oauth.scopes,
      bearerHeader: profile.auth.bearer.header,
      alternateBearerHeader: profile.auth.bearer.alternateHeader,
    },
    setup: profile.setup,
    recommendedFlow: profile.recommendedFlow,
    modelGuide: profile.modelGuide,
    workflowRecipes: profile.workflowRecipes,
    gptInstructions: profile.gptInstructions,
    warnings: profile.warnings,
  };
}

export function localPublicBaseUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = publicHost.includes(":") && !publicHost.startsWith("[")
    ? `[${publicHost}]`
    : publicHost;
  return `http://${formattedHost}:${port}`;
}

function chatGptWarnings(config: LocalPortConfig, mcpServerUrl: string, mode: ChatGptProfileMode, options: ChatGptProfileOptions = {}): string[] {
  const warnings: string[] = [];
  if (!config.publicBaseUrl && !options.publicBaseUrl) {
    warnings.push("publicBaseUrl is not configured; ChatGPT cloud clients cannot reach the local fallback URL.");
  }
  if (options.publicBaseUrl && options.publicBaseUrl !== config.publicBaseUrl) {
    warnings.push("publicBaseUrl is overridden for this profile only; save it with `workspace-linker config set-public-url` before relying on OAuth discovery.");
  }

  let parsed: URL | undefined;
  try {
    parsed = new URL(mcpServerUrl);
  } catch {
    warnings.push("mcpServerUrl is not a valid URL.");
  }
  if (parsed && parsed.protocol !== "https:") {
    warnings.push("mcpServerUrl must use https:// for ChatGPT cloud clients.");
  }

  if (!config.ownerToken) {
    warnings.push("ownerToken is not configured; HTTP MCP is loopback-only and cannot be exposed safely.");
  }

  if (config.workspaces.length === 0) {
    warnings.push("No workspaces are configured.");
  }

  if (config.workspaces.some((workspace) => workspace.permissions.shell || workspace.permissions.codex)) {
    warnings.push("At least one workspace allows shell or Codex execution; run doctor and review security findings before public exposure.");
  }

  if (mode === "safe" && config.workspaces.some((workspace) => workspace.permissions.write || workspace.permissions.shell || workspace.permissions.codex)) {
    warnings.push("Safe mode was selected, but at least one workspace exposes write, shell, or Codex permissions; reduce workspace permissions for strict read-only use.");
  }

  if (mode === "full" && config.workspaces.some((workspace) => workspace.permissions.write || workspace.permissions.shell || workspace.permissions.codex)) {
    warnings.push("Full mode can expose write and local execution operations to ChatGPT; use it only for trusted private setups.");
  }

  return warnings;
}

function chatGptModelGuide(mode: ChatGptProfileMode): ChatGptModelGuide {
  const operationSelection = [
    { intent: "understand repository", op: "code.context", when: "before planning or editing" },
    { intent: "find text quickly", op: "file.search", when: "for broad code or content search; backed by fast local search when available" },
    { intent: "find code symbols", op: "code.search_symbols", when: "for functions, classes, exports, or definitions" },
    { intent: "read files", op: "file.read", when: "when bounded file content is needed" },
    { intent: "inspect git state", op: "git.status", when: "before and after changes" },
    { intent: "inspect diff", op: "git.diff", when: "before review, summary, or commit" },
    { intent: "review history", op: "history.last", when: "for what just happened; use get_operation_history for timeline, sessions, connections, failed_replay, or debug_bundle" },
  ];
  const guardrails = [
    "Only operate inside scopes returned by get_computer_info.",
    "Check allowedOperations and capabilityPolicy before write, shell, package, process, git write, or Codex operations.",
    "Prefer code.context, file.search, file.read, git.status, git.diff, and history.last before editing.",
    "Use get_operation_history view=last when the user asks what just happened, connections for tunnel/session correlation, and failed_replay or debug_bundle when a command failed.",
  ];
  if (mode === "safe") {
    guardrails.push("Stay read-only even if elevated operations appear in the registry.");
  } else if (mode === "full") {
    operationSelection.push(
      { intent: "create a new file safely", op: "file.create", when: "for new files only; it fails instead of overwriting existing paths" },
      { intent: "apply patches", op: "file.patch", when: "for targeted multi-line edits" },
      { intent: "run package scripts", op: "package.run", when: "for package.json scripts when package execution is allowed" },
      { intent: "run commands", op: "command.run", when: "for local verification when shell is allowed" },
      { intent: "start managed processes", op: "process.start", when: "for dev servers or watchers that should be inspected later" },
      { intent: "delegate coding to Codex", op: "codex.run", when: "for a bounded local Codex task when codex is allowed" },
    );
    guardrails.push("Ask before destructive deletes, broad moves, dependency installs, publishing, deployment, or external service changes.");
  } else {
    operationSelection.push(
      { intent: "create a new file safely", op: "file.create", when: "for new files only; it fails instead of overwriting existing paths" },
      { intent: "apply patches", op: "file.patch", when: "for targeted multi-line edits" },
      { intent: "delegate coding to Codex", op: "codex.run", when: "for a bounded local Codex task when codex is allowed" },
    );
    guardrails.push("Treat shell, package, process, and Codex operations as higher risk; prefer direct file/search/git inspection first.");
  }

  return {
    summary: "Workspace Linker exposes predefined scopes. Use computer_operation for file, search, git, shell, Codex, screen, and history work through the stable envelope: scope, op, target, input, options.",
    mcpEntrypoint: "computer_operation",
    jsonApiEntrypoint: {
      endpoint: "POST /api/v1/control",
      action: "computer_operation",
      availability: "local-or-trusted-private-only",
      publicTunnelDefault: "blocked-when-publicMcpOnly",
    },
    startupChecklist: [
      "Call get_computer_info.",
      "Choose a configured scope id.",
      "Call computer_operation with op=code.context, then get_operation_history with view=last.",
    ],
    operationSelection,
    guardrails,
  };
}

function chatGptWorkflowRecipes(mode: ChatGptProfileMode): ChatGptWorkflowRecipe[] {
  const base: ChatGptWorkflowRecipe[] = [
    {
      name: "connect_and_orient",
      purpose: "Verify the connector and build working context before answering.",
      steps: [
        { tool: "get_computer_info", why: "Read machine identity, scopes, operation registry, policy, and tunnel/auth state." },
        { tool: "computer_operation", input: { scope: "app", op: "code.context", target: ".", input: {}, options: { maxDepth: 2, maxEntries: 100 } }, why: "Get a bounded code-oriented map." },
        { tool: "get_operation_history", input: { scope: "app", view: "last", limit: 20 }, why: "See the last action, recent failure, and suggested next step." },
      ],
    },
    {
      name: "search_and_read",
      purpose: "Find relevant code without guessing paths.",
      steps: [
        { tool: "computer_operation", input: { scope: "app", op: "file.search", target: ".", input: { query: "TODO" }, options: { maxResults: 20 } }, why: "Use fast text search first." },
        { tool: "computer_operation", input: { scope: "app", op: "file.read", target: "README.md", input: {}, options: { maxBytes: 65536 } }, why: "Read bounded source context." },
      ],
    },
  ];

  if (mode !== "safe") {
    base.push({
      name: "implement_and_verify",
      purpose: "Make a scoped coding change and verify it.",
      steps: [
        { tool: "computer_operation", input: { scope: "app", op: "code.context", target: ".", input: {}, options: { maxDepth: 2, maxEntries: 100 } }, why: "Check scoped context before editing." },
        { tool: "computer_operation", input: { scope: "app", op: "file.patch", target: ".", input: { patch: "<valid patch generated from the planned edit>" }, options: {} }, why: "Apply targeted edits when allowed." },
        { tool: "computer_operation", input: { scope: "app", op: "package.run", target: ".", input: { script: "test" }, options: { timeoutSeconds: 600 } }, why: "Run the package verification command when shell is allowed." },
        { tool: "computer_operation", input: { scope: "app", op: "git.diff", target: ".", input: {}, options: { maxBytes: 65536 } }, why: "Review the final diff before summarizing." },
      ],
    });
  }

  if (mode === "coding" || mode === "full") {
    base.push({
      name: "codex_assisted_change",
      purpose: "Use Codex as a local coding agent when the workspace permits it.",
      steps: [
        { tool: "get_computer_info", why: "Confirm Codex operations are permitted before invoking local Codex." },
        { tool: "computer_operation", input: { scope: "app", op: "codex.run", target: ".", input: { prompt: "Inspect this workspace and propose the smallest safe implementation plan." }, options: { timeoutSeconds: 1800 } }, why: "Ask Codex for a bounded task." },
        { tool: "computer_operation", input: { scope: "app", op: "codex.list", target: ".", input: {}, options: { maxResults: 5 } }, why: "Inspect recent Codex run records when needed." },
      ],
    });
  }

  return base;
}

function chatGptModeSpec(mode: ChatGptProfileMode): {
  firstPrompt: string;
  verifyWith: string[];
  envelope: ChatGptConnectProfile["operationShape"]["envelope"];
  operationPurpose: string;
  flowInput: Record<string, unknown>;
  instructions: string[];
} {
  if (mode === "safe") {
    return {
      firstPrompt: "Call get_computer_info, choose the app scope if present, run computer_operation op=code.context, then call get_operation_history with view=last. Stay read-only.",
      verifyWith: [
        "get_computer_info",
        "computer_operation op=code.context",
        "get_operation_history view=last",
      ],
      envelope: {
        scope: "app",
        op: "file.search",
        target: ".",
        input: { query: "TODO", glob: "*.ts" },
        options: { maxResults: 20 },
      },
      operationPurpose: "Use the generic operation envelope for read-only file, search, and history actions.",
      flowInput: {
        scope: "app",
        op: "code.context",
        target: ".",
        input: {},
        options: { maxDepth: 2, maxEntries: 100 },
      },
      instructions: [
        "Stay read-only in safe mode: use code.context, code.search_symbols, file.list, file.read, file.search, git.status, git.diff, history.last, and get_operation_history.",
        "Do not call write, patch, delete, move, command, process, package, git write, or Codex operations in safe mode even when they appear in allowedOperations.",
      ],
    };
  }

  if (mode === "full") {
    return {
      firstPrompt: "Call get_computer_info, choose the app scope if present, run computer_operation op=code.context, then call get_operation_history with view=last. Use allowed write, shell, process, and Codex operations only when needed.",
      verifyWith: [
        "get_computer_info",
        "computer_operation op=code.context",
        "get_operation_history view=last",
      ],
      envelope: {
        scope: "app",
        op: "codex.run",
        target: ".",
        input: { prompt: "Inspect this workspace and propose the smallest safe implementation plan." },
        options: {},
      },
      operationPurpose: "Use the generic operation envelope for file, search, command, process, history, screen, and Codex workflows when allowed.",
      flowInput: {
        scope: "app",
        op: "code.context",
        target: ".",
        input: {},
        options: { maxDepth: 2, maxEntries: 100 },
      },
      instructions: [
        "Full mode may use write, command, process, and Codex operations only when allowedOperations includes the mapped operation.",
        "Ask before destructive file deletes, broad moves, git commits, long-running processes, or commands that install, publish, deploy, or modify external services.",
        "Use codex.run or codex.start only for trusted local coding tasks.",
        "After a Codex workflow, use codex.read or codex.list when you need stdout/stderr previews, exit metadata, or the stored change summary later.",
        "Use file.patch for edits when possible.",
      ],
    };
  }

  return {
    firstPrompt: "Call get_computer_info, choose the app scope if present, run computer_operation op=code.context, then call get_operation_history with view=last.",
    verifyWith: [
      "get_computer_info",
      "computer_operation op=code.context",
      "get_operation_history view=last",
    ],
    envelope: {
      scope: "app",
      op: "file.search",
      target: ".",
      input: { query: "TODO", glob: "*.ts" },
      options: { maxResults: 20 },
    },
    operationPurpose: "Use the generic operation envelope for file, search, command, history, and Codex actions.",
    flowInput: {
      scope: "app",
      op: "code.context",
      target: ".",
      input: {},
      options: { maxDepth: 2, maxEntries: 100 },
    },
    instructions: [
      "Coding mode may edit files, but should treat command, process, and Codex operations as higher-risk actions.",
      "Use codex.run or codex.start only for trusted local coding tasks.",
      "After a Codex workflow, use codex.read or codex.list when you need stdout/stderr previews, exit metadata, or the stored change summary later.",
      "Use file.patch for edits when possible.",
    ],
  };
}
