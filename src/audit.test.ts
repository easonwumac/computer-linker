import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLogPath } from "./config.js";
import { readAuditEvents, readRecentAuditEvents, writeAdminActionEvent, writeAuditEvent, writeAuthFailureEvent } from "./audit.js";
import { historyInsightFromEvents } from "./history-insights.js";

const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "localport-audit-test-"));

try {
  process.env.LOCALPORT_CONFIG_DIR = root;

  writeAuditEvent({
    type: "tool_call",
    tool: "read_file",
    workspaceId: "ws_1",
    path: "README.md",
    success: true,
    durationMs: 5,
  });
  writeAuditEvent({
    type: "tool_call",
    tool: "write_file",
    workspaceId: "ws_1",
    path: "README.md",
    success: false,
    error: "write permission is disabled",
  });
  writeAuthFailureEvent({
    surface: "api",
    method: "GET",
    requestPath: "/api/v1/workspaces",
    remoteAddress: "203.0.113.10",
  });
  writeAdminActionEvent({
    action: "workspace:add",
    workspaceId: "app",
    path: "/tmp/app",
    detail: "read, write",
  });
  writeAuditEvent({
    type: "tool_call",
    tool: "workspace_operation",
    workspaceId: "ws_1",
    operation: "command",
    commandPreview: "curl -H Authorization: Bearer abcdefghijklmnop https://example.test",
    target: "postgres://app:db-password@example.test/db",
    detail: "OPENAI_API_KEY=sk-redact npm test",
    error: "password=hunter2 failed",
    requestId: "req_OPENAI_API_KEY=sk-reqred",
    success: false,
  });
  writeAuditEvent({
    type: "tool_call",
    tool: "workspace_operation",
    workspaceId: "ws_1",
    operation: "command",
    commandPreview: "npm run test",
    detail: "normal diagnostic detail",
    success: true,
  });

  assert.equal(auditLogPath(), join(root, "audit.jsonl"));

  const events = readRecentAuditEvents(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool_call");
  assert.equal(events[0].success, true);
  assert.equal(events[0].workspaceId, "ws_1");
  assert.equal(events[0].commandPreview, "npm run test");
  assert.equal(events[0].detail, "normal diagnostic detail");

  const failedEvents = readAuditEvents({ success: false });
  assert.equal(failedEvents.length, 3);
  assert.ok(failedEvents.some((event) => event.tool === "write_file"));
  const redactedCommand = failedEvents.find((event) => event.operation === "command");
  assert.ok(redactedCommand);
  assert.equal(redactedCommand.commandPreview, "curl -H Authorization: Bearer <redacted> https://example.test");
  assert.equal(redactedCommand.target, "postgres://<redacted>@example.test/db");
  assert.equal(redactedCommand.detail, "OPENAI_API_KEY=<redacted> npm test");
  assert.equal(redactedCommand.error, "password=<redacted> failed");
  assert.equal(redactedCommand.requestId, "req_OPENAI_API_KEY=<redacted>");
  assert.doesNotMatch(JSON.stringify(redactedCommand), /abcdefghijklmnop|sk-redact|db-password|hunter2|sk-reqred/);

  const workspaceEvents = readAuditEvents({ workspaceId: "ws_1", query: "README.md" });
  assert.equal(workspaceEvents.length, 2);

  const toolEvents = readAuditEvents({ tool: "read_file" });
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].success, true);

  const authFailures = readAuditEvents({ type: "auth_failure", query: "203.0.113.10" });
  assert.equal(authFailures.length, 1);
  assert.equal(authFailures[0].tool, "api");

  const adminActions = readAuditEvents({ type: "admin_action", query: "workspace:add" });
  assert.equal(adminActions.length, 1);
  assert.equal(adminActions[0].tool, "cli");

  const rawAuditLog = await readFile(auditLogPath(), "utf8");
  assert.doesNotMatch(rawAuditLog, /abcdefghijklmnop|sk-redact|db-password|hunter2|sk-reqred/);

  const debugBundle = historyInsightFromEvents([
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "tool_call",
      tool: "workspace_operation",
      workspaceId: "legacy",
      operation: "command",
      commandPreview: "OPENAI_API_KEY=sk-legacy curl -H 'Authorization: Bearer legacybearer'",
      success: false,
      error: "postgres://legacy:secret@example.test/db failed",
    },
  ], {
    view: "debug_bundle",
  });
  assert.ok(debugBundle.debugBundle?.redactions.some((redaction) => redaction.includes("Secret-shaped values")));
  assert.doesNotMatch(JSON.stringify(debugBundle), /sk-legacy|legacybearer|legacy:secret/);
  assert.match(JSON.stringify(debugBundle), /OPENAI_API_KEY=<redacted>/);
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  await rm(root, { recursive: true, force: true });
}
