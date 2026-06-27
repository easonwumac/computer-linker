import { securityDiagnostics } from "./security.js";
import { listTunnelProcesses, tunnelDiagnostics, type TunnelProcessSnapshot } from "./tunnels.js";
import { chatGptConnectProfile, parseChatGptProfileMode } from "./profile.js";
import type { ChatGptProfileMode } from "./profile.js";
import type { LocalPortConfig } from "./permissions.js";
import { runWorkspaceLinkerMcpClientSmoke } from "./client-smoke.js";
import type { WorkspaceLinkerClientSmokeCheck } from "./client-smoke.js";
import { genericMcpTools } from "./mcp-surface.js";

export type ChatGptVerifyMode = ChatGptProfileMode;
export type ChatGptVerifyStatus = "pass" | "warn" | "fail";
export type ChatGptSetupWizardStatus = "ready" | "needs_action" | "blocked";
export type ChatGptSetupWizardStepStatus = "complete" | "current" | "blocked" | "pending";

export interface ChatGptVerifyCheck {
  id: string;
  status: ChatGptVerifyStatus;
  message: string;
  detail?: string;
}

export interface ChatGptVerifyReport {
  kind: "chatgpt-verify";
  schemaVersion: 1;
  mode: ChatGptVerifyMode;
  ready: boolean;
  mcpServerUrl: string;
  publicBaseUrl: string | null;
  authMode: "loopback-only" | "owner-token-or-oauth";
  tools: string[];
  checks: ChatGptVerifyCheck[];
  blockingReasons: string[];
  warnings: string[];
  nextActions: string[];
  recommendedProfileCommand: string;
  recommendedSmokeTest: string[];
}

export interface ChatGptUrlReport {
  kind: "chatgpt-url";
  schemaVersion: 1;
  ready: boolean;
  mcpServerUrl: string | null;
  publicBaseUrl: string | null;
  publicBaseUrlSource: "configured" | "running-tunnel" | null;
  configuredPublicBaseUrl: string | null;
  detectedPublicUrl: string | null;
  authHeader: string;
  warnings: string[];
  nextActions: string[];
}

export interface ChatGptUrlOptions {
  tunnels?: TunnelProcessSnapshot[];
}

export interface ChatGptSmokeCheck {
  id: string;
  status: ChatGptVerifyStatus;
  message: string;
  url?: string;
  statusCode?: number;
  detail?: string;
  durationMs?: number;
}

export interface ChatGptSmokeReport {
  kind: "chatgpt-smoke";
  schemaVersion: 1;
  ready: boolean;
  baseUrl: string | null;
  mcpServerUrl: string | null;
  authHeader: string;
  checks: ChatGptSmokeCheck[];
  blockingReasons: string[];
  warnings: string[];
  nextActions: string[];
}

export interface ChatGptSetupWizardStep {
  id: "owner_token" | "public_url" | "mcp_url" | "oauth" | "workspace" | "ready";
  label: string;
  status: ChatGptSetupWizardStepStatus;
  detail: string;
  action?: string;
}

export interface ChatGptSetupWizard {
  overallStatus: ChatGptSetupWizardStatus;
  currentStepId: ChatGptSetupWizardStep["id"] | null;
  effectiveMcpServerUrl: string | null;
  detectedPublicUrl: string | null;
  steps: ChatGptSetupWizardStep[];
}

export interface ChatGptSetupConnectProfile {
  appName: string;
  mode: ChatGptVerifyMode;
  connectionType: "Remote MCP";
  serverUrl: string;
  auth: {
    type: "oauth-or-bearer";
    bearerHeader: string | null;
    bearerTokenValue: "<ownerToken>" | null;
    bearerTokenSource: "owner-token-config" | null;
    oauthEnabled: boolean;
    oauthScopes: string[];
    oauthAuthorizationServerMetadataUrl: string | null;
    oauthProtectedResourceMetadataUrl: string | null;
  };
  ready: boolean;
  blockingReasons: string[];
  warnings: string[];
  nextActions: string[];
  firstPrompt: string;
  cli: {
    verify: string;
    profile: string;
    manifest: string;
    connectorConfig: string;
    files: string;
    localSmoke: string;
    publicSmoke: string | null;
  };
}

