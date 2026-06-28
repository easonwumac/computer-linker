import { auditLogPath } from "./config.js";
import { readAuditEvents, type AuditEvent, type AuditReplayTemplate } from "./audit.js";
import { redactAuditValue } from "./audit-redaction.js";
import { listTunnelProcesses, tunnelRuntimeEvents, type TunnelRuntimeEvent } from "./tunnels.js";

export type HistoryInsightView = "summary" | "last" | "timeline" | "sessions" | "connections" | "failed_replay" | "debug_bundle";

export interface HistoryInsightOptions {
  view?: string;
  limit?: number;
  query?: string;
  workspaceId?: string;
  events?: AuditEvent[];
}

export interface CompactAuditEvent {
  timestamp: string;
  type: AuditEvent["type"];
  success: boolean;
  tool?: string;
  workspaceId?: string;
  workspaceRef?: string;
  requestPath?: string;
  remoteAddress?: string;
  path?: string;
  workingDirectory?: string;
  commandPreview?: string;
  operation?: string;
  target?: string;
  detail?: string;
  replay?: AuditReplayTemplate;
  error?: string;
  durationMs?: number;
  provider?: string;
  tunnelId?: string;
  externalSessionId?: string;
  operationId?: string;
  mcpSessionId?: string;
  clientId?: string;
  clientName?: string;
  userAgent?: string;
  authType?: string;
  surface?: string;
  requestId?: string;
  cmdRequestId?: string;
  rpcRequestId?: string;
  tunnelRequestId?: string;
  severity?: "info" | "warn" | "error";
  statusCode?: number;
}

export interface FailedReplayItem {
  timestamp: string;
  error?: string;
  replayable: boolean;
  reason?: string;
  requiresInput?: string[];
  request?: {
    action: "workspace_operation";
    workspace: string;
    input: {
      op: string;
      target?: string;
      input: Record<string, unknown>;
      options: Record<string, unknown>;
    };
  };
}

export interface HistorySessionSummary {
  key: string;
  scope: "workspace" | "mcp" | "surface";
  workspaceId?: string;
  workspaceRef?: string;
  surface?: string;
  mcpSessionId?: string;
  clientId?: string;
  clientName?: string;
  userAgent?: string;
  authType?: string;
  startedAt: string;
  lastActivityAt: string;
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  tools: Record<string, number>;
  operations: Record<string, number>;
  lastEvent: CompactAuditEvent;
  recentFailures: CompactAuditEvent[];
}

export interface HistoryConnectionSummary {
  key: string;
  scope: "tunnel" | "mcp" | "workspace" | "surface";
  provider?: string;
  tunnelId?: string;
  externalSessionId?: string;
  mcpSessionId?: string;
  clientId?: string;
  clientName?: string;
  userAgent?: string;
  authType?: string;
  surface?: string;
  remoteAddress?: string;
  startedAt: string;
  lastActivityAt: string;
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  requestCount: number;
  tools: Record<string, number>;
  operations: Record<string, number>;
  lastEvent: CompactAuditEvent;
  recentFailures: CompactAuditEvent[];
}

export interface HistoryLastInsight {
  event?: CompactAuditEvent;
  workspaceOperation?: CompactAuditEvent;
  failure?: CompactAuditEvent;
  replay?: FailedReplayItem;
  session?: HistorySessionSummary;
  connection?: HistoryConnectionSummary;
  suggestedNextActions: string[];
}

export interface HistoryInsight {
  view: HistoryInsightView;
  generatedAt: string;
  filters: {
    workspaceId?: string;
    query?: string;
    limit: number;
  };
  summary: {
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    lastEvent?: CompactAuditEvent;
    lastWorkspaceOperation?: CompactAuditEvent;
    recentFailures: CompactAuditEvent[];
    toolCounts: Record<string, number>;
    workspaceCounts: Record<string, number>;
  };
  last?: HistoryLastInsight;
  timeline?: CompactAuditEvent[];
  sessions?: HistorySessionSummary[];
  connections?: HistoryConnectionSummary[];
  failedReplay?: FailedReplayItem[];
  debugBundle?: {
    format: "computer-linker-debug-bundle-v1";
    auditLogPath: string;
    redactions: string[];
    events: CompactAuditEvent[];
    connections: HistoryConnectionSummary[];
    failedReplay: FailedReplayItem[];
  };
}

