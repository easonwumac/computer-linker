import type { Request } from "express";

export function isAuthorizedLocalPortRequest(req: Request, ownerToken: string | undefined): boolean {
  if (!ownerToken) return isLoopbackRequest(req);

  const authorization = req.header("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  if (authorization.startsWith(bearerPrefix) && authorization.slice(bearerPrefix.length) === ownerToken) {
    return true;
  }

  return req.header("x-computer-linker-token") === ownerToken ||
    req.header("x-workspace-linker-token") === ownerToken ||
    req.header("x-localport-token") === ownerToken;
}

export function isLoopbackRequest(req: Request): boolean {
  return req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
}