export interface ChatGptSetupStatus {
  kind: "chatgpt-setup-status";
  schemaVersion: 1;
  mode: ChatGptVerifyMode;
  ready: boolean;
  mcpServerUrl: string;
  publicBaseUrl: string | null;
  authMode: "loopback-only" | "owner-token-or-oauth";
  setupFields: {
    appName: string;
    connectionType: "Remote MCP";
    mcpServerUrl: string;
    authType: "oauth-or-bearer";
    bearerHeader: string | null;
    alternateBearerHeader: string | null;
  };
  oauthDiscovery: {
    enabled: boolean;
    issuer: string | null;
    authorizationServerMetadataUrl: string | null;
    protectedResourceMetadataUrl: string | null;
    resource: string | null;
    scopes: string[];
  };
  smoke: {
    localCli: string;
    publicCli: string | null;
  };
  cli: ChatGptSetupConnectProfile["cli"];
  connectProfile: ChatGptSetupConnectProfile;
  checks: ChatGptVerifyCheck[];
  blockingReasons: string[];
  warnings: string[];
  nextActions: string[];
  wizard: ChatGptSetupWizard;
}

export interface ChatGptSetupStatusOptions {
  tunnels?: TunnelProcessSnapshot[];
}

export interface ChatGptSmokeOptions {
  url?: string;
  token?: string;
  includeSecret?: boolean;
  allowHttp?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const CHATGPT_TOOLS: string[] = [...genericMcpTools];

export function chatGptVerify(config: LocalPortConfig, mode: ChatGptVerifyMode = "safe"): ChatGptVerifyReport {
  const profile = chatGptConnectProfile(config, false, mode);
  const checks: ChatGptVerifyCheck[] = [];
  const security = securityDiagnostics(config);
  const tunnel = tunnelDiagnostics({
    localPort: config.port ?? 3939,
    publicBaseUrl: config.publicBaseUrl,
    tunnels: listTunnelProcesses(),
  });

  checks.push(publicBaseUrlCheck(config.publicBaseUrl));
  checks.push(mcpUrlCheck(profile.mcpServerUrl));
  checks.push(ownerTokenCheck(config));
  checks.push(workspaceCheck(config));
  checks.push(toolSurfaceCheck(profile.tools));
  checks.push(modePermissionCheck(config, mode));

  for (const finding of security) {
    checks.push({
      id: `security:${finding.id}`,
      status: finding.severity === "critical" ? "fail" : "warn",
      message: finding.title,
      detail: finding.workspaceId ? `${finding.workspaceId}: ${finding.detail}` : finding.detail,
    });
  }

  if (!config.publicBaseUrl && tunnel.tools.every((tool) => !tool.available)) {
    checks.push({
      id: "tunnel-tool",
      status: "warn",
      message: "No built-in tunnel provider was detected.",
      detail: "Install cloudflared or tailscale, use another HTTPS reverse proxy, or use OpenAI Secure MCP Tunnel from ChatGPT connector settings.",
    });
  }

  const blockingReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.message}`);
  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => `${check.id}: ${check.message}`);

  return {
    kind: "chatgpt-verify",
    schemaVersion: 1,
    mode,
    ready: blockingReasons.length === 0,
    mcpServerUrl: profile.mcpServerUrl,
    publicBaseUrl: config.publicBaseUrl ?? null,
    authMode: config.ownerToken ? "owner-token-or-oauth" : "loopback-only",
    tools: profile.tools,
    checks,
    blockingReasons,
    warnings,
    nextActions: chatGptNextActions(blockingReasons, warnings, mode),
    recommendedProfileCommand: "computer-linker client chatgpt profile --show-token",
    recommendedSmokeTest: [
      "get_computer_info",
      "computer_operation op=code.context",
      "get_operation_history view=last",
    ],
  };
}

export function chatGptSetupStatus(config: LocalPortConfig, mode: ChatGptVerifyMode = "coding", options: ChatGptSetupStatusOptions = {}): ChatGptSetupStatus {
  const detectedPublicUrl = runningTunnelPublicUrl(options.tunnels);
  const effectivePublicBaseUrl = chatGptPublicBaseUrl(config, options.tunnels);
  const effectiveConfig = effectivePublicBaseUrl ? { ...config, publicBaseUrl: effectivePublicBaseUrl } : config;
  const verify = chatGptVerify(effectiveConfig, mode);
  const profile = chatGptConnectProfile(effectiveConfig, false, mode);
  const effectiveMcpServerUrl = chatGptMcpServerUrl(config, options.tunnels) ?? verify.mcpServerUrl;
  const origin = urlOrigin(effectiveMcpServerUrl);
  const configuredOrigin = config.publicBaseUrl ? urlOrigin(new URL("/mcp", config.publicBaseUrl).href) : null;
  const oauthEnabled = Boolean(config.ownerToken && config.publicBaseUrl && origin && origin === configuredOrigin);
  const warnings = [...verify.warnings];
  if (detectedPublicUrl && detectedPublicUrl !== config.publicBaseUrl) {
    warnings.push("detected tunnel URL is used for this setup only; save it as publicBaseUrl before relying on OAuth discovery.");
  }
  const publicUrlArg = effectivePublicBaseUrl ? ` --url ${effectivePublicBaseUrl}` : "";
  const localBaseUrl = `http://${config.host ?? "127.0.0.1"}:${config.port ?? 3939}`;
  const cliCommands = {
    verify: `computer-linker client chatgpt verify --mode ${mode}`,
    profile: `computer-linker client chatgpt profile --mode ${mode}${publicUrlArg} --show-token`,
    manifest: `computer-linker client chatgpt manifest --mode ${mode}${publicUrlArg}`,
    connectorConfig: `computer-linker client chatgpt connector --mode ${mode}${publicUrlArg} --show-token`,
    files: `computer-linker client chatgpt files ./chatgpt-config --mode ${mode}${publicUrlArg} --show-token`,
    localSmoke: `computer-linker client chatgpt smoke --allow-http --url ${localBaseUrl}`,
    publicSmoke: effectivePublicBaseUrl ? `computer-linker client chatgpt smoke --url ${effectivePublicBaseUrl}` : null,
  };
  const setupFields = {
    appName: profile.appManifest.appName,
    connectionType: profile.setup.connectionType,
    mcpServerUrl: effectiveMcpServerUrl,
    authType: profile.appManifest.authType,
    bearerHeader: profile.auth.bearer.header,
    alternateBearerHeader: profile.auth.bearer.alternateHeader,
  };
  const oauthDiscovery = {
    enabled: oauthEnabled,
    issuer: oauthEnabled ? new URL("/", origin).href : null,
    authorizationServerMetadataUrl: oauthEnabled ? new URL("/.well-known/oauth-authorization-server", origin).href : null,
    protectedResourceMetadataUrl: oauthEnabled ? new URL("/.well-known/oauth-protected-resource/mcp", origin).href : null,
    resource: oauthEnabled ? effectiveMcpServerUrl : null,
    scopes: profile.auth.oauth.scopes,
  };

