import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPortOAuthProvider } from "./oauth-provider.js";

const provider = new LocalPortOAuthProvider(
  {
    ownerToken: "test-owner-token",
    scopes: ["localport"],
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 120,
  },
  new URL("https://localport.example.com/mcp"),
);

const client = provider.clientsStore.registerClient?.({
  redirect_uris: ["https://chatgpt.com/oauth/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "Test client",
});

assert.ok(client);

const redirects: string[] = [];
const response = {
  req: {
    method: "POST",
    body: {
      owner_token: "test-owner-token",
    },
  },
  statusCode: 200,
  headers: new Map<string, string>(),
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  setHeader(name: string, value: string) {
    this.headers.set(name, value);
    return this;
  },
  send(_body: string) {
    return this;
  },
  redirect(_status: number, location: string) {
    redirects.push(location);
    return this;
  },
};

const params = {
  redirectUri: "https://chatgpt.com/oauth/callback",
  codeChallenge: "challenge",
  scopes: ["localport"],
  state: "state-1",
  resource: new URL("https://localport.example.com/mcp"),
};

await provider.authorize(client, params, response as never);

assert.equal(redirects.length, 1);
const redirected = new URL(redirects[0]);
const code = redirected.searchParams.get("code");
assert.ok(code);
assert.equal(redirected.searchParams.get("state"), "state-1");
assert.equal(await provider.challengeForAuthorizationCode(client, code), "challenge");

const tokens = await provider.exchangeAuthorizationCode(
  client,
  code,
  undefined,
  params.redirectUri,
  params.resource,
);
assert.equal(tokens.token_type, "bearer");
assert.equal(tokens.scope, "localport");
assert.ok(tokens.refresh_token);

const authInfo = await provider.verifyAccessToken(tokens.access_token);
assert.equal(authInfo.clientId, client.client_id);
assert.deepEqual(authInfo.scopes, ["localport"]);

const refreshed = await provider.exchangeRefreshToken(
  client,
  tokens.refresh_token,
  ["localport"],
  params.resource,
);
assert.ok(refreshed.access_token);
assert.notEqual(refreshed.access_token, tokens.access_token);

await provider.revokeToken(client, { token: refreshed.access_token });
await assert.rejects(
  () => provider.verifyAccessToken(refreshed.access_token),
  /Invalid or expired access token/,
);

const root = await mkdtemp(join(tmpdir(), "localport-oauth-test-"));
try {
  const statePath = join(root, "oauth-state.json");
  const persistentProvider = new LocalPortOAuthProvider(
    {
      ownerToken: "test-owner-token",
      scopes: ["localport"],
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 120,
    },
    new URL("https://localport.example.com/mcp"),
    { statePath },
  );
  const persistentClient = persistentProvider.clientsStore.registerClient?.({
    redirect_uris: ["https://chatgpt.com/oauth/callback"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Persistent client",
  });
  assert.ok(persistentClient);

  const persistentRedirects: string[] = [];
  await persistentProvider.authorize(persistentClient, params, {
    ...response,
    redirect(_status: number, location: string) {
      persistentRedirects.push(location);
      return this;
    },
  } as never);
  const persistentCode = new URL(persistentRedirects[0]).searchParams.get("code");
  assert.ok(persistentCode);
  const persistentTokens = await persistentProvider.exchangeAuthorizationCode(
    persistentClient,
    persistentCode,
    undefined,
    params.redirectUri,
    params.resource,
  );
  const persistentRefreshToken = persistentTokens.refresh_token;
  assert.ok(persistentRefreshToken);

  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    clients: unknown[];
    accessTokens: Record<string, unknown>;
    refreshTokens: Record<string, unknown>;
  };
  assert.equal(state.clients.length, 1);
  assert.ok(state.accessTokens[persistentTokens.access_token]);
  assert.ok(state.refreshTokens[persistentRefreshToken]);
  if (process.platform !== "win32") {
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  }

  const reloadedProvider = new LocalPortOAuthProvider(
    {
      ownerToken: "test-owner-token",
      scopes: ["localport"],
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 120,
    },
    new URL("https://localport.example.com/mcp"),
    { statePath },
  );
  assert.ok(reloadedProvider.clientsStore.getClient(persistentClient.client_id));
  const reloadedAuthInfo = await reloadedProvider.verifyAccessToken(persistentTokens.access_token);
  assert.equal(reloadedAuthInfo.clientId, persistentClient.client_id);

  const reloadedRefresh = await reloadedProvider.exchangeRefreshToken(
    persistentClient,
    persistentRefreshToken,
    ["localport"],
    params.resource,
  );
  assert.ok(reloadedRefresh.access_token);
  await reloadedProvider.revokeToken(persistentClient, { token: reloadedRefresh.access_token });
  await assert.rejects(
    () => reloadedProvider.verifyAccessToken(reloadedRefresh.access_token),
    /Invalid or expired access token/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
