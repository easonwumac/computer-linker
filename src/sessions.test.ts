import assert from "node:assert/strict";
import {
  clearActiveSessionsForTest,
  closeActiveSession,
  httpMcpSessionCleanupIntervalMs,
  httpMcpSessionIdleTimeoutMs,
  listIdleActiveSessions,
  listActiveSessions,
  registerActiveSession,
  touchActiveSession,
} from "./sessions.js";
import { cleanupIdleHttpMcpSessions } from "./server.js";

clearActiveSessionsForTest();

registerActiveSession({
  id: "session-abcdef",
  authType: "owner-token",
  clientId: "client-1",
  clientName: "Smoke Client 1.0",
  userAgent: "test-agent",
  remoteAddress: "127.0.0.1",
});

let sessions = listActiveSessions();
assert.equal(sessions.length, 1);
assert.equal(sessions[0].idPrefix, "session-");
assert.equal(sessions[0].authType, "owner-token");
assert.equal(sessions[0].clientName, "Smoke Client 1.0");
assert.equal(sessions[0].requestCount, 1);

touchActiveSession("session-abcdef");
sessions = listActiveSessions();
assert.equal(sessions[0].requestCount, 2);

closeActiveSession("session-abcdef");
assert.equal(listActiveSessions().length, 0);

clearActiveSessionsForTest();
const baseTime = new Date("2026-01-01T00:00:00.000Z");
const activeTime = new Date("2026-01-01T00:00:01.500Z");
const cleanupTime = new Date("2026-01-01T00:00:02.000Z");

registerActiveSession({
  id: "idle-session-abcdef",
  authType: "owner-token",
  clientName: "Idle Client",
}, baseTime);
registerActiveSession({
  id: "active-session-abcdef",
  authType: "oauth",
  clientName: "Active Client",
}, baseTime);
touchActiveSession("active-session-abcdef", activeTime);

assert.deepEqual(
  listIdleActiveSessions({ idleMs: 1000, now: cleanupTime }).map((session) => session.id),
  ["idle-session-abcdef"],
);

const closedTransports: string[] = [];
const expiredSessions: string[] = [];
const transports = new Map([
  ["idle-session-abcdef", { close: () => { closedTransports.push("idle-session-abcdef"); } }],
  ["active-session-abcdef", { close: () => { closedTransports.push("active-session-abcdef"); } }],
]);
const expired = await cleanupIdleHttpMcpSessions({
  transports,
  idleTimeoutMs: 1000,
  now: cleanupTime,
  onExpired: (session) => expiredSessions.push(session.id),
});

assert.deepEqual(expired.map((session) => session.id), ["idle-session-abcdef"]);
assert.deepEqual(expiredSessions, ["idle-session-abcdef"]);
assert.deepEqual(closedTransports, ["idle-session-abcdef"]);
assert.equal(transports.has("idle-session-abcdef"), false);
assert.equal(transports.has("active-session-abcdef"), true);
assert.deepEqual(listActiveSessions().map((session) => session.id), ["active-session-abcdef"]);

assert.equal(httpMcpSessionIdleTimeoutMs({ COMPUTER_LINKER_HTTP_MCP_SESSION_IDLE_TIMEOUT_MS: "250" }), 250);
assert.equal(httpMcpSessionIdleTimeoutMs({ COMPUTER_LINKER_HTTP_MCP_SESSION_IDLE_TIMEOUT_MS: "bad" }), 30 * 60 * 1000);
assert.equal(httpMcpSessionCleanupIntervalMs(250), 125);

clearActiveSessionsForTest();