  return {
    kind: "chatgpt-setup-status",
    schemaVersion: 1,
    mode,
    ready: verify.ready,
    mcpServerUrl: effectiveMcpServerUrl,
    publicBaseUrl: verify.publicBaseUrl,
    authMode: verify.authMode,
    setupFields,
    oauthDiscovery,
    smoke: {
      localCli: cliCommands.localSmoke,
      publicCli: cliCommands.publicSmoke,
    },
    cli: cliCommands,
    connectProfile: {
      appName: setupFields.appName,
      mode,
      connectionType: setupFields.connectionType,
      serverUrl: effectiveMcpServerUrl,
      auth: {
        type: setupFields.authType,
        bearerHeader: setupFields.bearerHeader,
        bearerTokenValue: config.ownerToken ? "<ownerToken>" : null,
        bearerTokenSource: config.ownerToken ? "owner-token-config" : null,
        oauthEnabled,
        oauthScopes: oauthDiscovery.scopes,
        oauthAuthorizationServerMetadataUrl: oauthDiscovery.authorizationServerMetadataUrl,
        oauthProtectedResourceMetadataUrl: oauthDiscovery.protectedResourceMetadataUrl,
      },
      ready: verify.ready,
      blockingReasons: verify.blockingReasons,
      warnings,
      nextActions: verify.nextActions,
      firstPrompt: profile.setup.firstPrompt,
      cli: cliCommands,
    },
    checks: verify.checks,
    blockingReasons: verify.blockingReasons,
    warnings,
    nextActions: verify.nextActions,
    wizard: chatGptSetupWizard(config, verify, {
      detectedPublicUrl,
      effectiveMcpServerUrl,
      oauthEnabled,
    }),
  };
}

