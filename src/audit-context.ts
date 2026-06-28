import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditEventInput } from "./audit.js";

export interface AuditContext {
  surface?: string;
  requestPath?: string;
  remoteAddress?: string;
  mcpSessionId?: string;
  clientId?: string;
  clientName?: string;
  userAgent?: string;
  authType?: string;
}

const auditContextStorage = new AsyncLocalStorage<AuditContext>();

export function withAuditContext<T>(context: AuditContext, run: () => T): T {
  return auditContextStorage.run(compactAuditContext({
    ...auditContextStorage.getStore(),
    ...context,
  }), run);
}

export function currentAuditContextFields(fallback: AuditContext = {}): Partial<AuditEventInput> {
  return compactAuditContext({
    ...fallback,
    ...auditContextStorage.getStore(),
  });
}

export function auditResultFields(result: unknown): Partial<AuditEventInput> {
  const payload = auditResultPayload(result);
  if (!payload) return {};

  const operationId = stringField(payload.operationId);
  const ok = payload.ok;
  const error = ok === false ? operationErrorText(payload.error) : undefined;
  return compactAuditContext({
    operationId,
    error,
  });
}

function auditResultPayload(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  const structuredContent = record.structuredContent;
  if (structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)) {
    return structuredContent as Record<string, unknown>;
  }
  if ("operationId" in record || "ok" in record || "error" in record) {
    return record;
  }
  return undefined;
}

function operationErrorText(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (typeof error !== "object" || Array.isArray(error)) return String(error);
  const record = error as Record<string, unknown>;
  const code = stringField(record.code);
  const message = stringField(record.message);
  if (code && message) return `${code}: ${message}`;
  return message ?? code;
}

function compactAuditContext(context: Record<string, unknown>): Partial<AuditEventInput> {
  return Object.fromEntries(
    Object.entries(context).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string" && entry[1].trim().length > 0
    )),
  ) as Partial<AuditEventInput>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
