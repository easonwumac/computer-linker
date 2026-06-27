import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_THROTTLE_AFTER = 3;
const AUTH_FAILURE_BACKOFF_STEP_MS = 50;
const AUTH_FAILURE_MAX_BACKOFF_MS = 500;

interface AuthFailureBucket {
  count: number;
  firstFailureAt: number;
  lastFailureAt: number;
}

export interface LocalPortAuthResult {
  authorized: boolean;
  authType?: "owner-token" | "loopback";
  detail?: string;
  throttled: boolean;
  backoffMs: number;
}

export interface LocalPortAuthOptions {
  recordFailure?: boolean;
}

const authFailures = new Map<string, AuthFailureBucket>();

export function isAuthorizedLocalPortRequest(req: Request, ownerToken: string | undefined): boolean {
  return checkAuthorizedLocalPortRequest(req, ownerToken).authorized;
}

export function checkAuthorizedLocalPortRequest(
  req: Request,
  ownerToken: string | undefined,
  options: LocalPortAuthOptions = {},
): LocalPortAuthResult {
  const recordFailure = options.recordFailure ?? true;
  if (!ownerToken) {
    return isLoopbackRequest(req)
      ? authorized("loopback", req)
      : failed(req, "loopback required", recordFailure);
  }

  if (hasMatchingOwnerToken(req, ownerToken)) {
    return authorized("owner-token", req);
  }

  return failed(req, presentedOwnerTokens(req).length > 0 ? "invalid owner token" : "missing owner token", recordFailure);
}

export function recordLocalPortAuthFailure(req: Request, detail: string): LocalPortAuthResult {
  return failed(req, detail, true);
}

export async function waitForAuthBackoff(result: LocalPortAuthResult): Promise<void> {
  if (result.backoffMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, result.backoffMs));
}

function hasMatchingOwnerToken(req: Request, ownerToken: string): boolean {
  return presentedOwnerTokens(req).some((candidate) => timingSafeEqualString(candidate, ownerToken));
}

function presentedOwnerTokens(req: Request): string[] {
  const tokens: string[] = [];
  const authorization = req.header("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  if (authorization.startsWith(bearerPrefix)) {
    tokens.push(authorization.slice(bearerPrefix.length));
  }

  for (const header of ["x-computer-linker-token", "x-workspace-linker-token", "x-localport-token"]) {
    const value = req.header(header);
    if (typeof value === "string") tokens.push(value);
  }

  return tokens;
}

function timingSafeEqualString(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  const length = Math.max(candidateBytes.length, expectedBytes.length, 1);
  const paddedCandidate = Buffer.alloc(length);
  const paddedExpected = Buffer.alloc(length);
  candidateBytes.copy(paddedCandidate);
  expectedBytes.copy(paddedExpected);
  return timingSafeEqual(paddedCandidate, paddedExpected) && candidateBytes.length === expectedBytes.length;
}

function authorized(authType: LocalPortAuthResult["authType"], req: Request): LocalPortAuthResult {
  authFailures.delete(authFailureKey(req));
  return {
    authorized: true,
    authType,
    throttled: false,
    backoffMs: 0,
  };
}

function failed(req: Request, detail: string, recordFailure: boolean): LocalPortAuthResult {
  if (!recordFailure) {
    return {
      authorized: false,
      detail,
      throttled: false,
      backoffMs: 0,
    };
  }

  const bucket = recordAuthFailure(req);
  return {
    authorized: false,
    detail: bucket.throttled ? `throttled: ${detail}` : detail,
    throttled: bucket.throttled,
    backoffMs: bucket.backoffMs,
  };
}

function recordAuthFailure(req: Request): { throttled: boolean; backoffMs: number } {
  const now = Date.now();
  const key = authFailureKey(req);
  const existing = authFailures.get(key);
  const bucket: AuthFailureBucket = existing && now - existing.firstFailureAt <= AUTH_FAILURE_WINDOW_MS
    ? {
        count: existing.count + 1,
        firstFailureAt: existing.firstFailureAt,
        lastFailureAt: now,
      }
    : {
        count: 1,
        firstFailureAt: now,
        lastFailureAt: now,
      };
  authFailures.set(key, bucket);
  cleanupAuthFailures(now);

  if (bucket.count <= AUTH_FAILURE_THROTTLE_AFTER) {
    return { throttled: false, backoffMs: 0 };
  }

  return {
    throttled: true,
    backoffMs: Math.min(
      AUTH_FAILURE_MAX_BACKOFF_MS,
      (bucket.count - AUTH_FAILURE_THROTTLE_AFTER) * AUTH_FAILURE_BACKOFF_STEP_MS,
    ),
  };
}

function cleanupAuthFailures(now: number): void {
  for (const [key, bucket] of authFailures) {
    if (now - bucket.lastFailureAt > AUTH_FAILURE_WINDOW_MS) {
      authFailures.delete(key);
    }
  }
}

function authFailureKey(req: Request): string {
  return remoteAddress(req) ?? "unknown";
}

function remoteAddress(req: Request): string | undefined {
  return req.ip || req.socket.remoteAddress;
}

export function isLoopbackRequest(req: Request): boolean {
  const address = remoteAddress(req);
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
