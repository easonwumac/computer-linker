import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LocalPortConfig } from "./permissions.js";

export type WorkspaceLinkerClientSmokeStatus = "pass" | "warn" | "fail";
export type WorkspaceLinkerClientSmokeCheckId =
  | "base-url"
  | "auth"
  | "healthz"
  | "api-capabilities"
  | "api-computer-info"
  | "api-read-only-operation"
  | "mcp-initialize"
  | "mcp-list-tools"
  | "mcp-get-computer-info"
  | "mcp-read-only-operation"
  | "mcp-operation-history";

export interface WorkspaceLinkerClientSmokeCheck {
  id: WorkspaceLinkerClientSmokeCheckId;
  status: WorkspaceLinkerClientSmokeStatus;
  message: string;
  url?: string;
  statusCode?: number;
  detail?: string;
  durationMs?: number;
}

export interface WorkspaceLinkerClientSmokeOptions {
  timeoutMs?: number;
  includeSecret?: boolean;
}

export interface WorkspaceLinkerMcpClientSmokeOptions extends WorkspaceLinkerClientSmokeOptions {
  url?: string;
  token?: string;
  allowHttp?: boolean;
  clientName?: string;
  fetchImpl?: typeof fetch;
}

export interface WorkspaceLinkerSdkClientSmokeOptions extends WorkspaceLinkerClientSmokeOptions {
  apiBaseUrl: URL;
  ownerToken?: string;
  fetchImpl: typeof fetch;
}

export interface WorkspaceLinkerClientSmokeReport {
  kind: "workspace-linker-client-smoke";
  schemaVersion: 1;
  ready: boolean;
  baseUrl: string | null;
  apiBaseUrl: string | null;
  mcpServerUrl: string | null;
  authHeader: string;
  checks: WorkspaceLinkerClientSmokeCheck[];
  blockingReasons: string[];
  warnings: string[];
  nextActions: string[];
}

