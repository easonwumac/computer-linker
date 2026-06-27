import assert from "node:assert/strict";
import {
  clearActiveSessionsForTest,
  closeActiveSession,
  listActiveSessions,
  registerActiveSession,
  touchActiveSession,
} from "./sessions.js";

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
