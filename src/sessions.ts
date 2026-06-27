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

const activeSessions = new Map<string, ActiveSession>();

export function registerActiveSession(input: RegisterSessionInput): ActiveSession {
  const now = new Date().toISOString();
  const session: ActiveSession = {
    id: input.id,
    idPrefix: input.id.slice(0, 8),
    createdAt: now,
    lastSeenAt: now,
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

export function touchActiveSession(id: string): void {
  const session = activeSessions.get(id);
  if (!session) return;
  session.lastSeenAt = new Date().toISOString();
  session.requestCount += 1;
}

export function closeActiveSession(id: string): void {
  activeSessions.delete(id);
}

export function listActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function clearActiveSessionsForTest(): void {
  activeSessions.clear();
}
