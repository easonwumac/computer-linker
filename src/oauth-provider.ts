import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";

export interface LocalPortOAuthConfig {
  ownerToken: string;
  scopes: string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

interface AuthorizationCodeRecord {
  clientId: string;
  params: AuthorizationParams;
  expiresAtMs: number;
}

interface TokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: string;
}

interface OAuthProviderState {
  version: 1;
  clients: OAuthClientInformationFull[];
  accessTokens: Record<string, TokenRecord>;
  refreshTokens: Record<string, TokenRecord>;
}

const CODE_TTL_MS = 5 * 60 * 1000;

export class OAuthStateStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly accessTokens = new Map<string, TokenRecord>();
  private readonly refreshTokens = new Map<string, TokenRecord>();

  constructor(private readonly statePath?: string) {
    const state = statePath ? readOAuthState(statePath) : emptyOAuthState();
    for (const client of state.clients) this.clients.set(client.client_id, client);
    for (const [token, record] of Object.entries(state.accessTokens)) this.accessTokens.set(token, record);
    for (const [token, record] of Object.entries(state.refreshTokens)) this.refreshTokens.set(token, record);
    this.pruneExpiredTokens();
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: `lp_client_${randomUUID()}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(registered.client_id, registered);
    this.save();
    return registered;
  }

  getAccessToken(token: string): TokenRecord | undefined {
    this.pruneExpiredTokens();
    return this.accessTokens.get(token);
  }

  setAccessToken(token: string, record: TokenRecord): void {
    this.accessTokens.set(token, record);
    this.save();
  }

  deleteAccessToken(token: string): void {
    if (this.accessTokens.delete(token)) this.save();
  }

  getRefreshToken(token: string): TokenRecord | undefined {
    this.pruneExpiredTokens();
    return this.refreshTokens.get(token);
  }

  setRefreshToken(token: string, record: TokenRecord): void {
    this.refreshTokens.set(token, record);
    this.save();
  }

  deleteRefreshToken(token: string): void {
    if (this.refreshTokens.delete(token)) this.save();
  }

  private pruneExpiredTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    let changed = false;
    for (const [token, record] of this.accessTokens) {
      if (record.expiresAt < now) {
        this.accessTokens.delete(token);
        changed = true;
      }
    }
    for (const [token, record] of this.refreshTokens) {
      if (record.expiresAt < now) {
        this.refreshTokens.delete(token);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private save(): void {
    if (!this.statePath) return;
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify({
      version: 1,
      clients: Array.from(this.clients.values()),
      accessTokens: Object.fromEntries(this.accessTokens),
      refreshTokens: Object.fromEntries(this.refreshTokens),
    } satisfies OAuthProviderState, null, 2) + "\n", { mode: 0o600 });
  }
}

export class LocalPortOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthStateStore;
  private readonly codes = new Map<string, AuthorizationCodeRecord>();
  private readonly resourceServerUrl: URL;

  constructor(
    private readonly config: LocalPortOAuthConfig,
    mcpServerUrl: URL,
    options: { statePath?: string } = {},
  ) {
    this.clientsStore = new OAuthStateStore(options.statePath);
    this.resourceServerUrl = resourceUrlFromServerUrl(mcpServerUrl);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (params.resource && !checkResourceAllowed({ requestedResource: params.resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidRequestError("Invalid OAuth resource");
    }
    if (!requestedScopesAllowed(params.scopes ?? this.config.scopes, this.config.scopes)) {
      throw new InvalidRequestError("Requested scope is not supported");
    }
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    if (res.req.method !== "POST") {
      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(authorizeHtml({ client, params }));
      return;
    }

    const providedToken = String(res.req.body?.owner_token ?? "");
    if (!safeEquals(providedToken, this.config.ownerToken)) {
      res.status(401).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(authorizeHtml({ client, params, error: "Owner token was not accepted." }));
      return;
    }

    const code = `lp_code_${randomUUID()}`;
    this.codes.set(code, {
      clientId: client.client_id,
      params,
      expiresAtMs: Date.now() + CODE_TTL_MS,
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state !== undefined) redirectUrl.searchParams.set("state", params.state);
    res.redirect(302, redirectUrl.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    return this.validCodeRecord(client, authorizationCode).params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.validCodeRecord(client, authorizationCode);
    if (redirectUri && redirectUri !== record.params.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match authorization request");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    this.codes.delete(authorizationCode);
    return this.issueTokens(
      client.client_id,
      record.params.scopes ?? this.config.scopes,
      resource ?? record.params.resource,
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.clientsStore.getRefreshToken(refreshToken);
    if (!record || record.clientId !== client.client_id || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    const requestedScopes = scopes ?? record.scopes;
    if (!requestedScopes.every((scope) => record.scopes.includes(scope))) {
      throw new AccessDeniedError("Refresh token cannot grant requested scopes");
    }

    this.clientsStore.deleteRefreshToken(refreshToken);
    return this.issueTokens(client.client_id, requestedScopes, resource ?? toUrl(record.resource));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.clientsStore.getAccessToken(token);
    if (!record || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError("Invalid or expired access token");
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: toUrl(record.resource),
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.clientsStore.deleteAccessToken(request.token);
    this.clientsStore.deleteRefreshToken(request.token);
  }

  private validCodeRecord(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): AuthorizationCodeRecord {
    const record = this.codes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAtMs < Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return record;
  }

  private issueTokens(clientId: string, scopes: string[], resource?: URL): OAuthTokens {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = now + this.config.accessTokenTtlSeconds;
    const refreshExpiresAt = now + this.config.refreshTokenTtlSeconds;
    const resourceHref = resource?.href;

    this.clientsStore.setAccessToken(accessToken, {
      clientId,
      scopes,
      expiresAt: accessExpiresAt,
      resource: resourceHref,
    });
    this.clientsStore.setRefreshToken(refreshToken, {
      clientId,
      scopes,
      expiresAt: refreshExpiresAt,
      resource: resourceHref,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }
}

function readOAuthState(path: string): OAuthProviderState {
  if (!existsSync(path)) return emptyOAuthState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OAuthProviderState>;
    return {
      version: 1,
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      accessTokens: parsed.accessTokens && typeof parsed.accessTokens === "object" ? parsed.accessTokens : {},
      refreshTokens: parsed.refreshTokens && typeof parsed.refreshTokens === "object" ? parsed.refreshTokens : {},
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read OAuth state ${path}: ${reason}`);
  }
}