export function parseChatGptVerifyMode(value: string | undefined): ChatGptVerifyMode {
  return parseChatGptProfileMode(value ?? "safe", "client chatgpt verify --mode");
}

export function chatGptPublicBaseUrl(config: Pick<LocalPortConfig, "publicBaseUrl">, tunnels: TunnelProcessSnapshot[] = []): string | undefined {
  return tunnels
    .filter((tp) => tp.status === "running")
    .map((tp) => tp.publicUrl)
    .find((url): url is string => Boolean(url)) ?? config.publicBaseUrl;
}

export function chatGptMcpServerUrl(config: Pick<LocalPortConfig, "publicBaseUrl">, tunnels: TunnelProcessSnapshot[] = []): string | undefined {
  const publicOrigin = chatGptPublicBaseUrl(config, tunnels);
  return publicOrigin ? new URL("/mcp", publicOrigin).href : undefined;
}

function runningTunnelPublicUrl(tunnels: TunnelProcessSnapshot[] | undefined): string | null {
  return tunnels
    ?.filter((tp) => tp.status === "running")
    .map((tp) => tp.publicUrl)
    .find((url): url is string => Boolean(url)) ?? null;
}

function chatGptSetupWizard(
  config: LocalPortConfig,
  verify: ChatGptVerifyReport,
  urls: { detectedPublicUrl: string | null; effectiveMcpServerUrl: string | null; oauthEnabled: boolean },
): ChatGptSetupWizard {
  const hasOwnerToken = Boolean(config.ownerToken);
  const hasConfiguredPublicUrl = Boolean(config.publicBaseUrl);
  const configuredPublicUrlIsHttps = Boolean(config.publicBaseUrl?.startsWith("https://"));
  const effectivePublicUrlIsHttps = Boolean(urls.effectiveMcpServerUrl?.startsWith("https://"));
  const effectiveMcpIsHttps = Boolean(urls.effectiveMcpServerUrl?.startsWith("https://"));
  const hasWorkspace = config.workspaces.length > 0;
  const oauthReady = urls.oauthEnabled;

  const steps: ChatGptSetupWizardStep[] = [
    {
      id: "owner_token",
      label: "Owner token",
      status: hasOwnerToken ? "complete" : "blocked",
      detail: hasOwnerToken ? "Owner token is configured for bearer/OAuth access." : "Owner token is required before exposing this machine.",
      action: hasOwnerToken ? undefined : "Run `computer-linker init`.",
    },
    {
      id: "public_url",
      label: "Public HTTPS URL",
      status: effectivePublicUrlIsHttps ? "complete" : urls.detectedPublicUrl ? "current" : hasOwnerToken ? "blocked" : "pending",
      detail: configuredPublicUrlIsHttps
        ? `Configured public URL: ${config.publicBaseUrl}`
        : urls.detectedPublicUrl
          ? `Using detected tunnel URL: ${urls.detectedPublicUrl}. Save it as publicBaseUrl for OAuth and stable reuse.`
          : "No configured public HTTPS URL was found.",
      action: configuredPublicUrlIsHttps
        ? undefined
        : urls.detectedPublicUrl
          ? `Optional: run \`computer-linker config set-public-url ${urls.detectedPublicUrl}\` to save it for OAuth and stable reuse.`
          : "For first setup, run `computer-linker start <workspace-path> --tunnel tailscale`; for Cloudflare/custom hostnames, pass `--url https://... --tunnel cloudflare`; for ChatGPT Tunnel mode, use `computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_...`.",
    },
    {
      id: "mcp_url",
      label: "MCP server URL",
      status: effectiveMcpIsHttps ? "complete" : hasConfiguredPublicUrl ? "blocked" : "pending",
      detail: urls.effectiveMcpServerUrl ? `MCP URL: ${urls.effectiveMcpServerUrl}` : "No MCP URL is available yet.",
      action: effectiveMcpIsHttps ? undefined : "Use an HTTPS tunnel origin with `/mcp`.",
    },
    {
      id: "oauth",
      label: "OAuth metadata",
      status: oauthReady ? "complete" : hasOwnerToken && configuredPublicUrlIsHttps ? "blocked" : "pending",
      detail: oauthReady ? "OAuth discovery metadata is available from the public origin." : "OAuth metadata needs both owner token and saved publicBaseUrl. Bearer auth can still use a detected tunnel URL.",
      action: oauthReady ? undefined : "Configure owner token and publicBaseUrl before using OAuth discovery.",
    },
    {
      id: "workspace",
      label: "Workspace boundary",
      status: hasWorkspace ? "complete" : "blocked",
      detail: hasWorkspace ? `${config.workspaces.length} predefined workspace(s) configured.` : "At least one predefined workspace is required.",
      action: hasWorkspace ? undefined : "Run `computer-linker setup <workspace-path>`.",
    },
    {
      id: "ready",
      label: "Ready check",
      status: verify.ready ? "complete" : "pending",
      detail: verify.ready ? "Ready to connect from ChatGPT." : `Not ready: ${verify.blockingReasons[0] ?? "review checks"}`,
      action: verify.ready ? "Run `computer-linker client chatgpt smoke`, then connect ChatGPT." : verify.nextActions[0],
    },
  ];
  const current = verify.ready
    ? null
    : steps.find((step) => step.status === "blocked" || step.status === "current")
      ?? steps.find((step) => step.status === "pending")
      ?? null;
  return {
    overallStatus: verify.ready ? "ready" : steps.some((step) => step.status === "blocked") ? "blocked" : "needs_action",
    currentStepId: current?.id ?? null,
    effectiveMcpServerUrl: urls.effectiveMcpServerUrl,
    detectedPublicUrl: urls.detectedPublicUrl,
    steps,
  };
}

