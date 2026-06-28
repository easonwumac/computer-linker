export type SessionAuthType = "owner-token" | "oauth" | "loopback";

export interface ActiveSession {
  id: string;
  idPrefix: string;
  createdAt: string;
  lastSeenAt: string;
  authType: SessionAuthType;
  requestCount: number;
  clientId?: string;
  clientName?: string;
  userAgent?: string;
  remoteAddress?: string;
}

export interface RegisterSessionInput {
  id: string;
  authType: SessionAuthType;
  clientId?: string;
  clientName?: string;
  userAgent?: string;
  remoteAddress?: string;
}

export interface IdleSessionOptions {
  idleMs: number;
  now?: Date;
}

export const HTTP_MCP_SESSION_IDLE_TIMEOUT_ENV = "COMPUTER_LINKER_HTTP_MCP_SESSION_IDLE_TIMEOUT_MS";
export const DEFAULT_HTTP_MCP_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const activeSessions = new Map<string, ActiveSession>();

export function registerActiveSession(input: RegisterSessionInput, now = new Date()): ActiveSession {
  const timestamp = now.toISOString();
  const session: ActiveSession = {
    id: input.id,
    idPrefix: input.id.slice(0, 8),
    createdAt: timestamp,
    lastSeenAt: timestamp,
    authType: input.authType,
    requestCount: 1,
    clientId: input.clientId,
    clientName: input.clientName,
    userAgent: input.userAgent,
    remoteAddress: input.remoteAddress,
  };
  activeSessions.set(input.id, session);
  return session;
}

export function touchActiveSession(id: string, now = new Date()): void {
  const session = activeSessions.get(id);
  if (!session) return;
  session.lastSeenAt = now.toISOString();
  session.requestCount += 1;
}

export function getActiveSession(id: string): ActiveSession | undefined {
  return activeSessions.get(id);
}

export function closeActiveSession(id: string): void {
  activeSessions.delete(id);
}

export function listActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function listIdleActiveSessions(options: IdleSessionOptions): ActiveSession[] {
  const nowMs = options.now?.getTime() ?? Date.now();
  return listActiveSessions().filter((session) => {
    const lastSeenMs = Date.parse(session.lastSeenAt);
    return Number.isFinite(lastSeenMs) && nowMs - lastSeenMs >= options.idleMs;
  });
}

export function httpMcpSessionIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[HTTP_MCP_SESSION_IDLE_TIMEOUT_ENV];
  if (!raw) return DEFAULT_HTTP_MCP_SESSION_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_HTTP_MCP_SESSION_IDLE_TIMEOUT_MS;
  return Math.min(24 * 60 * 60 * 1000, Math.max(100, Math.floor(parsed)));
}

export function httpMcpSessionCleanupIntervalMs(idleTimeoutMs = httpMcpSessionIdleTimeoutMs()): number {
  return Math.max(50, Math.min(60 * 1000, Math.floor(idleTimeoutMs / 2)));
}

export function clearActiveSessionsForTest(): void {
  activeSessions.clear();
}
