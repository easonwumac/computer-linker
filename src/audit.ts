import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactAuditValue } from "./audit-redaction.js";
import { auditLogPath } from "./config.js";
import { auditRetentionPolicy, enforceJsonlRetention, readTailText, type JsonlRetentionPolicy } from "./retention.js";

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
  maxTailScanBytes?: number;
}

export function writeAuditEvent(event: AuditEventInput): void {
  const path = auditLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(redactAuditValue({ timestamp: new Date().toISOString(), ...event }))}\n`, {
    mode: 0o600,
  });
  try {
    enforceAuditRetention();
  } catch {
    // Retention is opportunistic; the audit event has already been durably appended.
  }
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

  const limit = normalizeLimit(options.limit);
  if (limit) return readAuditEventsFromTail(path, options, limit);

  return readFileSync(path, "utf8")
    .trimEnd()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseAuditEvent)
    .filter((event) => auditEventMatchesFilters(event, options))
    .reverse();
}

export function enforceAuditRetention(policy: Partial<JsonlRetentionPolicy> = {}): ReturnType<typeof enforceJsonlRetention> {
  return enforceJsonlRetention(auditLogPath(), {
    maxBytes: policy.maxBytes ?? auditRetentionPolicy.maxBytes,
    maxLines: policy.maxLines,
  });
}

function readAuditEventsFromTail(path: string, options: ReadAuditEventsOptions, limit: number): AuditEvent[] {
  const maxScanBytes = Math.max(1024, Math.floor(options.maxTailScanBytes ?? auditRetentionPolicy.tailReadMaxBytes));
  let scanBytes = Math.min(maxScanBytes, Math.max(64 * 1024, limit * 2048));

  while (true) {
    const tail = readTailText(path, scanBytes);
    const lines = tail.text.trimEnd().split(/\r?\n/).filter(Boolean);
    const events: AuditEvent[] = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const event = parseAuditEvent(lines[index]);
      if (!auditEventMatchesFilters(event, options)) continue;
      events.push(event);
      if (events.length >= limit) return events;
    }
    if (!tail.truncated || scanBytes >= maxScanBytes || scanBytes >= tail.sizeBytes) {
      return events;
    }
    scanBytes = Math.min(maxScanBytes, tail.sizeBytes, scanBytes * 2);
  }
}

function parseAuditEvent(line: string): AuditEvent {
  return redactAuditValue(JSON.parse(line) as AuditEvent);
}

function auditEventMatchesFilters(event: AuditEvent, options: ReadAuditEventsOptions): boolean {
  if (options.type && event.type !== options.type) return false;
  if (options.success !== undefined && event.success !== options.success) return false;
  if (options.tool && event.tool !== options.tool) return false;
  if (options.workspaceId && event.workspaceId !== options.workspaceId && event.workspaceRef !== options.workspaceId) return false;
  if (options.query && !auditSearchText(event).includes(options.query.toLowerCase())) return false;
  return true;
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (!Number.isInteger(value) || !value || value <= 0) return undefined;
  return Math.floor(value);
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