export function chatGptUrl(config: LocalPortConfig, includeSecret = false, options: ChatGptUrlOptions = {}): ChatGptUrlReport {
  const detectedPublicUrl = chatGptDetectedPublicBaseUrl(options.tunnels ?? []);
  const publicBaseUrl = chatGptPublicBaseUrl(config, options.tunnels);
  const publicBaseUrlSource = detectedPublicUrl && publicBaseUrl === detectedPublicUrl
    ? "running-tunnel"
    : config.publicBaseUrl ? "configured" : null;
  const mcpServerUrl = publicBaseUrl ? new URL("/mcp", publicBaseUrl).href : undefined;
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (!mcpServerUrl) {
    warnings.push("No public HTTPS MCP URL is configured.");
    nextActions.push("For first setup, run `computer-linker start <workspace-path> --tunnel tailscale` to auto-save a Funnel URL; for Cloudflare/custom hostnames, pass `--url https://... --tunnel cloudflare`; for ChatGPT Tunnel mode, use `computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_...`.");
  } else if (!mcpServerUrl.startsWith("https://")) {
    warnings.push("ChatGPT requires an https:// MCP URL.");
    nextActions.push("Use an HTTPS tunnel origin, then run `computer-linker config set-public-url https://...`.");
  }

  if (!config.ownerToken) {
    warnings.push("ownerToken is not configured.");
    nextActions.push("Run `computer-linker init` before exposing Computer Linker to ChatGPT.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Paste the MCP URL into ChatGPT custom MCP app setup and use the Authorization bearer token.");
  }

  return {
    kind: "chatgpt-url",
    schemaVersion: 1,
    ready: Boolean(mcpServerUrl?.startsWith("https://") && config.ownerToken),
    mcpServerUrl: mcpServerUrl ?? null,
    publicBaseUrl: publicBaseUrl ?? null,
    publicBaseUrlSource,
    configuredPublicBaseUrl: config.publicBaseUrl ?? null,
    detectedPublicUrl: detectedPublicUrl ?? null,
    authHeader: config.ownerToken && includeSecret ? `Authorization: Bearer ${config.ownerToken}` : "Authorization: Bearer <ownerToken>",
    warnings,
    nextActions,
  };
}

