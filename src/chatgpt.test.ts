import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatGptMcpServerUrl, chatGptPublicBaseUrl, chatGptSetupStatus, chatGptUrl } from "./chatgpt.js";
import type { LocalPortConfig } from "./permissions.js";
import type { TunnelProcessSnapshot } from "./tunnels.js";

const originalConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalLocalPortConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "computer-linker-chatgpt-test-"));

try {
process.env.COMPUTER_LINKER_CONFIG_DIR = root;
delete process.env.LOCALPORT_CONFIG_DIR;

const stoppedTunnel: TunnelProcessSnapshot = {
  id: "stopped",
  provider: "cloudflare",
  localPort: 3939,
  command: "cloudflared",
  args: ["tunnel", "--url", "http://127.0.0.1:3939"],
  display: "cloudflared tunnel --url http://127.0.0.1:3939",
  startedAt: new Date(0).toISOString(),
  endedAt: new Date(1).toISOString(),
  status: "exited",
  exitCode: 0,
  stdout: "",
  stderr: "",
  publicUrl: "https://stopped.trycloudflare.com",
};

const runningTunnel: TunnelProcessSnapshot = {
  ...stoppedTunnel,
  id: "running",
  status: "running",
  endedAt: undefined,
  exitCode: null,
  publicUrl: "https://running.trycloudflare.com",
};

assert.equal(chatGptMcpServerUrl({ publicBaseUrl: undefined }, [stoppedTunnel]), undefined);
assert.equal(chatGptMcpServerUrl({ publicBaseUrl: undefined }, [stoppedTunnel, runningTunnel]), "https://running.trycloudflare.com/mcp");
assert.equal(chatGptMcpServerUrl({ publicBaseUrl: "https://configured.example.com" }, [stoppedTunnel]), "https://configured.example.com/mcp");
assert.equal(chatGptPublicBaseUrl({ publicBaseUrl: undefined }, [stoppedTunnel, runningTunnel]), "https://running.trycloudflare.com");
assert.equal(chatGptPublicBaseUrl({ publicBaseUrl: "https://configured.example.com" }, [stoppedTunnel]), "https://configured.example.com");

const config: LocalPortConfig = {
  machineName: "test",
  ownerToken: "secret",
  publicBaseUrl: "https://configured.example.com",
  workspaces: [],
};

assert.deepEqual(chatGptUrl(config).authHeader, "Authorization: Bearer <ownerToken>");
assert.deepEqual(chatGptUrl(config, true).authHeader, "Authorization: Bearer secret");
const detectedTunnelUrl = chatGptUrl({ ...config, publicBaseUrl: undefined }, false, { tunnels: [stoppedTunnel, runningTunnel] });
assert.equal(detectedTunnelUrl.mcpServerUrl, "https://running.trycloudflare.com/mcp");
assert.equal(detectedTunnelUrl.publicBaseUrl, "https://running.trycloudflare.com");
assert.equal(detectedTunnelUrl.publicBaseUrlSource, "running-tunnel");
assert.equal(detectedTunnelUrl.configuredPublicBaseUrl, null);
assert.equal(detectedTunnelUrl.detectedPublicUrl, "https://running.trycloudflare.com");
assert.equal(detectedTunnelUrl.ready, true);
const configuredUrl = chatGptUrl(config);
assert.equal(configuredUrl.publicBaseUrl, "https://configured.example.com");
assert.equal(configuredUrl.publicBaseUrlSource, "configured");
assert.equal(configuredUrl.configuredPublicBaseUrl, "https://configured.example.com");
assert.equal(configuredUrl.detectedPublicUrl, null);

const setupStatus = chatGptSetupStatus(config, "coding");
assert.equal(setupStatus.kind, "chatgpt-setup-status");
assert.equal(setupStatus.mode, "coding");
assert.equal(setupStatus.mcpServerUrl, "https://configured.example.com/mcp");
assert.equal(setupStatus.setupFields.bearerHeader, "Authorization: Bearer <ownerToken>");
assert.equal(setupStatus.oauthDiscovery.enabled, true);
assert.equal(setupStatus.oauthDiscovery.issuer, "https://configured.example.com/");
assert.equal(setupStatus.oauthDiscovery.authorizationServerMetadataUrl, "https://configured.example.com/.well-known/oauth-authorization-server");
assert.equal(setupStatus.oauthDiscovery.protectedResourceMetadataUrl, "https://configured.example.com/.well-known/oauth-protected-resource/mcp");
assert.equal(setupStatus.cli.verify, "computer-linker client chatgpt verify --mode coding");
assert.equal(setupStatus.connectProfile.appName, "Computer Linker (test)");
assert.equal(setupStatus.connectProfile.serverUrl, "https://configured.example.com/mcp");
assert.equal(setupStatus.connectProfile.auth.bearerHeader, "Authorization: Bearer <ownerToken>");
assert.equal(setupStatus.connectProfile.auth.bearerTokenValue, "<ownerToken>");
assert.equal(setupStatus.connectProfile.auth.oauthEnabled, true);
assert.equal(setupStatus.connectProfile.cli.connectorConfig, "computer-linker client chatgpt connector --mode coding --url https://configured.example.com --show-token");
assert.match(setupStatus.connectProfile.firstPrompt, /get_computer_info/);
assert.equal(setupStatus.wizard.overallStatus, "blocked");
assert.equal(setupStatus.wizard.currentStepId, "workspace");
assert.equal(setupStatus.wizard.effectiveMcpServerUrl, "https://configured.example.com/mcp");
assert.ok(setupStatus.wizard.steps.some((step) => step.id === "oauth" && step.status === "complete"));
assert.equal(JSON.stringify(setupStatus).includes("secret"), false);

const localOnlySetupStatus = chatGptSetupStatus({ ...config, ownerToken: undefined, publicBaseUrl: undefined }, "safe");
assert.equal(localOnlySetupStatus.oauthDiscovery.enabled, false);
assert.equal(localOnlySetupStatus.oauthDiscovery.authorizationServerMetadataUrl, null);
assert.equal(localOnlySetupStatus.wizard.currentStepId, "owner_token");

const detectedTunnelSetupStatus = chatGptSetupStatus({ ...config, publicBaseUrl: undefined }, "coding", {
  tunnels: [runningTunnel],
});
assert.equal(detectedTunnelSetupStatus.wizard.detectedPublicUrl, "https://running.trycloudflare.com");
assert.equal(detectedTunnelSetupStatus.wizard.effectiveMcpServerUrl, "https://running.trycloudflare.com/mcp");
assert.equal(detectedTunnelSetupStatus.setupFields.mcpServerUrl, "https://running.trycloudflare.com/mcp");
assert.ok(detectedTunnelSetupStatus.warnings.some((warning) => warning.includes("used for this setup only")));
assert.ok(detectedTunnelSetupStatus.wizard.steps.some((step) => step.id === "public_url" && step.status === "complete"));

const readyDetectedTunnelSetupStatus = chatGptSetupStatus({
  ...config,
  publicBaseUrl: undefined,
  workspaces: [
    {
      id: "app",
      name: "App",
      path: "/tmp/app",
      permissions: { read: true, write: false, shell: false, codex: false },
    },
  ],
}, "coding", {
  tunnels: [runningTunnel],
});
assert.equal(readyDetectedTunnelSetupStatus.ready, true);
assert.equal(readyDetectedTunnelSetupStatus.wizard.overallStatus, "ready");
assert.equal(readyDetectedTunnelSetupStatus.wizard.currentStepId, null);
assert.equal(readyDetectedTunnelSetupStatus.oauthDiscovery.enabled, false);
assert.equal(readyDetectedTunnelSetupStatus.oauthDiscovery.authorizationServerMetadataUrl, null);
assert.equal(readyDetectedTunnelSetupStatus.smoke.publicCli, "computer-linker client chatgpt smoke --url https://running.trycloudflare.com");
assert.equal(readyDetectedTunnelSetupStatus.connectProfile.serverUrl, "https://running.trycloudflare.com/mcp");
assert.equal(readyDetectedTunnelSetupStatus.connectProfile.auth.oauthEnabled, false);
assert.equal(readyDetectedTunnelSetupStatus.connectProfile.cli.publicSmoke, "computer-linker client chatgpt smoke --url https://running.trycloudflare.com");
assert.ok(readyDetectedTunnelSetupStatus.wizard.steps.some((step) => step.id === "oauth" && step.status === "pending"));

const overriddenTunnelSetupStatus = chatGptSetupStatus(config, "coding", {
  tunnels: [runningTunnel],
});
assert.equal(overriddenTunnelSetupStatus.mcpServerUrl, "https://running.trycloudflare.com/mcp");
assert.equal(overriddenTunnelSetupStatus.oauthDiscovery.enabled, false);
assert.equal(overriddenTunnelSetupStatus.oauthDiscovery.authorizationServerMetadataUrl, null);
assert.ok(overriddenTunnelSetupStatus.wizard.steps.some((step) => step.id === "oauth" && step.status === "blocked"));
} finally {
  if (originalConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  else process.env.COMPUTER_LINKER_CONFIG_DIR = originalConfigDir;

  if (originalLocalPortConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalLocalPortConfigDir;

  await rm(root, { recursive: true, force: true });
}