export function historyInsight(options: HistoryInsightOptions = {}): HistoryInsight {
  const view = historyInsightView(options.view);
  const limit = normalizeLimit(options.limit);
  const events = options.events ?? readAuditEvents({
    workspaceId: options.workspaceId,
    query: options.query,
    limit,
  });
  const mergedEvents = mergeDerivedHistoryEvents(events, {
    ...options,
    view,
    limit,
  });
  return historyInsightFromEvents(mergedEvents, {
    view,
    limit,
    query: options.query,
    workspaceId: options.workspaceId,
  });
}

export function historyInsightFromEvents(events: AuditEvent[], options: HistoryInsightOptions = {}): HistoryInsight {
  const view = historyInsightView(options.view);
  const limit = normalizeLimit(options.limit);
  const compactEvents = events.slice(0, limit).map(compactAuditEvent);
  const summary = {
    totalEvents: compactEvents.length,
    successfulEvents: compactEvents.filter((event) => event.success).length,
    failedEvents: compactEvents.filter((event) => !event.success).length,
    lastEvent: compactEvents[0],
    lastWorkspaceOperation: compactEvents.find(isOperationAuditEvent),
    recentFailures: compactEvents.filter((event) => !event.success).slice(0, 10),
    toolCounts: counts(compactEvents.map((event) => event.tool ?? event.type)),
    workspaceCounts: counts(compactEvents.map((event) => event.workspaceId ?? event.workspaceRef).filter((value): value is string => Boolean(value))),
  };
  const failedReplay = buildFailedReplay(compactEvents);
  const sessions = buildSessionSummaries(compactEvents);
  const connections = buildConnectionSummaries(compactEvents);
  const last = buildLastInsight(summary, sessions, connections, failedReplay);
  const insight: HistoryInsight = {
    view,
    generatedAt: new Date().toISOString(),
    filters: {
      workspaceId: options.workspaceId,
      query: options.query,
      limit,
    },
    summary,
  };

  if (view === "last" || view === "debug_bundle") {
    insight.last = last;
  }
  if (view === "timeline" || view === "debug_bundle") {
    insight.timeline = [...compactEvents].reverse();
  }
  if (view === "sessions" || view === "debug_bundle") {
    insight.sessions = sessions;
  }
  if (view === "connections" || view === "debug_bundle") {
    insight.connections = connections;
  }
  if (view === "failed_replay" || view === "debug_bundle") {
    insight.failedReplay = failedReplay;
  }
  if (view === "debug_bundle") {
    insight.debugBundle = {
      format: "computer-linker-debug-bundle-v1",
      auditLogPath: auditLogPath(),
      redactions: [
        "Owner tokens and OAuth tokens are not written to the audit log.",
        "Secret-shaped values in audit preview fields are redacted on write and again before export.",
        "File contents, patch bodies, write payloads, screenshot image bytes, and full command prompts are not included.",
        "commandPreview is truncated to a short diagnostic preview.",
        "Tunnel-client raw logs are converted to compact tunnel_event rows; full tunnel stderr/stdout is not exported.",
      ],
      events: compactEvents,
      connections,
      failedReplay,
    };
  }

  return insight;
}

export function historyInsightView(value: string | undefined): HistoryInsightView {
  if (value === "last" || value === "timeline" || value === "sessions" || value === "connections" || value === "failed_replay" || value === "debug_bundle") return value;
  return "summary";
}

function buildLastInsight(
  summary: HistoryInsight["summary"],
  sessions: HistorySessionSummary[],
  connections: HistoryConnectionSummary[],
  failedReplay: FailedReplayItem[],
): HistoryLastInsight {
  const failure = summary.recentFailures[0];
  const replay = failure
    ? failedReplay.find((item) => item.timestamp === failure.timestamp)
    : undefined;
  return {
    event: summary.lastEvent,
    workspaceOperation: summary.lastWorkspaceOperation,
    failure,
    replay,
    session: sessions[0],
    connection: connections[0],
    suggestedNextActions: lastInsightNextActions(summary, replay),
  };
}

function lastInsightNextActions(summary: HistoryInsight["summary"], replay: FailedReplayItem | undefined): string[] {
  const actions: string[] = [];
  if (summary.recentFailures.some((event) => event.type === "tunnel_event")) {
    actions.push("Call history_insight with view=connections to inspect tunnel sessions and request IDs.");
  }
  if (summary.failedEvents > 0) {
    actions.push("Call history_insight with view=failed_replay to inspect replay templates for recent failures.");
  }
  if (replay?.replayable) {
    actions.push("Replay the failed operation after confirming the workspace and target are still correct.");
  } else if (replay?.requiresInput?.length) {
    actions.push(`Ask for or reconstruct missing replay input: ${replay.requiresInput.join(", ")}.`);
  }
  if (summary.lastWorkspaceOperation) {
    actions.push("Call history_insight with view=timeline and a small limit if more context is needed.");
  }
  if (actions.length === 0) {
    actions.push("No recent failure was found; continue with the next requested workspace operation.");
  }
  return actions;
}

