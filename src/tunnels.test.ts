import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTunnelProvider, getTunnelProviders, listTunnelProcesses, tailscalePublicUrlFromFunnelStatus, tailscalePublicUrlFromStatusJson, tunnelCommand, tunnelDiagnostics, tunnelProviderContracts, tunnelRuntimeEvents } from "./tunnels.js";

const originalConfigDir = process.env.WORKSPACE_LINKER_CONFIG_DIR;
const originalLocalPortConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const originalOpenAiTunnelId = process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_ID;
const originalOpenAiTunnelClient = process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_CLIENT;
const root = await mkdtemp(join(tmpdir(), "workspace-linker-tunnels-test-"));

try {
  process.env.WORKSPACE_LINKER_CONFIG_DIR = root;
  delete process.env.LOCALPORT_CONFIG_DIR;
  process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_ID = "";
  process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_CLIENT = "";

assert.deepEqual(tunnelCommand({ provider: "cloudflare", localPort: 3939 }), {
  provider: "cloudflare",
  command: "cloudflared",
  args: ["tunnel", "--url", "http://127.0.0.1:3939"],
  display: "cloudflared tunnel --url http://127.0.0.1:3939",
});

assert.deepEqual(tunnelCommand({ provider: "tailscale", localPort: 3939, tailscaleMode: "serve" }), {
  provider: "tailscale",
  mode: "serve",
  command: "tailscale",
  args: ["serve", "localhost:3939"],
  display: "tailscale serve localhost:3939",
});

assert.deepEqual(tunnelCommand({ provider: "tailscale", localPort: 3939, tailscaleMode: "funnel" }), {
  provider: "tailscale",
  mode: "funnel",
  command: "tailscale",
  args: ["funnel", "--yes", "3939"],
  display: "tailscale funnel --yes 3939",
});

assert.deepEqual(tunnelCommand({ provider: "tailscale", localPort: 3939 }), {
  provider: "tailscale",
  mode: "funnel",
  command: "tailscale",
  args: ["funnel", "--yes", "3939"],
  display: "tailscale funnel --yes 3939",
});

const openAiCommand = tunnelCommand({
  provider: "openai",
  localPort: 3939,
  openaiTunnelId: "tunnel_test",
  openaiClientPath: "tunnel-client",
  ownerToken: "owner-secret",
});
assert.equal(openAiCommand.provider, "openai");
assert.equal(openAiCommand.command, "tunnel-client");
assert.deepEqual(openAiCommand.args.slice(0, 5), [
  "run",
  "--control-plane.tunnel-id",
  "tunnel_test",
  "--mcp.server-url",
  "url=http://127.0.0.1:3939/mcp",
]);
assert.ok(openAiCommand.args.includes("Authorization: env:WORKSPACE_LINKER_MCP_AUTHORIZATION"));
assert.equal(openAiCommand.env?.WORKSPACE_LINKER_MCP_AUTHORIZATION, "Bearer owner-secret");
assert.doesNotMatch(openAiCommand.display, /owner-secret/);

const openAiTunnelLog = [
  "2026/06/23 22:14:29 INFO dispatcher forwarded command to MCP server request_id=cmd_abc cmd_request_id=cmd_abc rpc_request_id=rpc_123 session_id=sess_456",
  "2026/06/23 22:14:29 WARN dispatcher received MCP upstream error; posted error response to control plane status_code=400 rpc_method=tools/call error=\"sending \\\"tools/call\\\": Bad Request\" tunnel_request_id=req_789 session_id=sess_456",
  "2026/06/24 01:22:58 WARN poll failed; backing off status_code=503 status=\"503 Service Unavailable\"",
  "2026/06/24 01:23:14 INFO poller recovered; polling operational",
].join("\n");
const openAiRuntimeEvents = tunnelRuntimeEvents([{
  id: "openai-log-test",
  provider: "openai",
  localPort: 3939,
  command: "tunnel-client",
  args: ["run"],
  display: "tunnel-client run",
  pid: process.pid,
  startedAt: new Date(0).toISOString(),
  status: "running",
  exitCode: null,
  stdout: "",
  stderr: openAiTunnelLog,
}], { includeInfo: true, limit: 20 });
assert.ok(openAiRuntimeEvents.some((event) => (
  event.kind === "dispatcher_forwarded" &&
  event.cmdRequestId === "cmd_abc" &&
  event.rpcRequestId === "rpc_123" &&
  event.sessionId === "sess_456"
)));
assert.ok(openAiRuntimeEvents.some((event) => (
  event.kind === "mcp_upstream_error" &&
  event.severity === "error" &&
  event.statusCode === 400 &&
  event.rpcMethod === "tools/call" &&
  event.tunnelRequestId === "req_789" &&
  event.detail === "sending \"tools/call\": Bad Request"
)));
assert.ok(openAiRuntimeEvents.some((event) => (
  event.kind === "controlplane_poll_failed" &&
  event.severity === "warn" &&
  event.statusCode === 503
)));
assert.ok(openAiRuntimeEvents.some((event) => event.kind === "controlplane_recovered"));
assert.equal(tunnelRuntimeEvents([{
  id: "openai-log-test-filtered",
  provider: "openai",
  localPort: 3939,
  command: "tunnel-client",
  args: ["run"],
  display: "tunnel-client run",
  startedAt: new Date(0).toISOString(),
  status: "running",
  exitCode: null,
  stdout: "",
  stderr: openAiTunnelLog,
}], { limit: 20 }).some((event) => event.kind === "dispatcher_forwarded"), false);

const diagnostics = tunnelDiagnostics({
  localPort: 3939,
  publicBaseUrl: "https://localport.example.com",
});

assert.equal(diagnostics.publicBaseUrlConfigured, true);
assert.equal(diagnostics.publicBaseUrl, "https://localport.example.com");
assert.equal(diagnostics.effectivePublicUrl, "https://localport.example.com");
assert.equal(diagnostics.effectivePublicUrlSource, "configured");
assert.equal(diagnostics.commands.length, 2);
assert.equal(diagnostics.tools.length, 3);
assert.equal(diagnostics.providerContracts.length, 3);
assert.deepEqual(diagnostics.providerContracts[0].modes, ["quick-tunnel"]);
assert.deepEqual(diagnostics.providerContracts[1].modes, ["funnel"]);
assert.deepEqual(diagnostics.providerContracts[2].modes, ["secure-mcp-tunnel"]);
assert.equal(diagnostics.providerContracts[0].lifecycle.detect, true);
assert.equal(diagnostics.providerContracts[0].lifecycle.status, true);
assert.equal(diagnostics.providerContracts[0].lifecycle.expose, true);
assert.equal(diagnostics.providerContracts[0].lifecycle.getPublicUrl, true);
assert.equal(diagnostics.providerContracts[0].lifecycle.stop, true);
assert.deepEqual(diagnostics.providerContracts.flatMap((provider) => provider.commands).map((command) => command.display), [
  "cloudflared tunnel --url http://127.0.0.1:3939",
  "tailscale funnel --yes 3939",
]);
assert.deepEqual(diagnostics.providers.map((provider) => provider.provider), ["cloudflare", "tailscale", "openai"]);
assert.equal(diagnostics.providers[0].publicUrl, "https://localport.example.com");
assert.equal(diagnostics.providers[0].publicUrlSource, "configured");
assert.equal(diagnostics.providers[0].running, false);
assert.equal(diagnostics.providers[0].commands.length, 1);
assert.equal(diagnostics.providers[1].commands.length, 1);
assert.equal(diagnostics.providers[2].commands.length, 0);

const detectedDiagnostics = tunnelDiagnostics({
  localPort: 3939,
  tunnels: [
    {
      id: "running-cloudflare",
      provider: "cloudflare",
      localPort: 3939,
      command: "cloudflared",
      args: ["tunnel", "--url", "http://127.0.0.1:3939"],
      display: "cloudflared tunnel --url http://127.0.0.1:3939",
      startedAt: new Date(0).toISOString(),
      status: "running",
      exitCode: null,
      stdout: "",
      stderr: "",
      publicUrl: "https://detected.trycloudflare.com",
    },
  ],
});
assert.equal(detectedDiagnostics.publicBaseUrlConfigured, false);
assert.equal(detectedDiagnostics.effectivePublicUrl, "https://detected.trycloudflare.com");
assert.equal(detectedDiagnostics.effectivePublicUrlSource, "running-tunnel");
assert.equal(detectedDiagnostics.providers[0].publicUrl, "https://detected.trycloudflare.com");
assert.equal(detectedDiagnostics.providers[0].publicUrlSource, "running-tunnel");
assert.equal(detectedDiagnostics.providers[0].running, true);
assert.equal(detectedDiagnostics.providers[0].runningProcessId, "running-cloudflare");

const providers = getTunnelProviders();
assert.deepEqual(providers.map((provider) => provider.name), ["cloudflare", "tailscale", "openai"]);
assert.deepEqual(tunnelProviderContracts(4000).map((provider) => provider.provider), ["cloudflare", "tailscale", "openai"]);
assert.equal(tunnelProviderContracts(4000)[0].commands[0].display, "cloudflared tunnel --url http://127.0.0.1:4000");
assert.equal(getTunnelProvider("cloudflare").command({ provider: "cloudflare", localPort: 3939 }).display, "cloudflared tunnel --url http://127.0.0.1:3939");
assert.equal(getTunnelProvider("tailscale").getPublicUrl({ localPort: 3939, publicBaseUrl: "https://tailnet.example.com" }), "https://tailnet.example.com");
assert.equal(getTunnelProvider("openai").getPublicUrl({ localPort: 3939, publicBaseUrl: "https://tailnet.example.com" }), undefined);

await mkdir(root, { recursive: true });
await writeFile(join(root, "tunnels.json"), JSON.stringify([
  {
    id: "persisted-running",
    provider: "cloudflare",
    localPort: 3939,
    command: "cloudflared",
    args: ["tunnel", "--url", "http://127.0.0.1:3939"],
    display: "cloudflared tunnel --url http://127.0.0.1:3939",
    pid: process.pid,
    startedAt: new Date(1).toISOString(),
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
    publicUrl: "https://persisted.trycloudflare.com",
  },
  {
    id: "persisted-openai",
    provider: "openai",
    localPort: 3939,
    command: "tunnel-client",
    args: ["run", "--control-plane.tunnel-id", "tunnel_test"],
    display: "tunnel-client run --control-plane.tunnel-id tunnel_test",
    pid: 2147483647,
    startedAt: new Date(2).toISOString(),
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
  },
  {
    id: "persisted-stale",
    provider: "tailscale",
    mode: "funnel",
    localPort: 3939,
    command: "tailscale",
    args: ["funnel", "--yes", "3939"],
    display: "tailscale funnel --yes 3939",
    pid: 2147483647,
    startedAt: new Date(0).toISOString(),
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
    publicUrl: "https://stale.ts.net",
  },
], null, 2));

const persistedTunnels = listTunnelProcesses();
assert.equal(persistedTunnels.find((tunnel) => tunnel.id === "persisted-running")?.status, "running");
assert.equal(persistedTunnels.find((tunnel) => tunnel.id === "persisted-running")?.publicUrl, "https://persisted.trycloudflare.com");
assert.equal(persistedTunnels.find((tunnel) => tunnel.id === "persisted-openai")?.status, "exited");
assert.equal(persistedTunnels.find((tunnel) => tunnel.id === "persisted-stale")?.status, "exited");
const persistedDiagnostics = tunnelDiagnostics({
  localPort: 3939,
  tunnels: persistedTunnels,
});
assert.equal(persistedDiagnostics.effectivePublicUrl, "https://persisted.trycloudflare.com");
assert.equal(persistedDiagnostics.effectivePublicUrlSource, "running-tunnel");
assert.equal(tailscalePublicUrlFromStatusJson(JSON.stringify({
  Self: { DNSName: "desktop.example.ts.net." },
})), "https://desktop.example.ts.net");
assert.equal(tailscalePublicUrlFromStatusJson(JSON.stringify({
  CertDomains: ["desktop.example.ts.net"],
})), "https://desktop.example.ts.net");
assert.equal(tailscalePublicUrlFromStatusJson(JSON.stringify({
  Services: {
    "https://desktop.example.ts.net": { Funnel: true },
  },
})), "https://desktop.example.ts.net");
assert.equal(tailscalePublicUrlFromFunnelStatus(JSON.stringify({
  Self: { DNSName: "desktop.example.ts.net." },
})), undefined);
assert.equal(tailscalePublicUrlFromFunnelStatus("https://desktop.example.ts.net (Funnel on)\n|-- / proxy http://127.0.0.1:3939"), "https://desktop.example.ts.net");
assert.equal(tailscalePublicUrlFromFunnelStatus("Available on the internet:\nhttps://desktop.example.ts.net"), "https://desktop.example.ts.net");
assert.equal(tailscalePublicUrlFromFunnelStatus(JSON.stringify({
  Services: {
    "https://desktop.example.ts.net": { Funnel: true },
  },
})), "https://desktop.example.ts.net");
} finally {
  if (originalConfigDir === undefined) delete process.env.WORKSPACE_LINKER_CONFIG_DIR;
  else process.env.WORKSPACE_LINKER_CONFIG_DIR = originalConfigDir;

  if (originalLocalPortConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalLocalPortConfigDir;
  if (originalOpenAiTunnelId === undefined) delete process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_ID;
  else process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_ID = originalOpenAiTunnelId;
  if (originalOpenAiTunnelClient === undefined) delete process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_CLIENT;
  else process.env.WORKSPACE_LINKER_OPENAI_TUNNEL_CLIENT = originalOpenAiTunnelClient;

  await rm(root, { recursive: true, force: true });
}
