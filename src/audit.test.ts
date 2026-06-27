import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLogPath } from "./config.js";
import { readAuditEvents, readRecentAuditEvents, writeAdminActionEvent, writeAuditEvent, writeAuthFailureEvent } from "./audit.js";

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

  assert.equal(auditLogPath(), join(root, "audit.jsonl"));

  const events = readRecentAuditEvents(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "admin_action");
  assert.equal(events[0].success, true);
  assert.equal(events[0].workspaceId, "app");

  const failedEvents = readAuditEvents({ success: false });
  assert.equal(failedEvents.length, 2);
  assert.ok(failedEvents.some((event) => event.tool === "write_file"));

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
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  await rm(root, { recursive: true, force: true });
}