function compactAuditEvent(event: AuditEvent): CompactAuditEvent {
  return redactAuditValue({
    timestamp: event.timestamp,
    type: event.type,
    success: event.success,
    tool: event.tool,
    workspaceId: event.workspaceId,
    workspaceRef: event.workspaceRef,
    requestPath: event.requestPath,
    remoteAddress: event.remoteAddress,
    path: event.path,
    workingDirectory: event.workingDirectory,
    commandPreview: event.commandPreview,
    operation: event.operation,
    target: event.target,
    detail: event.detail,
    replay: event.replay,
    error: event.error,
    durationMs: event.durationMs,
    provider: event.provider,
    tunnelId: event.tunnelId,
    externalSessionId: event.externalSessionId,
    operationId: event.operationId,
    mcpSessionId: event.mcpSessionId,
    clientId: event.clientId,
    clientName: event.clientName,
    userAgent: event.userAgent,
    authType: event.authType,
    surface: event.surface,
    requestId: event.requestId,
    cmdRequestId: event.cmdRequestId,
    rpcRequestId: event.rpcRequestId,
    tunnelRequestId: event.tunnelRequestId,
    severity: event.severity,
    statusCode: event.statusCode,
  });
}

function mergeDerivedHistoryEvents(events: AuditEvent[], options: HistoryInsightOptions): AuditEvent[] {
  const view = historyInsightView(options.view);
  const limit = normalizeLimit(options.limit);
  const includeInfo = view === "connections" || view === "debug_bundle";
  const derivedEvents = tunnelRuntimeEvents(listTunnelProcesses(), {
    includeInfo,
    limit: includeInfo ? Math.max(limit, 200) : Math.min(limit, 100),
  })
    .map(tunnelRuntimeEventToAuditEvent)
    .filter((event) => historyEventMatchesFilters(event, options));

  return [...events, ...derivedEvents]
    .filter((event) => historyEventMatchesFilters(event, options))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

function tunnelRuntimeEventToAuditEvent(event: TunnelRuntimeEvent): AuditEvent {
  const success = event.severity === "info";
  const detail = tunnelAuditDetail(event);
  return {
    timestamp: event.timestamp,
    type: "tunnel_event",
    success,
    tool: `tunnel:${event.provider}`,
    requestPath: event.rpcMethod,
    remoteAddress: event.tunnelRequestId,
    operation: event.kind,
    detail,
    error: success ? undefined : event.detail ?? event.message,
    provider: event.provider,
    tunnelId: event.tunnelId,
    externalSessionId: event.sessionId,
    requestId: event.requestId,
    cmdRequestId: event.cmdRequestId,
    rpcRequestId: event.rpcRequestId,
    tunnelRequestId: event.tunnelRequestId,
    severity: event.severity,
    statusCode: event.statusCode,
  };
}

function tunnelAuditDetail(event: TunnelRuntimeEvent): string {
  return [
    event.message,
    event.rpcMethod,
    event.statusCode === undefined ? undefined : `status=${event.statusCode}`,
    event.detail,
  ].filter(Boolean).join(" · ");
}

function historyEventMatchesFilters(event: AuditEvent, options: HistoryInsightOptions): boolean {
  if (options.workspaceId && event.workspaceId !== options.workspaceId && event.workspaceRef !== options.workspaceId) {
    return false;
  }
  if (options.query && !historySearchText(event).includes(options.query.toLowerCase())) {
    return false;
  }
  return true;
}

function historySearchText(event: AuditEvent): string {
  return [
    event.timestamp,
    event.type,
    event.tool,
    event.workspaceId,
    event.workspaceRoot,
    event.workspaceRef,
    event.path,
    event.requestPath,
    event.remoteAddress,
    event.workingDirectory,
    event.commandPreview,
    event.operation,
    event.target,
    event.detail,
    event.error,
    event.provider,
    event.tunnelId,
    event.externalSessionId,
    event.operationId,
    event.mcpSessionId,
    event.clientId,
    event.clientName,
    event.userAgent,
    event.authType,
    event.surface,
    event.requestId,
    event.cmdRequestId,
    event.rpcRequestId,
    event.tunnelRequestId,
    event.severity,
    event.statusCode === undefined ? undefined : String(event.statusCode),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isOperationAuditEvent(event: CompactAuditEvent): boolean {
  return event.tool === "computer_operation" ||
    event.tool === "workspace_operation" ||
    event.tool === "workspace_operation.batch_item";
}

function buildSessionSummaries(events: CompactAuditEvent[]): HistorySessionSummary[] {
  const groups = new Map<string, CompactAuditEvent[]>();
  for (const event of events) {
    const key = sessionKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.entries()]
    .map(([key, sessionEvents]) => {
      const newest = sessionEvents[0];
      const oldest = sessionEvents[sessionEvents.length - 1];
      const workspaceRef = newest.workspaceRef ?? newest.workspaceId;
      const workspaceId = newest.workspaceId;
      const surface = sessionSurface(newest);
      const scope: HistorySessionSummary["scope"] = key.startsWith("workspace:")
        ? "workspace"
        : key.startsWith("mcp:")
          ? "mcp"
          : "surface";
      return {
        key,
        scope,
        workspaceId,
        workspaceRef,
        surface,
        mcpSessionId: firstString(sessionEvents.map((event) => event.mcpSessionId ?? mcpSessionIdFromEvent(event))),
        clientId: firstString(sessionEvents.map((event) => event.clientId)),
        clientName: firstString(sessionEvents.map((event) => event.clientName)),
        userAgent: firstString(sessionEvents.map((event) => event.userAgent)),
        authType: firstString(sessionEvents.map((event) => event.authType)),
        startedAt: oldest.timestamp,
        lastActivityAt: newest.timestamp,
        totalEvents: sessionEvents.length,
        successfulEvents: sessionEvents.filter((event) => event.success).length,
        failedEvents: sessionEvents.filter((event) => !event.success).length,
        tools: counts(sessionEvents.map((event) => event.tool ?? event.type)),
        operations: counts(sessionEvents.map((event) => event.operation).filter((value): value is string => Boolean(value))),
        lastEvent: newest,
        recentFailures: sessionEvents.filter((event) => !event.success).slice(0, 5),
      };
    })
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

function buildConnectionSummaries(events: CompactAuditEvent[]): HistoryConnectionSummary[] {
  const groups = new Map<string, CompactAuditEvent[]>();
  for (const event of events) {
    const key = connectionKey(event);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.entries()]
    .map(([key, connectionEvents]) => {
      const newest = connectionEvents[0];
      const oldest = connectionEvents[connectionEvents.length - 1];
      const requestIds = new Set(connectionEvents.flatMap((event) => (
        [event.requestId, event.cmdRequestId, event.rpcRequestId, event.tunnelRequestId].filter((value): value is string => Boolean(value))
      )));
      return {
        key,
        scope: connectionScope(key),
        provider: newest.provider,
        tunnelId: newest.tunnelId,
        externalSessionId: newest.externalSessionId,
        mcpSessionId: firstString(connectionEvents.map((event) => event.mcpSessionId ?? mcpSessionIdFromEvent(event))),
        clientId: firstString(connectionEvents.map((event) => event.clientId)),
        clientName: firstString(connectionEvents.map((event) => event.clientName)),
        userAgent: firstString(connectionEvents.map((event) => event.userAgent)),
        authType: firstString(connectionEvents.map((event) => event.authType)),
        surface: firstString(connectionEvents.map((event) => event.surface ?? sessionSurface(event))),
        remoteAddress: newest.remoteAddress,
        startedAt: oldest.timestamp,
        lastActivityAt: newest.timestamp,
        totalEvents: connectionEvents.length,
        successfulEvents: connectionEvents.filter((event) => event.success).length,
        failedEvents: connectionEvents.filter((event) => !event.success).length,
        requestCount: requestIds.size,
        tools: counts(connectionEvents.map((event) => event.tool ?? event.type)),
        operations: counts(connectionEvents.map((event) => event.operation).filter((value): value is string => Boolean(value))),
        lastEvent: newest,
        recentFailures: connectionEvents.filter((event) => !event.success).slice(0, 5),
      };
    })
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

function connectionKey(event: CompactAuditEvent): string | undefined {
  if (event.externalSessionId) return `tunnel:${event.provider ?? "unknown"}:${event.externalSessionId}`;
  if (event.tunnelId) return `tunnel:${event.provider ?? "unknown"}:${event.tunnelId}`;
  const mcpSessionId = mcpSessionIdFromEvent(event);
  if (mcpSessionId) return `mcp:${mcpSessionId}`;
  const workspace = event.workspaceId ?? event.workspaceRef;
  if (workspace) return `workspace:${workspace}`;
  if (event.remoteAddress) return `surface:${event.remoteAddress}`;
  return event.tool || event.requestPath ? `surface:${sessionSurface(event)}` : undefined;
}

function connectionScope(key: string): HistoryConnectionSummary["scope"] {
  if (key.startsWith("tunnel:")) return "tunnel";
  if (key.startsWith("mcp:")) return "mcp";
  if (key.startsWith("workspace:")) return "workspace";
  return "surface";
}

function mcpSessionIdFromEvent(event: CompactAuditEvent): string | undefined {
  if (event.mcpSessionId) return event.mcpSessionId;
  if (event.type !== "mcp_session" || !event.detail) return undefined;
  const match = /(?:created|session):\s*([A-Za-z0-9_.:-]+)/.exec(event.detail);
  return match?.[1];
}

function sessionKey(event: CompactAuditEvent): string {
  const mcpSessionId = mcpSessionIdFromEvent(event);
  if (mcpSessionId) return `mcp:${mcpSessionId}`;
  const workspace = event.workspaceId ?? event.workspaceRef;
  if (workspace) return `workspace:${workspace}`;
  return `surface:${sessionSurface(event)}`;
}

function sessionSurface(event: CompactAuditEvent): string {
  return event.surface ?? event.tool ?? event.requestPath ?? event.type;
}

function buildFailedReplay(events: CompactAuditEvent[]): FailedReplayItem[] {
  return events
    .filter((event) => !event.success)
    .slice(0, 20)
    .map((event) => {
      const workspace = event.workspaceId ?? event.workspaceRef;
      const op = event.operation ?? inferOperation(event);
      if (!workspace || !op || (event.tool !== "workspace_operation" && event.tool !== "workspace_operation.batch_item")) {
        return {
          timestamp: event.timestamp,
          error: event.error,
          replayable: false,
          reason: "Audit event does not contain enough workspace operation metadata to build a replay request.",
        };
      }

      if (event.replay) {
        return replayItemFromTemplate(event, workspace, event.replay);
      }

      const target = event.target ?? event.path ?? event.workingDirectory;
      const requiresInput = sensitiveReplayInputs(op);
      return {
        timestamp: event.timestamp,
        error: event.error,
        replayable: requiresInput.length === 0,
        reason: requiresInput.length > 0
          ? `Full ${requiresInput.join("/")} text is not stored in old audit events; provide it before replaying.`
          : event.commandPreview ? "Replay uses stored operation metadata; command/prompt text is only available as a truncated preview." : undefined,
        requiresInput: requiresInput.length > 0 ? requiresInput : undefined,
        request: {
          action: "workspace_operation",
          workspace,
          input: {
            op,
            target,
            input: replayInput(event),
            options: {},
          },
        },
      };
    });
}

function replayItemFromTemplate(event: CompactAuditEvent, workspace: string, replay: AuditReplayTemplate): FailedReplayItem {
  return {
    timestamp: event.timestamp,
    error: event.error,
    replayable: replay.replayable,
    reason: replay.reason,
    requiresInput: replay.requiresInput,
    request: {
      action: replay.action,
      workspace,
      input: replay.input,
    },
  };
}

function replayInput(event: CompactAuditEvent): Record<string, unknown> {
  if (event.operation === "package_run" || event.operation === "package_start") {
    return event.detail ? { script: event.detail } : {};
  }
  if (event.operation === "search_text") {
    return event.detail ? { query: event.detail } : {};
  }
  if (event.operation === "find_files") {
    return event.detail ? { pattern: event.detail } : {};
  }
  if (event.operation === "process_read" || event.operation === "process_stop") {
    return event.detail ? { processId: event.detail } : {};
  }
  return {};
}

function sensitiveReplayInputs(op: string): string[] {
  if (op === "command" || op === "process_start") return ["command"];
  if (op === "codex" ||
    op === "codex_start" ||
    op === "codex_plan" ||
    op === "codex_review" ||
    op === "codex_fix" ||
    op === "codex_test" ||
    op === "codex_continue") {
    return ["prompt"];
  }
  return [];
}

function inferOperation(event: CompactAuditEvent): string | undefined {
  if (!event.detail) return undefined;
  const batchMatch = /^batch\[\d+\]:\s+([a-z_]+)$/.exec(event.detail);
  if (batchMatch) return batchMatch[1];
  if (/^[a-z_]+$/.test(event.detail)) return event.detail;
  return undefined;
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function firstString(values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function normalizeLimit(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 1000) : 200;
}