function chatGptDetectedPublicBaseUrl(tunnels: TunnelProcessSnapshot[]): string | undefined {
  return tunnels
    .filter((tp) => tp.status === "running")
    .map((tp) => tp.publicUrl)
    .find((url): url is string => Boolean(url));
}

export function formatChatGptUrl(report: ChatGptUrlReport): string {
  return [
    "Computer Linker ChatGPT URL",
    `ready: ${report.ready ? "yes" : "no"}`,
    `mcpServerUrl: ${report.mcpServerUrl ?? "not configured"}`,
    `publicBaseUrl: ${report.publicBaseUrl ?? "not detected"}`,
    `publicBaseUrlSource: ${report.publicBaseUrlSource ?? "none"}`,
    `authHeader: ${report.authHeader}`,
    ...(report.warnings.length ? ["warnings:", ...report.warnings.map((warning) => `  - ${warning}`)] : []),
    "next actions:",
    ...report.nextActions.map((action) => `  - ${action}`),
  ].join("\n") + "\n";
}

export async function chatGptSmoke(config: LocalPortConfig, options: ChatGptSmokeOptions = {}): Promise<ChatGptSmokeReport> {
  const clientSmoke = await runWorkspaceLinkerMcpClientSmoke(config, {
    url: options.url,
    token: options.token,
    includeSecret: options.includeSecret,
    allowHttp: options.allowHttp,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    clientName: "computer-linker-smoke",
  });
  const checks = clientSmoke.checks.map(chatGptSmokeCheck);
  const blockingReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.message}`);
  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => `${check.id}: ${check.message}`);

  return {
    kind: "chatgpt-smoke",
    schemaVersion: 1,
    ready: blockingReasons.length === 0,
    baseUrl: clientSmoke.baseUrl,
    mcpServerUrl: clientSmoke.mcpServerUrl,
    authHeader: clientSmoke.authHeader === "none" ? "Authorization: Bearer <ownerToken>" : clientSmoke.authHeader,
    checks,
    blockingReasons,
    warnings,
    nextActions: chatGptSmokeNextActions(blockingReasons, warnings),
  };
}

function chatGptSmokeCheck(check: WorkspaceLinkerClientSmokeCheck): ChatGptSmokeCheck {
  return {
    ...check,
    id: check.id === "api-capabilities" ? "capabilities" : check.id,
    message: chatGptSmokeText(check.message),
  };
}

function chatGptSmokeText(value: string): string {
  return value
    .replaceAll("MCP client smoke URL", "ChatGPT smoke URL")
    .replaceAll("MCP client smoke testing", "ChatGPT smoke testing")
    .replaceAll("cloud MCP client", "ChatGPT")
    .replaceAll("MCP client setup", "ChatGPT custom MCP app setup");
}

export function formatChatGptSmoke(report: ChatGptSmokeReport): string {
  return [
    "Computer Linker ChatGPT smoke",
    `ready: ${report.ready ? "yes" : "no"}`,
    `baseUrl: ${report.baseUrl ?? "not configured"}`,
    `mcpServerUrl: ${report.mcpServerUrl ?? "not configured"}`,
    `authHeader: ${report.authHeader}`,
    "checks:",
    ...report.checks.map((check) => `  [${check.status}] ${check.id}: ${check.message}${check.statusCode ? ` (${check.statusCode})` : ""}${check.durationMs !== undefined ? ` ${check.durationMs}ms` : ""}`),
    "next actions:",
    ...report.nextActions.map((action) => `  - ${action}`),
  ].join("\n") + "\n";
}

export function formatChatGptVerify(report: ChatGptVerifyReport): string {
  return [
    `Computer Linker ChatGPT verify (${report.mode})`,
    `ready: ${report.ready ? "yes" : "no"}`,
    `mcpServerUrl: ${report.mcpServerUrl}`,
    `auth: ${report.authMode}`,
    "checks:",
    ...report.checks.map((check) => `  [${check.status}] ${check.id}: ${check.message}${check.detail ? ` (${check.detail})` : ""}`),
    "next actions:",
    ...report.nextActions.map((action) => `  - ${action}`),
  ].join("\n") + "\n";
}

function chatGptSmokeNextActions(blockingReasons: string[], warnings: string[]): string[] {
  const actions = new Set<string>();
  if (blockingReasons.some((reason) => reason.includes("base-url"))) {
    actions.add("Set publicBaseUrl or rerun with `--url https://...`; use `--allow-http` only for local testing.");
  }
  if (blockingReasons.some((reason) => reason.includes("auth"))) {
    actions.add("Run `computer-linker init` or pass `--token <ownerToken>` for the smoke test.");
  }
  if (blockingReasons.some((reason) => reason.includes("capabilities") || reason.includes("mcp-") || reason.includes("healthz"))) {
    actions.add("Confirm the HTTP server is running and the tunnel routes to this machine.");
  }
  if (warnings.some((warning) => warning.includes("HTTP URL"))) {
    actions.add("Use an HTTPS tunnel URL before configuring ChatGPT cloud access.");
  }
  if (actions.size === 0) {
    actions.add("Use the MCP server URL and Authorization bearer token in ChatGPT custom MCP app setup.");
  }
  return [...actions];
}