export async function runWorkspaceLinkerMcpClientSmoke(
  config: Pick<LocalPortConfig, "host" | "port" | "ownerToken" | "publicBaseUrl">,
  options: WorkspaceLinkerMcpClientSmokeOptions = {},
): Promise<WorkspaceLinkerClientSmokeReport> {
  const checks: WorkspaceLinkerClientSmokeCheck[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const token = options.token ?? config.ownerToken;
  let baseUrl: URL | undefined;

  try {
    baseUrl = smokeBaseUrl(config, options.url);
  } catch (error) {
    checks.push({
      id: "base-url",
      status: "fail",
      message: "Smoke URL must be a valid URL.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (!baseUrl && !checks.some((check) => check.id === "base-url")) {
    checks.push({
      id: "base-url",
      status: "fail",
      message: "No URL was provided and publicBaseUrl is not configured.",
      detail: "Use --url https://... or run config set-public-url first.",
    });
  } else if (baseUrl && !options.allowHttp && baseUrl.protocol !== "https:") {
    checks.push({
      id: "base-url",
      status: "fail",
      message: "MCP client smoke URL must use https://.",
      url: baseUrl.href,
      detail: "Use --allow-http only for local loopback testing.",
    });
  } else if (baseUrl) {
    checks.push({
      id: "base-url",
      status: options.allowHttp && baseUrl.protocol === "http:" ? "warn" : "pass",
      message: options.allowHttp && baseUrl.protocol === "http:"
        ? "HTTP URL accepted for local smoke testing only."
        : "Base URL is usable for MCP client smoke testing.",
      url: baseUrl.href,
    });
  }

  if (!token) {
    checks.push({
      id: "auth",
      status: "fail",
      message: "ownerToken is required for authenticated API and MCP smoke tests.",
    });
  } else {
    checks.push({
      id: "auth",
      status: "pass",
      message: "Bearer token is available.",
    });
  }

  const localHttpSmoke = Boolean(baseUrl && options.allowHttp && baseUrl.protocol === "http:");
  if (baseUrl && !checks.some((check) => check.status === "fail" && (check.id === "base-url" || check.id === "auth"))) {
    if (localHttpSmoke) {
      const apiBaseUrl = new URL("api/v1/", baseUrl);
      checks.push(await smokeGet(fetchImpl, new URL("healthz", baseUrl), "healthz", undefined, timeoutMs));
      checks.push(await smokeGet(fetchImpl, new URL("capabilities", apiBaseUrl), "api-capabilities", token, timeoutMs));
      const computerInfo = await smokeComputerInfo(fetchImpl, apiBaseUrl, token, timeoutMs);
      checks.push(computerInfo.check);
      checks.push(await smokeReadOnlyOperation(fetchImpl, apiBaseUrl, token, computerInfo.data, timeoutMs));
    }
    checks.push(...await smokeMcpToolFlow(fetchImpl, new URL("mcp", baseUrl), token, timeoutMs, options.clientName ?? "workspace-linker-client-smoke"));
  }

  return finalizeSmokeReport({
    baseUrl: baseUrl?.href ?? null,
    apiBaseUrl: baseUrl && localHttpSmoke ? new URL("api/v1/", baseUrl).href : null,
    mcpServerUrl: baseUrl ? new URL("mcp", baseUrl).href : null,
    authHeader: token && options.includeSecret ? `Authorization: Bearer ${token}` : token ? "Authorization: Bearer <ownerToken>" : "none",
    checks,
    publicMode: true,
  });
}

export async function runWorkspaceLinkerSdkClientSmoke(
  options: WorkspaceLinkerSdkClientSmokeOptions,
): Promise<WorkspaceLinkerClientSmokeReport> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const serviceRoot = serviceRootUrlFromApiBaseUrl(options.apiBaseUrl);
  const mcpServerUrl = new URL("mcp", serviceRoot);
  const checks = [
    await smokeGet(options.fetchImpl, new URL("healthz", serviceRoot), "healthz", undefined, timeoutMs),
    await smokeGet(options.fetchImpl, new URL("capabilities", options.apiBaseUrl), "api-capabilities", options.ownerToken, timeoutMs),
  ];
  const computerInfo = await smokeComputerInfo(options.fetchImpl, options.apiBaseUrl, options.ownerToken, timeoutMs);
  checks.push(computerInfo.check);
  checks.push(await smokeReadOnlyOperation(options.fetchImpl, options.apiBaseUrl, options.ownerToken, computerInfo.data, timeoutMs));
  checks.push(...await smokeMcpToolFlow(options.fetchImpl, mcpServerUrl, options.ownerToken, timeoutMs, "workspace-linker-sdk-smoke"));

  return finalizeSmokeReport({
    baseUrl: serviceRoot.href,
    apiBaseUrl: options.apiBaseUrl.href,
    mcpServerUrl: mcpServerUrl.href,
    authHeader: options.ownerToken
      ? options.includeSecret ? `Authorization: Bearer ${options.ownerToken}` : "Authorization: Bearer <ownerToken>"
      : "none",
    checks,
    publicMode: false,
  });
}

export function formatWorkspaceLinkerClientSmoke(report: WorkspaceLinkerClientSmokeReport): string {
  return [
    "Workspace Linker MCP client smoke",
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

function finalizeSmokeReport(input: {
  baseUrl: string | null;
  apiBaseUrl: string | null;
  mcpServerUrl: string | null;
  authHeader: string;
  checks: WorkspaceLinkerClientSmokeCheck[];
  publicMode: boolean;
}): WorkspaceLinkerClientSmokeReport {
  const blockingReasons = input.checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.message}`);
  const warnings = input.checks
    .filter((check) => check.status === "warn")
    .map((check) => `${check.id}: ${check.message}`);

  return {
    kind: "workspace-linker-client-smoke",
    schemaVersion: 1,
    ready: blockingReasons.length === 0,
    baseUrl: input.baseUrl,
    apiBaseUrl: input.apiBaseUrl,
    mcpServerUrl: input.mcpServerUrl,
    authHeader: input.authHeader,
    checks: input.checks,
    blockingReasons,
    warnings,
    nextActions: smokeNextActions(blockingReasons, warnings, input.publicMode),
  };
}

function smokeBaseUrl(config: Pick<LocalPortConfig, "publicBaseUrl">, value: string | undefined): URL | undefined {
  const raw = value ?? config.publicBaseUrl;
  if (!raw) return undefined;
  const parsed = new URL(raw);
  return new URL(parsed.origin);
}

function serviceRootUrlFromApiBaseUrl(apiBaseUrl: URL): URL {
  const root = new URL(apiBaseUrl.href);
  const path = root.pathname.replace(/\/+$/, "");
  const apiSuffix = "/api/v1";
  if (path.endsWith(apiSuffix)) {
    const rootPath = path.slice(0, -apiSuffix.length) || "/";
    root.pathname = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  } else {
    root.pathname = "/";
  }
  root.search = "";
  root.hash = "";
  return root;
}

async function smokeGet(
  fetchImpl: typeof fetch,
  url: URL,
  id: WorkspaceLinkerClientSmokeCheckId,
  token: string | undefined,
  timeoutMs: number,
): Promise<WorkspaceLinkerClientSmokeCheck> {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }, timeoutMs);
    const text = await response.text();
    const apiPayloadInvalid = id === "api-capabilities" && !jsonApiPayloadSucceeded(text);
    if (!response.ok || apiPayloadInvalid) {
      return {
        id,
        status: "fail",
        message: apiPayloadInvalid
          ? `${url.pathname} did not return a valid Workspace Linker JSON API response.`
          : `${url.pathname} returned HTTP ${response.status}.`,
        url: url.href,
        statusCode: response.status,
        detail: textPreview(text),
        durationMs: Date.now() - started,
      };
    }
    return {
      id,
      status: "pass",
      message: `${url.pathname} responded successfully.`,
      url: url.href,
      statusCode: response.status,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id,
      status: "fail",
      message: `${url.pathname} request failed.`,
      url: url.href,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

interface SmokeComputerInfo {
  kind?: string;
  scopes?: Array<{
    id?: unknown;
    permissions?: { read?: unknown };
    allowedOperations?: unknown[];
  }>;
}

async function smokeComputerInfo(
  fetchImpl: typeof fetch,
  apiBaseUrl: URL,
  token: string | undefined,
  timeoutMs: number,
): Promise<{ check: WorkspaceLinkerClientSmokeCheck; data?: SmokeComputerInfo }> {
  const started = Date.now();
  const url = new URL("control", apiBaseUrl);
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: "get_computer_info" }),
    }, timeoutMs);
    const text = await response.text();
    const payload = parseJsonApiData(text);
    const data = payload.data as SmokeComputerInfo | undefined;
    if (!response.ok || !payload.ok || data?.kind !== "workspace-linker-computer-info") {
      return {
        check: {
          id: "api-computer-info",
          status: "fail",
          message: "/api/v1/control get_computer_info did not return a valid computer info response.",
          url: url.href,
          statusCode: response.status,
          detail: textPreview(text),
          durationMs: Date.now() - started,
        },
      };
    }
    return {
      data,
      check: {
        id: "api-computer-info",
        status: "pass",
        message: "/api/v1/control get_computer_info returned computer identity and scopes.",
        url: url.href,
        statusCode: response.status,
        durationMs: Date.now() - started,
      },
    };
  } catch (error) {
    return {
      check: {
        id: "api-computer-info",
        status: "fail",
        message: "/api/v1/control get_computer_info request failed.",
        url: url.href,
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      },
    };
  }
}

async function smokeReadOnlyOperation(
  fetchImpl: typeof fetch,
  apiBaseUrl: URL,
  token: string | undefined,
  computerInfo: SmokeComputerInfo | undefined,
  timeoutMs: number,
): Promise<WorkspaceLinkerClientSmokeCheck> {
  const started = Date.now();
  const url = new URL("control", apiBaseUrl);
  const scope = readableScope(computerInfo);
  if (!scope) {
    return {
      id: "api-read-only-operation",
      status: "fail",
      message: "No readable scope is available for a read-only operation smoke test.",
      url: url.href,
      durationMs: Date.now() - started,
    };
  }

  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        action: "computer_operation",
        scope,
        op: "file.list",
        target: ".",
        input: {},
        options: { maxEntries: 1 },
      }),
    }, timeoutMs);
    const text = await response.text();
    const payload = parseJsonApiData(text);
    const operation = payload.data && typeof payload.data === "object"
      ? payload.data as { ok?: unknown; error?: { message?: unknown } }
      : undefined;
    if (!response.ok || !payload.ok || operation?.ok !== true) {
      return {
        id: "api-read-only-operation",
        status: "fail",
        message: `Read-only computer_operation file.list failed for scope ${scope}.`,
        url: url.href,
        statusCode: response.status,
        detail: typeof operation?.error?.message === "string" ? operation.error.message : textPreview(text),
        durationMs: Date.now() - started,
      };
    }
    return {
      id: "api-read-only-operation",
      status: "pass",
      message: `Read-only computer_operation file.list succeeded for scope ${scope}.`,
      url: url.href,
      statusCode: response.status,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id: "api-read-only-operation",
      status: "fail",
      message: `Read-only computer_operation file.list request failed for scope ${scope}.`,
      url: url.href,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

async function smokeMcpToolFlow(
  fetchImpl: typeof fetch,
  url: URL,
  token: string | undefined,
  timeoutMs: number,
  clientName: string,
): Promise<WorkspaceLinkerClientSmokeCheck[]> {
  const started = Date.now();
  const checks: WorkspaceLinkerClientSmokeCheck[] = [];
  const client = new Client({ name: clientName, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    },
    fetch: (input, init) => fetchWithTimeout(fetchImpl, input, init ?? {}, timeoutMs),
    reconnectionOptions: {
      maxReconnectionDelay: timeoutMs,
      initialReconnectionDelay: timeoutMs,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });

  try {
    await withSmokeTimeout(client.connect(transport), timeoutMs, "MCP initialize timed out.");
    checks.push({
      id: "mcp-initialize",
      status: "pass",
      message: "/mcp initialize succeeded through the MCP SDK transport.",
      url: url.href,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    try {
      await closeMcpSmokeClient(client, transport);
    } catch {
      // Close is best-effort after a failed initialize.
    }
    return [
      {
        id: "mcp-initialize",
        status: "fail",
        message: "/mcp initialize failed through the MCP SDK transport.",
        url: url.href,
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      },
    ];
  }

  try {
    const tools = await withSmokeTimeout(client.listTools(), timeoutMs, "MCP tools/list timed out.");
    const toolNames = tools.tools.map((tool) => tool.name);
    const missingTools = ["get_computer_info", "computer_operation", "get_operation_history"].filter((tool) => !toolNames.includes(tool));
    if (missingTools.length > 0) {
      checks.push({
        id: "mcp-list-tools",
        status: "fail",
        message: `MCP tools/list is missing required tools: ${missingTools.join(", ")}.`,
        url: url.href,
      });
    } else {
      checks.push({
        id: "mcp-list-tools",
        status: "pass",
        message: "MCP tools/list returned the generic Workspace Linker tool surface.",
        url: url.href,
      });
    }
  } catch (error) {
    checks.push({
      id: "mcp-list-tools",
      status: "fail",
      message: "MCP tools/list request failed.",
      url: url.href,
      detail: error instanceof Error ? error.message : String(error),
    });
    await closeMcpSmokeClient(client, transport);
    return checks;
  }

  let computerInfo: SmokeComputerInfo | undefined;
  try {
    const result = await withSmokeTimeout(client.callTool({ name: "get_computer_info", arguments: {} }), timeoutMs, "MCP get_computer_info timed out.");
    const data = mcpToolData(result) as SmokeComputerInfo | undefined;
    if (data?.kind !== "workspace-linker-computer-info") {
      checks.push({
        id: "mcp-get-computer-info",
        status: "fail",
        message: "MCP get_computer_info did not return computer identity and scopes.",
        url: url.href,
        detail: textPreview(JSON.stringify(data ?? null)),
      });
    } else {
      computerInfo = data;
      checks.push({
        id: "mcp-get-computer-info",
        status: "pass",
        message: "MCP get_computer_info returned computer identity and scopes.",
        url: url.href,
      });
    }
  } catch (error) {
    checks.push({
      id: "mcp-get-computer-info",
      status: "fail",
      message: "MCP get_computer_info request failed.",
      url: url.href,
      detail: error instanceof Error ? error.message : String(error),
    });
    await closeMcpSmokeClient(client, transport);
    return checks;
  }

  const scope = readableScope(computerInfo);
  if (!scope) {
    checks.push({
      id: "mcp-read-only-operation",
      status: "fail",
      message: "No readable scope is available for an MCP computer_operation smoke test.",
      url: url.href,
    });
    await closeMcpSmokeClient(client, transport);
    return checks;
  }

  try {
    try {
      const result = await withSmokeTimeout(client.callTool({
        name: "computer_operation",
        arguments: {
          scope,
          op: "file.list",
          target: ".",
          input: {},
          options: { maxEntries: 1 },
        },
      }), timeoutMs, "MCP computer_operation timed out.");
      const operation = mcpToolData(result) as { ok?: unknown; error?: { message?: unknown } } | undefined;
      if (operation?.ok !== true) {
        checks.push({
          id: "mcp-read-only-operation",
          status: "fail",
          message: `MCP computer_operation file.list failed for scope ${scope}.`,
          url: url.href,
          detail: typeof operation?.error?.message === "string" ? operation.error.message : textPreview(JSON.stringify(operation ?? null)),
        });
      } else {
        checks.push({
          id: "mcp-read-only-operation",
          status: "pass",
          message: `MCP computer_operation file.list succeeded for scope ${scope}.`,
          url: url.href,
        });
      }
    } catch (error) {
      checks.push({
        id: "mcp-read-only-operation",
        status: "fail",
        message: `MCP computer_operation file.list request failed for scope ${scope}.`,
        url: url.href,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const result = await withSmokeTimeout(client.callTool({
        name: "get_operation_history",
        arguments: {
          view: "last",
          limit: 5,
        },
      }), timeoutMs, "MCP get_operation_history timed out.");
      const history = mcpToolData(result) as { view?: unknown; last?: unknown; summary?: unknown } | undefined;
      if (!history || history.view !== "last" || (!("last" in history) && !("summary" in history))) {
        checks.push({
          id: "mcp-operation-history",
          status: "fail",
          message: "MCP get_operation_history did not return a last-history response.",
          url: url.href,
          detail: textPreview(JSON.stringify(history ?? null)),
        });
      } else {
        checks.push({
          id: "mcp-operation-history",
          status: "pass",
          message: "MCP get_operation_history returned redacted recent history.",
          url: url.href,
        });
      }
    } catch (error) {
      checks.push({
        id: "mcp-operation-history",
        status: "fail",
        message: "MCP get_operation_history request failed.",
        url: url.href,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    await closeMcpSmokeClient(client, transport);
  }

  return checks;
}

async function closeMcpSmokeClient(client: Client, transport: StreamableHTTPClientTransport): Promise<void> {
  try {
    if (transport.sessionId) await transport.terminateSession();
  } catch {
    // Explicit session termination is best-effort; close still releases local resources.
  }
  try {
    await client.close();
  } catch {
    // Session cleanup is best-effort; smoke checks already captured failures.
  }
}

async function withSmokeTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mcpToolData(result: unknown): unknown {
  const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
  if (structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)) {
    return structuredContent;
  }
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function jsonApiPayloadSucceeded(text: string): boolean {
  const payload = parseJsonApiData(text);
  return payload.ok && payload.data !== undefined;
}

function parseJsonApiData(text: string): { ok: boolean; data?: unknown } {
  try {
    const payload = JSON.parse(text) as { ok?: unknown; data?: unknown };
    return { ok: payload.ok === true, data: payload.data };
  } catch {
    return { ok: false };
  }
}

function textPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function smokeNextActions(blockingReasons: string[], warnings: string[], publicMode: boolean): string[] {
  const actions = new Set<string>();
  if (blockingReasons.some((reason) => reason.includes("base-url"))) {
    actions.add("Set publicBaseUrl or rerun with `--url https://...`; use `--allow-http` only for local testing.");
  }
  if (blockingReasons.some((reason) => reason.includes("auth"))) {
    actions.add("Run `workspace-linker init` or pass `--token <ownerToken>` for the smoke test.");
  }
  if (blockingReasons.some((reason) => reason.includes("api-capabilities"))) {
    actions.add(publicMode
      ? "Confirm the local API is reachable during loopback smoke testing and that the owner token is correct."
      : "Verify the SDK baseUrl points to the local or trusted-private /api/v1 endpoint and that ownerToken is correct.");
  }
  if (blockingReasons.some((reason) => reason.includes("api-computer-info"))) {
    actions.add(publicMode
      ? "Confirm authenticated JSON API access works during loopback smoke testing."
      : "Confirm the SDK ownerToken can call get_computer_info on /api/v1/control.");
  }
  if (blockingReasons.some((reason) => reason.includes("api-read-only-operation"))) {
    actions.add("Configure at least one readable scope and confirm computer_operation file.list is allowed.");
  }
  if (blockingReasons.some((reason) => reason.includes("healthz") || reason.includes("mcp-initialize"))) {
    actions.add(publicMode
      ? "Confirm the HTTP server is running and the tunnel routes to this machine."
      : "Confirm the Workspace Linker HTTP server is running and reachable at the same service origin.");
  }
  if (blockingReasons.some((reason) => reason.includes("mcp-list-tools") || reason.includes("mcp-get-computer-info") || reason.includes("mcp-read-only-operation") || reason.includes("mcp-operation-history"))) {
    actions.add("Confirm the MCP server exposes the generic tool surface and that at least one readable workspace scope is configured.");
  }
  if (warnings.some((warning) => warning.includes("HTTP URL"))) {
    actions.add("Use an HTTPS tunnel URL before configuring a cloud MCP client.");
  }
  if (actions.size === 0) {
    actions.add("Use the MCP server URL and Authorization bearer token in your MCP client setup.");
  }
  return [...actions];
}

function readableScope(computerInfo: SmokeComputerInfo | undefined): string | undefined {
  return computerInfo?.scopes?.find((scope) => (
    typeof scope.id === "string" &&
    (
      scope.permissions?.read === true ||
      scope.allowedOperations?.includes("list_details") ||
      scope.allowedOperations?.includes("read") ||
      scope.allowedOperations?.includes("search_text")
    )
  ))?.id as string | undefined;
}
