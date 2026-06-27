import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactAuditValue } from "./audit-redaction.js";
import { auditLogPath } from "./config.js";

export interface AuditEvent {
  timestamp: string;
  type: "tool_call" | "workspace_open" | "mcp_session" | "auth_failure" | "admin_action" | "tunnel_event";
  success: boolean;
  durationMs?: number;
  tool?: string;
  workspaceId?: string;
  workspaceRoot?: string;
  workspaceRef?: string;
  path?: string;
  requestPath?: string;
  remoteAddress?: string;
  workingDirectory?: string;
  commandPreview?: string;
  operation?: string;
  target?: string;
  detail?: string;
  replay?: AuditReplayTemplate;
  error?: string;
  provider?: string;
  tunnelId?: string;
  externalSessionId?: string;
  requestId?: string;
  cmdRequestId?: string;
  rpcRequestId?: string;
  tunnelRequestId?: string;
  severity?: "info" | "warn" | "error";
  statusCode?: number;
}

export interface AuditReplayTemplate {
  action: "workspace_operation";
  replayable: boolean;
  reason?: string;
  requiresInput?: string[];
  input: {
    op: string;
    target?: string;
    input: Record<string, unknown>;
    options: Record<string, unknown>;
  };
}

export type AuditEventInput = Omit<AuditEvent, "timestamp">;

export interface ReadAuditEventsOptions {
  limit?: number;
  type?: AuditEvent["type"];
  success?: boolean;
  tool?: string;
  workspaceId?: string;
  query?: string;
}

export function writeAuditEvent(event: AuditEventInput): void {
  const path = auditLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(redactAuditValue({ timestamp: new Date().toISOString(), ...event }))}\n`, {
    mode: 0o600,
  });
}

export function writeAuthFailureEvent(input: {
  surface: "api" | "mcp";
  method: string;
  requestPath: string;
  remoteAddress?: string;
  detail?: string;
}): void {
  writeAuditEvent({
    type: "auth_failure",
    success: false,
    tool: input.surface,
    requestPath: input.requestPath,
    remoteAddress: input.remoteAddress,
    detail: input.detail ?? "unauthorized",
  });
}

export function writeAdminActionEvent(input: {
  action: string;
  success?: boolean;
  workspaceId?: string;
  path?: string;
  detail?: string;
  error?: string;
}): void {
  const detail = input.detail && input.detail !== input.action
    ? `${input.action}: ${input.detail}`
    : input.action;
  writeAuditEvent({
    type: "admin_action",
    success: input.success ?? true,
    tool: "cli",
    workspaceId: input.workspaceId,
    path: input.path,
    detail,
    error: input.error,
  });
}

export function readRecentAuditEvents(limit = 50): AuditEvent[] {
  return readAuditEvents({ limit });
}

export function readAuditEvents(options: ReadAuditEventsOptions = {}): AuditEvent[] {
  const path = auditLogPath();
  if (!existsSync(path)) return [];

  let events = readFileSync(path, "utf8")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => redactAuditValue(JSON.parse(line) as AuditEvent));

  if (options.type) events = events.filter((event) => event.type === options.type);
  if (options.success !== undefined) events = events.filter((event) => event.success === options.success);
  if (options.tool) events = events.filter((event) => event.tool === options.tool);
  if (options.workspaceId) {
    events = events.filter((event) => event.workspaceId === options.workspaceId || event.workspaceRef === options.workspaceId);
  }
  if (options.query) {
    const query = options.query.toLowerCase();
    events = events.filter((event) => auditSearchText(event).includes(query));
  }

  if (options.limit && options.limit > 0) {
    events = events.slice(Math.max(0, events.length - options.limit));
  }

  return events.reverse();
}

function auditSearchText(event: AuditEvent): string {
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function previewCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