function publicBaseUrlCheck(publicBaseUrl: string | undefined): ChatGptVerifyCheck {
  if (!publicBaseUrl) {
    return {
      id: "public-base-url",
      status: "fail",
      message: "publicBaseUrl is required for ChatGPT cloud access.",
      detail: "Run `computer-linker config set-public-url https://...` after configuring a tunnel.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(publicBaseUrl);
  } catch {
    return {
      id: "public-base-url",
      status: "fail",
      message: "publicBaseUrl must be a valid URL.",
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      id: "public-base-url",
      status: "fail",
      message: "publicBaseUrl must use https:// for ChatGPT.",
    };
  }
  return {
    id: "public-base-url",
    status: "pass",
    message: "publicBaseUrl is configured with HTTPS.",
  };
}

function mcpUrlCheck(mcpServerUrl: string): ChatGptVerifyCheck {
  try {
    const parsed = new URL(mcpServerUrl);
    if (parsed.protocol !== "https:") {
      return {
        id: "mcp-url",
        status: "fail",
        message: "MCP server URL must use https://.",
      };
    }
    if (!parsed.pathname.endsWith("/mcp")) {
      return {
        id: "mcp-url",
        status: "warn",
        message: "MCP server URL should end with /mcp.",
      };
    }
  } catch {
    return {
      id: "mcp-url",
      status: "fail",
      message: "MCP server URL is invalid.",
    };
  }
  return {
    id: "mcp-url",
    status: "pass",
    message: "MCP server URL is valid for ChatGPT setup.",
  };
}

function ownerTokenCheck(config: LocalPortConfig): ChatGptVerifyCheck {
  return config.ownerToken
    ? {
        id: "auth",
        status: "pass",
        message: "ownerToken is configured; OAuth/bearer HTTP auth can be enabled.",
      }
    : {
        id: "auth",
        status: "fail",
        message: "ownerToken is required before exposing Computer Linker to ChatGPT.",
        detail: "Run `computer-linker init` or set COMPUTER_LINKER_OWNER_TOKEN.",
      };
}

function workspaceCheck(config: LocalPortConfig): ChatGptVerifyCheck {
  if (config.workspaces.length === 0) {
    return {
      id: "workspaces",
      status: "fail",
      message: "At least one predefined workspace is required.",
    };
  }
  return {
    id: "workspaces",
    status: "pass",
    message: `${config.workspaces.length} workspace(s) configured.`,
  };
}

function toolSurfaceCheck(tools: string[]): ChatGptVerifyCheck {
  const missing = CHATGPT_TOOLS.filter((tool) => !tools.includes(tool));
  const extra = tools.filter((tool) => !CHATGPT_TOOLS.includes(tool));
  if (missing.length > 0 || extra.length > 0) {
    return {
      id: "tool-surface",
      status: "fail",
      message: "ChatGPT tool surface must stay minimal and predictable.",
      detail: `missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`,
    };
  }
  return {
    id: "tool-surface",
    status: "pass",
    message: "The expected MCP tools are exposed.",
  };
}

function modePermissionCheck(config: LocalPortConfig, mode: ChatGptVerifyMode): ChatGptVerifyCheck {
  const writeCount = config.workspaces.filter((workspace) => workspace.permissions.write).length;
  const shellCount = config.workspaces.filter((workspace) => workspace.permissions.shell).length;
  const codexCount = config.workspaces.filter((workspace) => workspace.permissions.codex).length;

  if (mode === "safe" && (writeCount > 0 || shellCount > 0 || codexCount > 0)) {
    return {
      id: "mode-permissions",
      status: "fail",
      message: "Safe mode requires read/search/history/git-read style workspaces only.",
      detail: `write=${writeCount} shell=${shellCount} codex=${codexCount}`,
    };
  }
  if (mode === "coding" && (shellCount > 0 || codexCount > 0)) {
    return {
      id: "mode-permissions",
      status: "warn",
      message: "Coding mode can use broad local execution, but shell/Codex should be reviewed before ChatGPT access.",
      detail: `write=${writeCount} shell=${shellCount} codex=${codexCount}`,
    };
  }
  if (mode === "full" && (writeCount > 0 || shellCount > 0 || codexCount > 0)) {
    return {
      id: "mode-permissions",
      status: "warn",
      message: "Full mode exposes write and/or local execution capabilities.",
      detail: `write=${writeCount} shell=${shellCount} codex=${codexCount}`,
    };
  }
  return {
    id: "mode-permissions",
    status: "pass",
    message: `${mode} mode permissions are acceptable.`,
    detail: `write=${writeCount} shell=${shellCount} codex=${codexCount}`,
  };
}

function chatGptNextActions(blockingReasons: string[], warnings: string[], mode: ChatGptVerifyMode): string[] {
  const actions = new Set<string>();
  if (blockingReasons.some((reason) => reason.includes("public-base-url"))) {
    actions.add("For first setup, run `computer-linker start <workspace-path> --tunnel tailscale` to auto-save a Funnel URL; for Cloudflare/custom hostnames, pass `--url https://... --tunnel cloudflare`; for OpenAI Secure MCP Tunnel, use `computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_...`.");
  }
  if (blockingReasons.some((reason) => reason.includes("auth"))) {
    actions.add("Run `computer-linker init` to generate an owner token before exposing the MCP server.");
  }
  if (blockingReasons.some((reason) => reason.includes("mode-permissions")) && mode === "safe") {
    actions.add("Create a read-only workspace profile or rerun with `--mode coding` after reviewing write/shell/Codex permissions.");
  }
  if (warnings.some((warning) => warning.includes("mode-permissions"))) {
    actions.add("Review workspace permissions and only expose shell/Codex to ChatGPT when you intend broad local execution.");
  }
  if (actions.size === 0) {
    actions.add("Run `computer-linker client chatgpt profile --show-token` and use the MCP URL in ChatGPT developer mode.");
  }
  return [...actions];
}

function urlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
