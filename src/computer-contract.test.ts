import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "./config.js";
import { getComputerInfo, getMcpClientSetup } from "./computer-contract.js";

const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const originalWorkspaceConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalOwnerToken = process.env.COMPUTER_LINKER_OWNER_TOKEN;
const originalLegacyOwnerToken = process.env.LOCALPORT_OWNER_TOKEN;
const originalPublicBaseUrl = process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
const originalLegacyPublicBaseUrl = process.env.LOCALPORT_PUBLIC_BASE_URL;
const root = await mkdtemp(join(tmpdir(), "computer-linker-computer-contract-test-"));

try {
  process.env.LOCALPORT_CONFIG_DIR = join(root, "config");
  delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  delete process.env.COMPUTER_LINKER_OWNER_TOKEN;
  delete process.env.LOCALPORT_OWNER_TOKEN;
  delete process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
  delete process.env.LOCALPORT_PUBLIC_BASE_URL;

  writeConfig({
    machineName: "client-setup-test",
    host: "127.0.0.1",
    port: 3991,
    ownerToken: undefined,
    workspaces: [
      {
        id: "app",
        name: "Contract app",
        path: join(root, "workspace"),
        permissions: { read: true, write: false, shell: false, codex: false, screen: false },
      },
    ],
  });
  const defaultComputerInfo = getComputerInfo() as {
    scopes: Array<{ id: string; displayPath: string; roots?: string[]; pathPrivacy: { rootsRedacted: boolean } }>;
  };
  assert.equal(defaultComputerInfo.scopes[0].id, "app");
  assert.equal(defaultComputerInfo.scopes[0].displayPath, "workspace");
  assert.equal(defaultComputerInfo.scopes[0].pathPrivacy.rootsRedacted, true);
  assert.equal(defaultComputerInfo.scopes[0].roots, undefined);
  assert.equal(JSON.stringify(defaultComputerInfo).includes(root), false);

  const detailedComputerInfo = getComputerInfo({ include: ["roots"] }) as {
    scopes: Array<{ roots?: string[]; pathPrivacy: { rootsRedacted: boolean } }>;
  };
  assert.equal(detailedComputerInfo.scopes[0].pathPrivacy.rootsRedacted, false);
  assert.deepEqual(detailedComputerInfo.scopes[0].roots, [join(root, "workspace")]);

  const localSetup = getMcpClientSetup({ tunnels: [] }) as {
    ready: boolean;
    localReady: boolean;
    remoteReady: boolean;
    blockingReasons: string[];
    remoteBlockingReasons: string[];
    warnings: string[];
    nextActions: string[];
  };
  assert.equal(localSetup.ready, true);
  assert.equal(localSetup.localReady, true);
  assert.equal(localSetup.remoteReady, false);
  assert.deepEqual(localSetup.blockingReasons, []);
  assert.ok(localSetup.remoteBlockingReasons.some((reason) => reason.includes("ownerToken")));
  assert.ok(localSetup.remoteBlockingReasons.some((reason) => reason.includes("No public MCP URL")));
  assert.ok(localSetup.warnings.some((warning) => warning.includes("local stdio/loopback clients can still connect")));
  assert.ok(localSetup.nextActions.some((action) => action.includes("For local clients")));

  writeConfig({
    machineName: "client-setup-test",
    host: "127.0.0.1",
    port: 3991,
    ownerToken: "owner-token",
    publicBaseUrl: "https://mcp.example.com",
    workspaces: [],
  });
  const remoteSetup = getMcpClientSetup({ tunnels: [] }) as {
    ready: boolean;
    remoteReady: boolean;
    auth: { bearerHeader: string | null; alternateBearerHeader: string | null };
    blockingReasons: string[];
    remoteBlockingReasons: string[];
    nextActions: string[];
  };
  assert.equal(remoteSetup.ready, true);
  assert.equal(remoteSetup.remoteReady, true);
  assert.equal(remoteSetup.auth.bearerHeader, "Authorization: Bearer <ownerToken>");
  assert.equal(remoteSetup.auth.alternateBearerHeader, "x-computer-linker-token: <ownerToken>");
  assert.deepEqual(remoteSetup.blockingReasons, []);
  assert.deepEqual(remoteSetup.remoteBlockingReasons, []);
  assert.ok(remoteSetup.nextActions.some((action) => action.includes("Use the public MCP URL")));
  const remoteSetupWithSecrets = getMcpClientSetup({ tunnels: [], includeSecrets: true }) as {
    auth: { bearerHeader: string | null; alternateBearerHeader: string | null };
  };
  assert.equal(remoteSetupWithSecrets.auth.bearerHeader, "Authorization: Bearer owner-token");
  assert.equal(remoteSetupWithSecrets.auth.alternateBearerHeader, "x-computer-linker-token: owner-token");

  writeConfig({
    machineName: "client-setup-test",
    host: "127.0.0.1",
    port: 3991,
    ownerToken: "owner-token",
    workspaces: [],
  });
  const openAiTunnelSetup = getMcpClientSetup({
    tunnels: [{
      id: "managed-openai",
      provider: "openai",
      mode: "secure-mcp-tunnel",
      localPort: 3991,
      command: "tunnel-client",
      args: ["run", "--control-plane.tunnel-id", "tunnel_contract"],
      display: "tunnel-client run --control-plane.tunnel-id tunnel_contract",
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      stdout: "",
      stderr: "",
    }],
  }) as {
    remoteReady: boolean;
    connection: { publicMcpUrl: string | null; tunnel: { provider: string; tunnelId: string; localMcpTarget: string; publicUrlRequired: boolean } | null };
    auth: { mode: string; bearerHeader: string | null; localBearerHeader: string | null; notes: string[] };
    remoteBlockingReasons: string[];
    warnings: string[];
    nextActions: string[];
  };
  assert.equal(openAiTunnelSetup.remoteReady, true);
  assert.equal(openAiTunnelSetup.connection.publicMcpUrl, null);
  assert.equal(openAiTunnelSetup.connection.tunnel?.provider, "openai");
  assert.equal(openAiTunnelSetup.connection.tunnel?.tunnelId, "tunnel_contract");
  assert.equal(openAiTunnelSetup.connection.tunnel?.localMcpTarget, "http://127.0.0.1:3991/mcp");
  assert.equal(openAiTunnelSetup.connection.tunnel?.publicUrlRequired, false);
  assert.equal(openAiTunnelSetup.auth.mode, "openai-secure-tunnel");
  assert.equal(openAiTunnelSetup.auth.bearerHeader, null);
  assert.equal(openAiTunnelSetup.auth.localBearerHeader, "Authorization: Bearer <ownerToken>");
  assert.ok(openAiTunnelSetup.auth.notes.some((note) => note.includes("do not paste a bearer token")));
  assert.equal(openAiTunnelSetup.remoteBlockingReasons.some((reason) => reason.includes("No public MCP URL")), false);
  assert.equal(openAiTunnelSetup.warnings.some((warning) => warning.includes("No public MCP URL")), false);
  assert.ok(openAiTunnelSetup.nextActions.some((action) => action.includes("Tunnel mode") && action.includes("tunnel_contract")));

  writeConfig({
    machineName: "client-setup-test",
    host: "127.0.0.1",
    port: 3991,
    ownerToken: "owner-token",
    publicBaseUrl: "http://127.0.0.1:3991",
    workspaces: [],
  });
  const insecureRemoteSetup = getMcpClientSetup({ tunnels: [] }) as {
    ready: boolean;
    remoteReady: boolean;
    blockingReasons: string[];
    remoteBlockingReasons: string[];
  };
  assert.equal(insecureRemoteSetup.ready, true);
  assert.equal(insecureRemoteSetup.remoteReady, false);
  assert.deepEqual(insecureRemoteSetup.blockingReasons, []);
  assert.ok(insecureRemoteSetup.remoteBlockingReasons.some((reason) => reason.includes("https://")));
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;
  if (originalWorkspaceConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  else process.env.COMPUTER_LINKER_CONFIG_DIR = originalWorkspaceConfigDir;
  if (originalOwnerToken === undefined) delete process.env.COMPUTER_LINKER_OWNER_TOKEN;
  else process.env.COMPUTER_LINKER_OWNER_TOKEN = originalOwnerToken;
  if (originalLegacyOwnerToken === undefined) delete process.env.LOCALPORT_OWNER_TOKEN;
  else process.env.LOCALPORT_OWNER_TOKEN = originalLegacyOwnerToken;
  if (originalPublicBaseUrl === undefined) delete process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
  else process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = originalPublicBaseUrl;
  if (originalLegacyPublicBaseUrl === undefined) delete process.env.LOCALPORT_PUBLIC_BASE_URL;
  else process.env.LOCALPORT_PUBLIC_BASE_URL = originalLegacyPublicBaseUrl;
  await rm(root, { recursive: true, force: true });
}