function emptyOAuthState(): OAuthProviderState {
  return {
    version: 1,
    clients: [],
    accessTokens: {},
    refreshTokens: {},
  };
}

function requestedScopesAllowed(requested: string[], supported: string[]): boolean {
  return requested.every((scope) => supported.includes(scope));
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

function toUrl(value: string | undefined): URL | undefined {
  return value ? new URL(value) : undefined;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function authorizeHtml(params: {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  error?: string;
}): string {
  const clientName = params.client.client_name ?? params.client.client_id;
  const scopes = params.params.scopes?.join(" ") || "workspace-linker";
  const resource = params.params.resource?.href ?? "Workspace Linker MCP endpoint";
  const error = params.error ? `<p class="error">${htmlEscape(params.error)}</p>` : "";
  const fields = authorizationFormFields(params.client, params.params);
  const hiddenFields = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect Workspace Linker</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #111827; color: #f9fafb; }
      main { max-width: 440px; margin: 12vh auto; padding: 28px; background: #020617; border: 1px solid #334155; border-radius: 12px; }
      h1 { margin: 0 0 12px; font-size: 26px; }
      p, dd { color: #cbd5e1; line-height: 1.5; }
      dl { padding: 14px; background: #0f172a; border-radius: 10px; }
      dt { color: #94a3b8; font-size: 12px; text-transform: uppercase; }
      dd { margin: 4px 0 12px; word-break: break-word; }
      label { display: block; margin: 18px 0 8px; font-weight: 700; }
      input { box-sizing: border-box; width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #475569; background: #111827; color: #f9fafb; font-size: 16px; }
      button { margin-top: 16px; width: 100%; border: 0; border-radius: 8px; padding: 12px; font-weight: 800; background: #38bdf8; color: #020617; }
      .error { color: #fecaca; background: #7f1d1d; border-radius: 8px; padding: 10px; }
      .warning { color: #fde68a; }
    </style>
  </head>
  <body>
    <main>
      <h1>Connect Workspace Linker</h1>
      <p class="warning">Only approve this if you intentionally want this MCP client to control the configured workspaces on this computer.</p>
      ${error}
      <dl>
        <dt>Client</dt><dd>${htmlEscape(clientName)}</dd>
        <dt>Scope</dt><dd>${htmlEscape(scopes)}</dd>
        <dt>Resource</dt><dd>${htmlEscape(resource)}</dd>
      </dl>
      <form method="post">
        ${hiddenFields}
        <label for="owner_token">Owner token</label>
        <input id="owner_token" name="owner_token" type="password" autocomplete="current-password" required autofocus />
        <button type="submit">Authorize Workspace Linker</button>
      </form>
    </main>
  </body>
</html>`;
}

function authorizationFormFields(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): Record<string, string | undefined> {
  return {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    scope: params.scopes?.join(" "),
    state: params.state,
    resource: params.resource?.href,
  };
}
