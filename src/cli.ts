#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expandHomePath } from "./permissions.js";
import type { LocalPortConfig, WorkspacePolicy } from "./permissions.js";
import { loadConfig } from "./config.js";
import { configPath, generateOwnerToken, writeConfig, writeDefaultConfig } from "./config.js";
import { getLocalPortDoctor } from "./capabilities.js";
import { chatGptSmoke, chatGptUrl, chatGptVerify, formatChatGptSmoke, formatChatGptUrl, formatChatGptVerify, parseChatGptVerifyMode } from "./chatgpt.js";
import { formatWorkspaceLinkerClientSmoke, runWorkspaceLinkerMcpClientSmoke } from "./client-smoke.js";
import type { WorkspaceLinkerClientSmokeReport } from "./client-smoke.js";
import { getMcpClientSetup } from "./computer-contract.js";
import { computerOperationContract, publicComputerOperationRegistry } from "./computer-operation-registry.js";
import { historyInsight, historyInsightView, type HistoryInsight, type HistoryInsightView } from "./history-insights.js";
import { workspaceLinkerVersion } from "./package-metadata.js";
import { chatGptAppManifest, chatGptConnectProfile, chatGptConnectorConfig, connectionProfile, parseChatGptProfileMode } from "./profile.js";
import {
  defaultServiceOutputDir,
  formatServicePlan,
  formatServiceLogs,
  formatServiceStatus,
  parseServiceFormat,
  parseServicePlatform,
  servicePlan,
  serviceLogs,
  serviceProfileOutput,
  serviceStatus,
  writeServiceProfileFiles,
} from "./service.js";
import { serveHttp, serveStdio } from "./server.js";
import { screenshotCapability } from "./screenshot.js";
import { configuredOpenAiTunnelId, ensureOpenAiTunnelClientInstalled, exposeWithTunnel, listTunnelProcesses, refreshTunnelPublicUrl, startTunnelProcess, tunnelDiagnostics, type TailscaleMode, type TunnelProviderName, type TunnelProcessSnapshot } from "./tunnels.js";

type Command = "init" | "serve" | "start" | "quickstart" | "status" | "self-test" | "expose" | "tunnel" | "service" | "workspace" | "process" | "screen" | "doctor" | "diagnose" | "history" | "profile" | "client" | "config" | "setup" | "help" | "version";

interface StatusFinding {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string;
  workspaceId?: string;
}

type WorkspaceConfigEntry = LocalPortConfig["workspaces"][number];

interface PermissionPresetFlags {
  readOnly: boolean;
  dev: boolean;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen: boolean;
}

function permissionPresetFlags(args: string[], commandLabel: string): PermissionPresetFlags {
  assertReadOnlyNotMixed(args, commandLabel);
  const readOnly = args.includes("--read-only");
  const fullTrust = args.includes("--full-trust");
  const dev = args.includes("--dev") || args.includes("--coding");
  const development = dev || fullTrust;
  return {
    readOnly,
    dev,
    write: !readOnly && (development || args.includes("--write")),
    shell: !readOnly && (development || args.includes("--shell")),
    codex: !readOnly && (fullTrust || args.includes("--codex")),
    screen: !readOnly && (fullTrust || args.includes("--screen")),
  };
}

function assertReadOnlyNotMixed(args: string[], commandLabel: string): void {
  if (!args.includes("--read-only")) return;
  const conflicts = ["--dev", "--coding", "--full-trust", "--write", "--shell", "--codex", "--screen"]
    .filter((flag) => args.includes(flag));
  if (conflicts.length > 0) {
    throw new Error(`${commandLabel} --read-only cannot be combined with ${conflicts.join(", ")}`);
  }
}

async function main(argv: string[]): Promise<void> {
  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "init":
      init(args);
      return;
    case "serve":
      await serve(args);
      return;
    case "start":
      await start(args);
      return;
    case "quickstart":
      quickstart(args);
      return;
    case "status":
      status(args);
      return;
    case "self-test":
      await selfTest(args);
      return;
    case "expose":
      await expose(args);
      return;
    case "tunnel":
      tunnel(args);
      return;
    case "service":
      service(args);
      return;
    case "workspace":
      workspace(args);
      return;
    case "process":
      await processCommand(args);
      return;
    case "screen":
      screen(args);
      return;
    case "doctor":
      doctor(args);
      return;
    case "diagnose":
      await diagnose(args);
      return;
    case "history":
      history(args);
      return;
    case "profile":
      profile(args);
      return;
    case "client":
      await client(args);
      return;
    case "config":
      config(args);
      return;
    case "setup":
      setup(args);
      return;
    case "help":
      printHelp(args);
      return;
    case "version":
      printVersion();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command) return "help";
  if (command === "serve") return "serve";
  if (command === "connect-profile") throw new Error("connect-profile was removed; use `computer-linker client chatgpt profile` only when ChatGPT asks for connector-specific fields.");
  if (command === "chatgpt") throw new Error("chatgpt was removed; use `computer-linker client chatgpt <subcommand>` only when ChatGPT asks for connector-specific fields.");
  if (command === "init" || command === "start" || command === "quickstart" || command === "status" || command === "self-test" || command === "expose" || command === "tunnel" || command === "service" || command === "workspace" || command === "process" || command === "screen" || command === "doctor" || command === "diagnose" || command === "history" || command === "profile" || command === "client" || command === "config" || command === "setup") return command;
  if (command === "version" || command === "--version" || command === "-v") return "version";
  if (command === "help" || command === "--help" || command === "-h") return "help";
  throw new Error(`Unknown command: ${command}`);
}

interface CliStatusReport {
  kind: "computer-linker-status";
  schemaVersion: 1;
  machine: {
    machineId?: string;
    machineName: string;
  };
  configPath: string;
  ready: boolean;
  status: string;
  urls: {
    localMcpUrl: string;
    localApiUrl: string;
    publicMcpUrl?: string;
    publicBaseUrl?: string;
  };
  auth: {
    ownerTokenConfigured: boolean;
    mode: string;
    localOnly: boolean;
  };
  workspaces: {
    total: number;
    items: Array<{
      id: string;
      name: string;
      path: string;
      permissions: {
        read: boolean;
        write: boolean;
        shell: boolean;
        codex: boolean;
        screen?: boolean;
      };
    }>;
  };
  tunnel: {
    effectivePublicUrl?: string;
    effectivePublicUrlSource?: string;
    openAiSecureTunnelActive: boolean;
    running: Array<{
      provider: string;
      publicUrl?: string;
      processId?: string;
    }>;
  };
  readiness: {
    startupReady: boolean;
    releaseStatus: string;
    readyForTunnel: boolean;
    blockingReasons: string[];
    warnings: string[];
    configCriticalCount: number;
    configWarningCount: number;
    securityCriticalCount: number;
    securityWarningCount: number;
  };
  nextActions: string[];
}

function status(args: string[]): void {
  if (hasHelpFlag(args)) {
    printStatusHelp();
    return;
  }
  const unknown = args.filter((arg) => arg !== "--json" && arg !== "--details");
  if (unknown.length > 0) throw new Error(`Unknown status option: ${unknown[0]}`);
  const report = cliStatusReport();
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  process.stdout.write(args.includes("--details") ? formatDetailedCliStatus(report) : formatCliStatus(report));
}

interface SelfTestReport {
  kind: "computer-linker-self-test";
  schemaVersion: 1;
  ready: boolean;
  tempRoot: string;
  tempKept: boolean;
  configDir: string;
  workspacePath: string;
  localMcpUrl: string;
  localApiUrl: string;
  smoke: WorkspaceLinkerClientSmokeReport;
  nextActions: string[];
}

async function selfTest(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    printSelfTestHelp();
    return;
  }
  const unknown = args.filter((arg, index) => (
    arg !== "--json" &&
    arg !== "--keep-temp" &&
    arg !== "--timeout-ms" &&
    args[index - 1] !== "--timeout-ms"
  ));
  if (unknown.length > 0) throw new Error(`Unknown self-test option: ${unknown[0]}`);
  const timeoutMs = readOptionalIntegerOption(args, "--timeout-ms", "self-test --timeout-ms") ?? 8000;
  const keepTemp = args.includes("--keep-temp");
  const tempRoot = mkdtempSync(join(tmpdir(), "computer-linker-self-test-"));
  const configDir = join(tempRoot, "config");
  const workspacePath = join(tempRoot, "workspace");
  const previousWorkspaceConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  const previousLocalPortConfigDir = process.env.LOCALPORT_CONFIG_DIR;
  let server: ReturnType<typeof serveHttp> | undefined;

  try {
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(join(workspacePath, "README.md"), "# Computer Linker self-test\n\nThis temporary workspace is safe to delete.\n", "utf8");
    const port = await findAvailableLoopbackPort();
    process.env.COMPUTER_LINKER_CONFIG_DIR = configDir;
    delete process.env.LOCALPORT_CONFIG_DIR;
    const config: LocalPortConfig = {
      machineName: "computer-linker-self-test",
      host: "127.0.0.1",
      port,
      ownerToken: generateOwnerToken(),
      workspaces: [
        {
          id: "app",
          name: "Self Test",
          path: workspacePath,
          permissions: { read: true, write: false, shell: false, codex: false },
        },
      ],
    };
    writeConfig(config);
    server = serveHttp();
    await waitForSelfTestServer(`http://127.0.0.1:${port}`, timeoutMs);
    const smoke = await runWorkspaceLinkerMcpClientSmoke(config, {
      url: `http://127.0.0.1:${port}`,
      allowHttp: true,
      timeoutMs,
    });
    const report: SelfTestReport = {
      kind: "computer-linker-self-test",
      schemaVersion: 1,
      ready: smoke.ready,
      tempRoot,
      tempKept: keepTemp,
      configDir,
      workspacePath,
      localMcpUrl: `http://127.0.0.1:${port}/mcp`,
      localApiUrl: `http://127.0.0.1:${port}/api/v1`,
      smoke,
      nextActions: smoke.ready
        ? ["Installed CLI, local HTTP server, MCP SDK transport, and generic MCP tools are working."]
        : smoke.nextActions,
    };
    if (args.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(formatSelfTestReport(report));
    }
    if (!report.ready) throw new Error("computer-linker self-test failed");
  } finally {
    if (server) server.close();
    if (previousWorkspaceConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = previousWorkspaceConfigDir;
    if (previousLocalPortConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
    else process.env.LOCALPORT_CONFIG_DIR = previousLocalPortConfigDir;
    if (!keepTemp) rmSync(tempRoot, { recursive: true, force: true });
  }
}

function formatSelfTestReport(report: SelfTestReport): string {
  const lines = [
    "Computer Linker self-test",
    `ready: ${report.ready ? "yes" : "no"}`,
    `localMcpUrl: ${report.localMcpUrl}`,
    `localApiUrl: ${report.localApiUrl}`,
    `temp: ${report.tempKept ? report.tempRoot : "removed"}`,
    "checks:",
    ...report.smoke.checks.map((check) => `  [${check.status}] ${check.id}: ${check.message}${check.statusCode ? ` (${check.statusCode})` : ""}${check.durationMs !== undefined ? ` ${check.durationMs}ms` : ""}`),
    "next actions:",
    ...report.nextActions.map((action) => `  - ${action}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function findAvailableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
  if (!address || typeof address === "string") throw new Error("Unable to allocate a loopback port for self-test.");
  return address.port;
}

async function waitForSelfTestServer(origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Self-test server did not become ready: ${lastError || "timeout"}`);
}

function cliStatusReport(): CliStatusReport {
  const config = loadConfig();
  const doctor = getLocalPortDoctor() as {
    machineId?: string;
    machineName: string;
    readyForTunnel: boolean;
    auth: { ownerTokenConfigured: boolean; mode: string; localOnly: boolean };
    exposure: {
      publicMcpUrl?: string;
      publicBaseUrl?: string;
      blockingReasons: string[];
      warnings: string[];
    };
    runtime: {
      localMcpUrl: string;
      localApiUrl: string;
    };
    startup: { ready: boolean };
    configDiagnostics: { criticalCount: number; warningCount: number; findings: StatusFinding[] };
    security: { criticalCount: number; warningCount: number; findings: StatusFinding[] };
    releaseReadiness: { ready: boolean; status: string; blockingReasons: string[]; warnings: string[] };
    nextActions: string[];
  };
  const tunnel = tunnelDiagnostics({
    localPort: config.port ?? 3939,
    publicBaseUrl: config.publicBaseUrl,
    tunnels: listTunnelProcesses(),
  });
  const openAiSecureTunnelActive = tunnel.providers.some((provider) => provider.provider === "openai" && provider.running);
  const publicBaseUrlNotRequired = openAiSecureTunnelActive && !config.publicBaseUrl && !tunnel.effectivePublicUrl;
  const configWarningFindings = doctor.configDiagnostics.findings.filter((finding) => finding.severity === "warning");
  const securityWarningFindings = doctor.security.findings.filter((finding) => (
    finding.severity === "warning" &&
    !(publicBaseUrlNotRequired && finding.id === "public-base-url-missing")
  ));
  const blockingReasons = uniqueText([
    ...doctor.exposure.blockingReasons,
    ...doctor.releaseReadiness.blockingReasons,
    ...findingSummaries("config", doctor.configDiagnostics.findings, "critical"),
    ...findingSummaries("security", doctor.security.findings, "critical"),
  ]);
  const warningFindingIds = new Set([
    ...configWarningFindings.map((finding) => finding.id),
    ...securityWarningFindings.map((finding) => finding.id),
  ]);
  const warnings = uniqueText([
    ...doctor.exposure.warnings.filter((warning) => (
      !warningFindingIds.has(warning) &&
      !(publicBaseUrlNotRequired && warning === "public-base-url-missing") &&
      !(publicBaseUrlNotRequired && warning.includes("publicBaseUrl"))
    )),
    ...findingSummaries("config", configWarningFindings, "warning"),
    ...findingSummaries("security", securityWarningFindings, "warning"),
  ]);
  const nextActions = statusNextActions({
    base: doctor.nextActions,
    workspaces: config.workspaces,
    configFindings: doctor.configDiagnostics.findings,
    securityFindings: doctor.security.findings,
    publicBaseUrlNotRequired,
    openAiSecureTunnelActive,
  });

  return {
    kind: "computer-linker-status",
    schemaVersion: 1,
    machine: {
      machineId: doctor.machineId,
      machineName: doctor.machineName,
    },
    configPath: configPath(),
    ready: doctor.startup.ready && doctor.releaseReadiness.ready && doctor.configDiagnostics.criticalCount === 0 && doctor.security.criticalCount === 0,
    status: doctor.releaseReadiness.status,
    urls: {
      localMcpUrl: doctor.runtime.localMcpUrl,
      localApiUrl: doctor.runtime.localApiUrl,
      publicMcpUrl: doctor.exposure.publicMcpUrl,
      publicBaseUrl: doctor.exposure.publicBaseUrl,
    },
    auth: doctor.auth,
    workspaces: {
      total: config.workspaces.length,
      items: config.workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        permissions: workspace.permissions,
      })),
    },
    tunnel: {
      effectivePublicUrl: tunnel.effectivePublicUrl,
      effectivePublicUrlSource: tunnel.effectivePublicUrlSource,
      openAiSecureTunnelActive,
      running: tunnel.providers
        .filter((provider) => provider.running)
        .map((provider) => ({
          provider: provider.provider,
          publicUrl: provider.publicUrl,
          processId: provider.runningProcessId,
        })),
    },
    readiness: {
      startupReady: doctor.startup.ready,
      releaseStatus: doctor.releaseReadiness.status,
      readyForTunnel: doctor.readyForTunnel,
      blockingReasons,
      warnings,
      configCriticalCount: doctor.configDiagnostics.criticalCount,
      configWarningCount: doctor.configDiagnostics.warningCount,
      securityCriticalCount: doctor.security.criticalCount,
      securityWarningCount: doctor.security.warningCount,
    },
    nextActions,
  };
}

function formatCliStatus(report: CliStatusReport): string {
  const lines = [
    `Computer Linker status for ${report.machine.machineName}`,
    `ready: ${humanReadiness(report)}`,
    `connect: ${statusConnectionSummary(report)}`,
    `local MCP: ${report.urls.localMcpUrl}`,
    `auth: ${statusAuthSummary(report)}`,
    `workspaces: ${statusWorkspaceSummary(report.workspaces.items)}`,
    `tunnel: ${statusTunnelSummary(report)}`,
  ];

  if (report.readiness.blockingReasons.length > 0) {
    lines.push("blocked by:");
    for (const reason of report.readiness.blockingReasons.slice(0, 3)) lines.push(`  - ${formatStatusIssue(reason)}`);
    appendRemainingCount(lines, report.readiness.blockingReasons.length, 3, "blocking reason", "status --details");
  } else if (report.readiness.warnings.length > 0) {
    lines.push(`attention: ${report.readiness.warnings.length} warning${report.readiness.warnings.length === 1 ? "" : "s"}; run \`computer-linker status --details\``);
  }

  lines.push("next:");
  const nextActions = report.nextActions.length > 0 ? report.nextActions.slice(0, 3) : ["No action needed."];
  for (const action of nextActions) lines.push(`  - ${action}`);
  appendRemainingCount(lines, report.nextActions.length, 3, "action", "status --details");
  lines.push("details: computer-linker status --details");
  return `${lines.join("\n")}\n`;
}

function formatDetailedCliStatus(report: CliStatusReport): string {
  const tunnelStatus = report.tunnel.effectivePublicUrl
    ? `${report.tunnel.effectivePublicUrl}${report.tunnel.effectivePublicUrlSource ? ` (${report.tunnel.effectivePublicUrlSource})` : ""}`
    : report.tunnel.openAiSecureTunnelActive
      ? "openai secure MCP tunnel active (no public URL)"
      : "not detected";
  const publicMcpUrl = report.urls.publicMcpUrl
    ?? (report.tunnel.openAiSecureTunnelActive ? "not used in OpenAI tunnel mode" : "not configured");
  const lines = [
    `Computer Linker status for ${report.machine.machineName}`,
    `operational: ${report.ready ? "yes" : "no"}`,
    `readiness: ${humanReadiness(report)}`,
    `config: ${report.configPath}`,
    `local MCP URL: ${report.urls.localMcpUrl}`,
    `public MCP URL: ${publicMcpUrl}`,
    `auth: ${humanAuthStatus(report.auth)}`,
    `workspaces: ${report.workspaces.total}`,
    ...report.workspaces.items.map((workspace) => (
      `  ${workspace.id}: ${workspace.path} ${permissionSummary(workspace.permissions)}`
    )),
    `tunnel: ${tunnelStatus}`,
  ];
  if (report.tunnel.running.length > 0) {
    lines.push("running tunnels:");
    for (const tunnel of report.tunnel.running) {
      lines.push(`  ${tunnel.provider}: ${tunnel.publicUrl ?? tunnel.processId ?? "running"}`);
    }
  }
  if (report.readiness.blockingReasons.length > 0) {
    lines.push("blocking reasons:");
    for (const reason of report.readiness.blockingReasons) lines.push(`  - ${reason}`);
  }
  if (report.readiness.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of report.readiness.warnings) lines.push(`  - ${formatStatusIssue(warning)}`);
  }
  lines.push("next actions:");
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  return `${lines.join("\n")}\n`;
}

function appendRemainingCount(lines: string[], total: number, shown: number, singularLabel: string, command: string): void {
  const remaining = total - shown;
  if (remaining <= 0) return;
  const label = remaining === 1 ? singularLabel : `${singularLabel}s`;
  const displayCommand = command.startsWith("computer-linker ") || command.startsWith("npm ") ? command : `computer-linker ${command}`;
  lines.push(`  - ${remaining} more ${label} in \`${displayCommand}\``);
}

function humanReadiness(report: CliStatusReport): "ready" | "ready with warnings" | "blocked" {
  if (!report.ready || report.readiness.blockingReasons.length > 0) return "blocked";
  if (report.readiness.warnings.length > 0 || report.status !== "ready") return "ready with warnings";
  return "ready";
}

function statusConnectionSummary(report: CliStatusReport): string {
  if (report.tunnel.openAiSecureTunnelActive) return "OpenAI Tunnel mode; no public URL or pasted bearer token";
  if (report.urls.publicMcpUrl) return report.urls.publicMcpUrl;
  if (report.tunnel.effectivePublicUrl) return new URL("/mcp", report.tunnel.effectivePublicUrl).href;
  return `local only at ${report.urls.localMcpUrl}`;
}

function statusAuthSummary(report: CliStatusReport): string {
  if (report.tunnel.openAiSecureTunnelActive) return "handled by local tunnel-client";
  return humanAuthStatus(report.auth);
}

function statusWorkspaceSummary(workspaces: CliStatusReport["workspaces"]["items"]): string {
  if (workspaces.length === 0) return "none configured";
  const writeCount = workspaces.filter((workspace) => workspace.permissions.write).length;
  const commandCount = workspaces.filter((workspace) => workspace.permissions.shell || workspace.permissions.codex).length;
  const parts = [`${workspaces.length} configured`];
  if (writeCount > 0) parts.push(`${writeCount} write`);
  if (commandCount > 0) parts.push(`${commandCount} command`);
  return parts.join(", ");
}

function statusTunnelSummary(report: CliStatusReport): string {
  if (report.tunnel.openAiSecureTunnelActive) return "OpenAI Secure MCP Tunnel active";
  if (report.tunnel.effectivePublicUrl) {
    const label = report.tunnel.effectivePublicUrlSource === "running-tunnel" ? "public tunnel active" : "public URL configured";
    return `${label} (${report.tunnel.effectivePublicUrl})`;
  }
  if (report.tunnel.running.length > 0) return `${report.tunnel.running.length} tunnel process${report.tunnel.running.length === 1 ? "" : "es"} running`;
  return "not active";
}

function humanAuthStatus(auth: CliStatusReport["auth"]): string {
  if (auth.ownerTokenConfigured) return "owner token configured";
  if (auth.localOnly) return "loopback only; run `computer-linker init` before exposing";
  return auth.mode.replaceAll("-", " ");
}

function permissionSummary(permissions: CliStatusReport["workspaces"]["items"][number]["permissions"]): string {
  const enabled = [
    permissions.read ? "read" : "",
    permissions.write ? "write" : "",
    permissions.shell ? "shell" : "",
    permissions.codex ? "codex" : "",
    permissions.screen ? "screen" : "",
  ].filter(Boolean);
  return `[${enabled.join(",") || "none"}]`;
}

function findingSummaries(prefix: "config" | "security", findings: StatusFinding[], severity: StatusFinding["severity"]): string[] {
  return findings
    .filter((finding) => finding.severity === severity)
    .map((finding) => {
      const scope = finding.workspaceId ? `:${finding.workspaceId}` : "";
      return `${prefix}:${finding.id}${scope} - ${finding.title}`;
    });
}

function formatStatusIssue(issue: string): string {
  const parsed = /^([a-z]+):([^:\s]+)(?::([^ ]+))? - (.+)$/.exec(issue);
  if (!parsed) return issue;
  const [, , id, workspaceId, title] = parsed;
  const workspace = workspaceId ? `workspace ${workspaceId}` : "configuration";
  switch (id) {
    case "workspace-path-duplicate":
      return workspaceId
        ? `Duplicate workspace path: ${workspaceId} points at a folder already exposed by another workspace.`
        : "Duplicate workspace path detected.";
    case "workspace-execution-policy-missing":
      return `${capitalize(workspace)} can run local commands but has no execution policy yet.`;
    case "shell-broad-access":
      return `${capitalize(workspace)} has shell access enabled. Review it before exposing this computer to a remote MCP client.`;
    case "command-allowlist-missing":
      return `${capitalize(workspace)} can run commands but has no command allowlist yet.`;
    case "workspace-command-allowlist-missing":
      return `${capitalize(workspace)} can run commands but has no command allowlist yet.`;
    case "public-base-url-missing":
      return "Public base URL is not configured. Local clients can still connect; remote URL-based clients need a tunnel URL.";
    case "public-base-url-not-https":
      return "Public base URL is not HTTPS. Remote cloud MCP clients usually require HTTPS.";
    default:
      return `${title}${workspaceId ? ` (${workspace})` : ""}.`;
  }
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function statusNextActions(input: {
  base: string[];
  workspaces: WorkspaceConfigEntry[];
  configFindings: StatusFinding[];
  securityFindings: StatusFinding[];
  publicBaseUrlNotRequired: boolean;
  openAiSecureTunnelActive: boolean;
}): string[] {
  const actions: string[] = [];
  const executionPolicyAction = statusExecutionPolicyAction(input.workspaces, input.configFindings, input.securityFindings);
  if (executionPolicyAction) actions.push(executionPolicyAction);
  for (const action of duplicateWorkspacePathActions(input.workspaces, input.configFindings)) actions.push(action);
  if (input.openAiSecureTunnelActive) {
    actions.push("OpenAI Secure MCP Tunnel is running; use Tunnel mode in the MCP client, no public URL is required.");
  }
  actions.push(...input.base.filter((action) => (
    !(input.publicBaseUrlNotRequired && action.includes("publicBaseUrl")) &&
    !action.includes("Review releaseReadiness.warnings")
  )));
  return uniqueText(actions).slice(0, 6);
}

function statusExecutionPolicyAction(
  workspaces: WorkspaceConfigEntry[],
  configFindings: StatusFinding[],
  securityFindings: StatusFinding[],
): string | undefined {
  const affectedWorkspaceIds = new Set([
    ...configFindings
      .filter((finding) => finding.id === "workspace-execution-policy-missing" && finding.workspaceId)
      .map((finding) => finding.workspaceId as string),
    ...securityFindings
      .filter((finding) => finding.id === "command-allowlist-missing" && finding.workspaceId)
      .map((finding) => finding.workspaceId as string),
  ]);
  if (affectedWorkspaceIds.size === 0) return undefined;

  const affectedWorkspaces = workspaces.filter((workspace) => affectedWorkspaceIds.has(workspace.id));
  const bootstrapWorkspaces = affectedWorkspaces.filter(isBootstrapDefaultWorkspace);
  const bootstrapWillBeRemoved = bootstrapWorkspaces.length > 0 && workspaces.length > bootstrapWorkspaces.length;
  const affectedNonBootstrap = affectedWorkspaces.filter((workspace) => !isBootstrapDefaultWorkspace(workspace));

  if (bootstrapWillBeRemoved && affectedNonBootstrap.length === 0) {
    return "Run `computer-linker doctor --fix` to remove the default current-directory scope now that explicit workspaces are configured.";
  }
  if (bootstrapWillBeRemoved) {
    return "Run `computer-linker doctor --fix` to remove the default current-directory scope and add default execution policy for remaining shell/Codex scopes.";
  }
  return "Run `computer-linker doctor --fix` to add default execution policy for shell/Codex scopes.";
}

function duplicateWorkspacePathActions(workspaces: WorkspaceConfigEntry[], findings: StatusFinding[]): string[] {
  if (!findings.some((finding) => finding.id === "workspace-path-duplicate")) return [];
  const duplicateGroups = workspaceDuplicatePathGroups(workspaces);
  return duplicateGroups.map((group) => {
    const scopeList = group.map((workspace) => `${workspace.id} ${permissionSummary(workspace.permissions)}`).join(", ");
    if (group.every((workspace) => workspaceEquivalentForDuplicateCleanup(workspace, group[0]))) {
      return `Run \`computer-linker doctor --fix\` to remove exact duplicate workspace scopes: ${scopeList}.`;
    }
    return `Duplicate workspace scopes share one folder but have different permissions: ${scopeList}. Keep them only if intentional; otherwise remove the unwanted id with \`computer-linker workspace remove <id>\`.`;
  });
}

function workspaceDuplicatePathGroups(workspaces: WorkspaceConfigEntry[]): WorkspaceConfigEntry[][] {
  const byPath = new Map<string, WorkspaceConfigEntry[]>();
  for (const workspace of workspaces) {
    const key = normalizedWorkspacePathKey(workspace.path);
    if (!key) continue;
    const group = byPath.get(key) ?? [];
    group.push(workspace);
    byPath.set(key, group);
  }
  return [...byPath.values()].filter((group) => group.length > 1);
}

function tunnel(args: string[]): void {
  const [subcommand] = args;
  if (subcommand === "help") {
    printTunnelHelpTopic(args.slice(1));
    return;
  }
  if (subcommand === "--help" || subcommand === "-h") {
    printTunnelHelp();
    return;
  }
  if (hasHelpFlag(args.slice(1))) {
    printTunnelHelpTopic([subcommand]);
    return;
  }
  if (!subcommand || subcommand === "status") {
    const rest = subcommand ? args.slice(1) : args;
    const unknown = rest.filter((arg) => arg !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown tunnel status option: ${unknown[0]}`);
    const config = loadConfig();
    const diagnostics = tunnelDiagnostics({
      localPort: config.port ?? 3939,
      publicBaseUrl: config.publicBaseUrl,
      tunnels: listTunnelProcesses(),
    });

    if (rest.includes("--json")) {
      console.log(JSON.stringify({
        kind: "tunnel-status",
        schemaVersion: 1,
        localPort: config.port ?? 3939,
        ...diagnostics,
      }, null, 2));
      return;
    }

    const openAiSecureTunnelActive = diagnostics.providers.some((provider) => provider.provider === "openai" && provider.running);
    const publicBaseUrlText = diagnostics.publicBaseUrl
      ?? (openAiSecureTunnelActive ? "not required for OpenAI Secure MCP Tunnel" : "not configured");
    const effectivePublicUrlText = diagnostics.effectivePublicUrl
      ?? (openAiSecureTunnelActive ? "not used in OpenAI Secure MCP Tunnel mode" : "not detected");
    console.log(`publicBaseUrl: ${publicBaseUrlText}`);
    console.log(`effectivePublicUrl: ${effectivePublicUrlText}`);
    if (openAiSecureTunnelActive) {
      console.log("openaiTunnel: active; use Tunnel mode in the MCP client, not a public URL");
    }
    for (const tool of diagnostics.tools) {
      console.log(`${tool.name}: ${tool.available ? "available" : "missing"}${tool.version ? ` (${tool.version})` : ""}`);
      if (tool.status) console.log(`  status: ${tool.status.split("\n")[0]}`);
    }
    console.log("providers:");
    for (const provider of diagnostics.providers) {
      console.log(`  ${provider.provider}: ${provider.available ? "available" : "missing"}${provider.running ? ` running=${provider.runningProcessId ?? "yes"}` : ""}${provider.publicUrl ? ` url=${provider.publicUrl}` : ""}`);
    }
    console.log("commands:");
    for (const command of diagnostics.commands) {
      console.log(`  ${command.display}`);
    }
    return;
  }

  throw new Error(`Unknown tunnel command: ${subcommand}`);
}

function service(args: string[]): void {
  const [subcommand] = args;
  if (subcommand === "help") {
    printServiceHelpTopic(args.slice(1));
    return;
  }
  if (subcommand === "--help" || subcommand === "-h") {
    printServiceHelp();
    return;
  }
  if (hasHelpFlag(args.slice(1))) {
    printServiceHelpTopic([subcommand]);
    return;
  }
  if (!subcommand || subcommand === "profile") {
    const rest = subcommand ? args.slice(1) : args;
    assertKnownServiceOptions(rest, "--format", "--output-dir");
    const options = serviceOptions(rest);
    const format = parseServiceFormat(readOption(rest, "--format"));
    if (rest.includes("--output-dir")) {
      console.log(JSON.stringify(writeServiceProfileFiles(loadConfig(), options), null, 2));
      return;
    }
    process.stdout.write(serviceProfileOutput(loadConfig(), { ...options, format }));
    return;
  }

  if (subcommand === "status") {
    const rest = args.slice(1);
    assertKnownServiceOptions(rest, "--json");
    const status = serviceStatus(loadConfig(), serviceOptions(rest));
    if (rest.includes("--json")) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    process.stdout.write(formatServiceStatus(status));
    return;
  }

  if (subcommand === "install" || subcommand === "uninstall") {
    const rest = args.slice(1);
    assertKnownServiceOptions(rest, "--dry-run", "--json", "--yes");
    const options = serviceOptions(rest);
    if (rest.includes("--dry-run") || !rest.includes("--yes")) {
      if (!rest.includes("--dry-run")) {
        throw new Error(`service ${subcommand} requires --yes or --dry-run`);
      }
      const plan = servicePlan(loadConfig(), subcommand, { ...options, dryRun: true });
      if (rest.includes("--json")) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      process.stdout.write(formatServicePlan(plan));
      return;
    }

    const report = applyServiceInstallAction(subcommand, options);
    if (rest.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatServiceActionReport(report));
    return;
  }

  if (subcommand === "start" || subcommand === "stop") {
    const rest = args.slice(1);
    assertKnownServiceOptions(rest, "--dry-run", "--json");
    const options = serviceOptions(rest);
    if (rest.includes("--dry-run")) {
      const plan = servicePlan(loadConfig(), subcommand, { ...options, dryRun: true });
      if (rest.includes("--json")) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      process.stdout.write(formatServicePlan(plan));
      return;
    }

    const report = applyServiceControlAction(subcommand, options);
    if (rest.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatServiceActionReport(report));
    return;
  }

  if (subcommand === "logs") {
    const rest = args.slice(1);
    assertKnownServiceOptions(rest, "--json");
    const report = serviceLogs(loadConfig(), {
      ...serviceOptions(rest),
      lines: readOptionalIntegerOption(rest, "--lines", "service logs --lines"),
    });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatServiceLogs(report));
    return;
  }

  throw new Error(`Unknown service command: ${subcommand}`);
}

function serviceOptions(args: string[]): {
  platform: ReturnType<typeof parseServicePlatform>;
  outputDir?: string;
  serviceName?: string;
  nodePath?: string;
  cliPath?: string;
  configDirectory?: string;
} {
  return {
    platform: parseServicePlatform(readOption(args, "--platform")),
    outputDir: readOption(args, "--output-dir"),
    serviceName: readOption(args, "--service-name"),
    nodePath: readOption(args, "--node"),
    cliPath: readOption(args, "--cli"),
    configDirectory: readOption(args, "--config-dir"),
  };
}

function assertKnownServiceOptions(args: string[], ...extraFlags: string[]): void {
  const valueOptions = new Set([
    "--platform",
    "--service-name",
    "--node",
    "--cli",
    "--config-dir",
    "--format",
    "--output-dir",
    "--lines",
  ]);
  const flagOptions = new Set(extraFlags);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown service option: ${arg}`);
  }
}

type CliServiceOptions = ReturnType<typeof serviceOptions>;

interface ServiceActionReport {
  kind: "computer-linker-service-action";
  schemaVersion: 1;
  action: "install" | "uninstall" | "start" | "stop";
  platform: CliServiceOptions["platform"];
  serviceName: string;
  label: string;
  command: string;
  outputDir?: string;
  files?: ReturnType<typeof writeServiceProfileFiles>["files"];
  stdout: string;
}

function applyServiceInstallAction(
  action: "install" | "uninstall",
  options: CliServiceOptions,
): ServiceActionReport {
  const config = loadConfig();
  const status = serviceStatus(config, options);
  assertServiceExecutionPlatform(status.platform, action);
  const outputDir = defaultServiceOutputDir(options);
  const files = writeServiceProfileFiles(config, { ...options, outputDir });
  const scriptPath = action === "install" ? files.files.install : files.files.uninstall;
  const command = serviceScriptCommand(status.platform, scriptPath);
  const stdout = execFileSync(command.command, command.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    kind: "computer-linker-service-action",
    schemaVersion: 1,
    action,
    platform: status.platform,
    serviceName: status.serviceName,
    label: status.label,
    command: command.display,
    outputDir,
    files: files.files,
    stdout,
  };
}

function applyServiceControlAction(
  action: "start" | "stop",
  options: CliServiceOptions,
): ServiceActionReport {
  const status = serviceStatus(loadConfig(), options);
  assertServiceExecutionPlatform(status.platform, action);
  const command = serviceControlCommand(status.platform, action, status.serviceName, status.label);
  const stdout = execFileSync(command.command, command.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    kind: "computer-linker-service-action",
    schemaVersion: 1,
    action,
    platform: status.platform,
    serviceName: status.serviceName,
    label: status.label,
    command: command.display,
    stdout,
  };
}

function formatServiceActionReport(report: ServiceActionReport): string {
  return [
    `Computer Linker service ${report.action} completed (${report.platform})`,
    `serviceName: ${report.serviceName}`,
    `command: ${report.command}`,
    report.outputDir ? `profileDir: ${report.outputDir}` : undefined,
    report.stdout.trim() ? "output:" : undefined,
    report.stdout.trim() || undefined,
  ].filter(Boolean).join("\n") + "\n";
}

function serviceScriptCommand(platform: CliServiceOptions["platform"], scriptPath: string): {
  command: string;
  args: string[];
  display: string;
} {
  if (platform === "windows") {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
    return { command: "powershell.exe", args, display: commandDisplay("powershell.exe", args) };
  }
  const args = [scriptPath];
  return { command: "sh", args, display: commandDisplay("sh", args) };
}

function serviceControlCommand(
  platform: CliServiceOptions["platform"],
  action: "start" | "stop",
  serviceName: string,
  label: string,
): { command: string; args: string[]; display: string } {
  if (platform === "windows") {
    const args = [action, serviceName];
    return { command: "sc.exe", args, display: commandDisplay("sc.exe", args) };
  }
  if (platform === "macos") {
    const uid = typeof process.getuid === "function" ? process.getuid() : "$(id -u)";
    const args = action === "start"
      ? ["kickstart", "-k", `gui/${uid}/${label}`]
      : ["bootout", `gui/${uid}/${label}`];
    return { command: "launchctl", args, display: commandDisplay("launchctl", args) };
  }
  const args = [action, serviceName];
  return { command: "systemctl", args, display: commandDisplay("systemctl", args) };
}

function assertServiceExecutionPlatform(platform: CliServiceOptions["platform"], action: string): void {
  const current = currentCliServicePlatform();
  if (platform === current) return;
  throw new Error(`service ${action} --platform ${platform} cannot execute on ${current}; use --dry-run for cross-platform plans`);
}

function currentCliServicePlatform(): CliServiceOptions["platform"] {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function commandDisplay(command: string, args: string[]): string {
  return [command, ...args].map((value) => /[\s"]/g.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value).join(" ");
}

function workspace(args: string[]): void {
  const [subcommand, ...rest] = args;
  if (subcommand === "help") {
    printWorkspaceHelpTopic(rest);
    return;
  }
  if (subcommand === "--help" || subcommand === "-h") {
    printWorkspaceHelp();
    return;
  }
  if (hasHelpFlag(rest)) {
    printWorkspaceHelpTopic([subcommand]);
    return;
  }

  if (!subcommand || subcommand === "list") {
    const config = loadConfig();
    for (const entry of config.workspaces) {
      console.log(`${entry.id}\t${entry.path}\t${formatPermissions(entry.permissions)}`);
    }
    return;
  }

  if (subcommand === "add") {
    addWorkspace(rest);
    return;
  }

  if (subcommand === "remove") {
    removeWorkspace(rest);
    return;
  }

  if (subcommand === "update") {
    updateWorkspace(rest);
    return;
  }

  throw new Error(`Unknown workspace command: ${subcommand}`);
}

async function processCommand(args: string[]): Promise<void> {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "list") {
    const options = parseProcessListOptions(rest);
    const data = await localWorkspaceOperation(options.workspace, "process_list");
    printProcessResult("list", data, options.json);
    return;
  }
  if (subcommand === "read") {
    const options = parseProcessTargetOptions(rest, "read");
    const data = await localWorkspaceOperation(options.workspace, "process_read", options.processId);
    printProcessResult("read", data, options.json);
    return;
  }
  if (subcommand === "stop") {
    const options = parseProcessTargetOptions(rest, "stop");
    const data = await localWorkspaceOperation(options.workspace, "process_stop", options.processId, options.signal ? { signal: options.signal } : {});
    printProcessResult("stop", data, options.json);
    return;
  }
  throw new Error("Usage: computer-linker process <list|read|stop> <workspace-id> [process-id] [--signal SIGTERM|SIGINT|SIGKILL] [--json]");
}

function parseProcessListOptions(args: string[]): { workspace: string; json: boolean } {
  const positional = processCommandPositionals(args, new Set(["--json"]));
  if (positional.length !== 1) {
    throw new Error("Usage: computer-linker process list <workspace-id> [--json]");
  }
  return {
    workspace: positional[0],
    json: args.includes("--json"),
  };
}

function parseProcessTargetOptions(args: string[], command: "read" | "stop"): { workspace: string; processId: string; signal?: string; json: boolean } {
  const flagOptions = new Set(command === "stop" ? ["--json", "--signal"] : ["--json"]);
  const positional = processCommandPositionals(args, flagOptions);
  if (positional.length !== 2) {
    throw new Error(`Usage: computer-linker process ${command} <workspace-id> <process-id>${command === "stop" ? " [--signal SIGTERM|SIGINT|SIGKILL]" : ""} [--json]`);
  }
  const signal = command === "stop" ? readOptionalStringOption(args, "--signal", "process stop --signal") : undefined;
  if (signal && signal !== "SIGTERM" && signal !== "SIGINT" && signal !== "SIGKILL") {
    throw new Error("process stop --signal must be one of: SIGTERM, SIGINT, SIGKILL");
  }
  return {
    workspace: positional[0],
    processId: positional[1],
    signal,
    json: args.includes("--json"),
  };
}

function processCommandPositionals(args: string[], flagOptions: Set<string>): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!flagOptions.has(arg)) throw new Error(`Unknown process option: ${arg}`);
    if (arg === "--signal") {
      index += 1;
      if (!args[index] || args[index].startsWith("--")) throw new Error("process stop --signal requires a value");
    }
  }
  return positional;
}

async function localWorkspaceOperation(
  workspace: string,
  op: "process_list" | "process_read" | "process_stop",
  target?: string,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  return postLocalControl({
    action: "operation",
    workspace,
    op,
    target,
    input,
  });
}

async function postLocalControl(body: Record<string, unknown>): Promise<unknown> {
  const config = loadConfig();
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 3939;
  const url = `http://${host}:${port}/api/v1/control`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.ownerToken) {
    headers.authorization = `Bearer ${config.ownerToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error(`Local Computer Linker HTTP server is not reachable at ${url}. Start it with \`${invocationCommand("start")}\`. ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await response.text();
  const payload = parseApiPayload(text);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Local API request failed with HTTP ${response.status}`);
  }
  return payload?.data;
}

function parseApiPayload(text: string): { ok?: boolean; data?: unknown; error?: string } | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? value as { ok?: boolean; data?: unknown; error?: string } : undefined;
  } catch {
    return undefined;
  }
}

function printProcessResult(action: "list" | "read" | "stop", data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (action === "list") {
    const processes = processListFromData(data);
    console.log("Computer Linker managed processes");
    if (processes.length === 0) {
      console.log("none");
      return;
    }
    for (const item of processes) {
      console.log(`${item.processId}\t${item.kind}\t${item.status}\tworkspace=${item.workspaceId}\tpid=${item.pid ?? "n/a"}\t${item.commandPreview}`);
    }
    return;
  }
  const item = processFromData(data);
  console.log(`processId: ${item.processId}`);
  console.log(`kind: ${item.kind}`);
  console.log(`status: ${item.status}`);
  console.log(`workspace: ${item.workspaceId}`);
  console.log(`pid: ${item.pid ?? "n/a"}`);
  console.log(`command: ${item.commandPreview}`);
  console.log(`startedAt: ${item.startedAt}`);
  if (item.endedAt) console.log(`endedAt: ${item.endedAt}`);
  console.log(`exitCode: ${item.exitCode ?? "null"}`);
  if (item.signal) console.log(`signal: ${item.signal}`);
  if (item.stdout) {
    console.log("stdout:");
    process.stdout.write(item.stdout.endsWith("\n") ? item.stdout : `${item.stdout}\n`);
  }
  if (item.stderr) {
    console.log("stderr:");
    process.stdout.write(item.stderr.endsWith("\n") ? item.stderr : `${item.stderr}\n`);
  }
}

function processListFromData(data: unknown): ProcessSummary[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as { processes?: unknown }).processes)) return [];
  return (data as { processes: unknown[] }).processes.map(processSummaryFromUnknown);
}

function processFromData(data: unknown): ProcessSummary {
  if (!data || typeof data !== "object") throw new Error("Local API did not return a process payload");
  return processSummaryFromUnknown((data as { process?: unknown }).process);
}

interface ProcessSummary {
  processId: string;
  kind: string;
  workspaceId: string;
  commandPreview: string;
  pid?: number;
  startedAt: string;
  endedAt?: string;
  status: string;
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
}

function processSummaryFromUnknown(value: unknown): ProcessSummary {
  if (!value || typeof value !== "object") throw new Error("Local API returned an invalid process payload");
  const item = value as Record<string, unknown>;
  return {
    processId: String(item.processId ?? ""),
    kind: String(item.kind ?? ""),
    workspaceId: String(item.workspaceId ?? ""),
    commandPreview: String(item.commandPreview ?? ""),
    pid: typeof item.pid === "number" ? item.pid : undefined,
    startedAt: String(item.startedAt ?? ""),
    endedAt: typeof item.endedAt === "string" ? item.endedAt : undefined,
    status: String(item.status ?? ""),
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
    signal: typeof item.signal === "string" ? item.signal : undefined,
    stdout: typeof item.stdout === "string" ? item.stdout : "",
    stderr: typeof item.stderr === "string" ? item.stderr : "",
  };
}

function screen(args: string[]): void {
  const [subcommand = "status", ...rest] = args;
  if (subcommand !== "status" && subcommand !== "diagnose") {
    throw new Error("Usage: computer-linker screen status [--json]");
  }
  const unknown = rest.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new Error(`Unknown screen status option: ${unknown[0]}`);
  }

  const config = loadConfig();
  const capability = screenshotCapability();
  const screenWorkspaces = config.workspaces
    .filter((workspace) => Boolean(workspace.permissions.screen))
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
    }));
  const nextActions = screenNextActions(capability.supported, capability.permission.status, screenWorkspaces.length);
  const report = {
    kind: "computer-linker-screen-status",
    schemaVersion: 1,
    provider: capability.provider,
    supported: capability.supported,
    permission: capability.permission,
    modes: capability.modes,
    displays: capability.displays,
    windows: capability.windows,
    screenEnabledWorkspaces: screenWorkspaces,
    nextActions,
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Computer Linker screen status");
  console.log(`provider: ${report.provider}`);
  console.log(`supported: ${report.supported ? "yes" : "no"}`);
  console.log(`permission: ${report.permission.status}${report.permission.detail ? ` - ${report.permission.detail}` : ""}`);
  console.log(`modes: ${report.modes.join(", ") || "none"}`);
  console.log(`displays: ${report.displays.length}`);
  console.log(`windows: ${report.windows.length}`);
  console.log("screen-enabled workspaces:");
  if (screenWorkspaces.length === 0) {
    console.log("  none");
  } else {
    for (const workspace of screenWorkspaces) {
      console.log(`  ${workspace.id} (${workspace.name}) -> ${workspace.path}`);
    }
  }
  console.log("next actions:");
  for (const action of nextActions) {
    console.log(`  - ${action}`);
  }
}

function screenNextActions(supported: boolean, permissionStatus: string, screenWorkspaceCount: number): string[] {
  const actions: string[] = [];
  if (!supported) {
    actions.push("This platform does not currently have a screenshot capture provider; screen MCP operations will report unsupported.");
  } else if (permissionStatus === "os_permission_required") {
    actions.push("Grant OS screen-recording permission before using screen capture operations.");
  } else if (permissionStatus === "unknown") {
    actions.push("Run a trusted screen capture once if the OS needs to prompt for screen-recording permission.");
  }
  if (screenWorkspaceCount === 0) {
    actions.push("Enable screen only for scopes that need it: computer-linker workspace update <id> --screen");
  }
  if (actions.length === 0) {
    actions.push("Screen diagnostics are ready; use MCP screen_list before any screen_capture operation.");
  }
  return actions;
}

function doctor(args: string[] = []): void {
  if (hasHelpFlag(args)) {
    printDoctorHelp();
    return;
  }
  const unknown = args.filter((arg) => arg !== "--json" && arg !== "--fix" && arg !== "--dry-run");
  if (unknown.length > 0) {
    throw new Error(`Unknown doctor option: ${unknown[0]}`);
  }
  if (args.includes("--dry-run") && !args.includes("--fix")) {
    throw new Error("doctor --dry-run requires --fix");
  }
  if (args.includes("--fix")) {
    const repair = repairConfig({ dryRun: args.includes("--dry-run") });
    if (args.includes("--json")) {
      console.log(JSON.stringify(repair, null, 2));
      return;
    }
    console.log(args.includes("--dry-run") ? "Computer Linker doctor fix dry run" : "Computer Linker doctor fix");
    console.log(`configPath: ${repair.configPath}`);
    console.log(`dryRun: ${repair.dryRun ? "yes" : "no"}`);
    console.log(`changed: ${repair.changed ? "yes" : "no"}${repair.dryRun && repair.changed ? " (not written)" : ""}`);
    for (const item of repair.repairs) {
      console.log(`${item.status}: ${item.id}${item.workspaceId ? ` ${item.workspaceId}` : ""} - ${item.detail}`);
    }
    if (repair.dryRun && repair.changed) console.log("Run `computer-linker doctor --fix` to apply these repairs.");
    else if (repair.changed) console.log("Run `computer-linker doctor` again to review remaining warnings.");
    return;
  }
  const report = getLocalPortDoctor() as {
    machineId?: string;
    machineName: string;
    readyForTunnel: boolean;
    auth: { ownerTokenConfigured: boolean; mode: string; localOnly: boolean };
    exposure: {
      publicMcpUrl?: string;
      publicBaseUrl?: string;
      publicBaseUrlConfigured: boolean;
      tunnelToolsAvailable: string[];
      blockingReasons: string[];
      warnings: string[];
    };
    workspaces: { total: number; writable: number; shellEnabled: number; codexEnabled: number };
    machine: { platform: string; arch: string; release: string; nodeVersion: string; shell?: string };
    runtime: {
      host: string;
      port: number;
      localMcpUrl: string;
      localApiUrl: string;
      startCommands: { start: string; serveHttp: string; serveStdio: string };
    };
    startup: {
      ready: boolean;
      recommendedMode: string;
      service: {
        profileBundleCommand: string;
        installDryRunCommand: string;
      };
      nextActions: string[];
    };
    localTools: Array<{ name: string; category: string; available: boolean; version?: string; error?: string }>;
    toolReadiness: {
      ready: boolean;
      requiredMissing: string[];
      recommendedMissing: string[];
      installHints: Array<{ name: string; importance: string; usedFor: string[]; install?: Record<string, string> }>;
    };
    configDiagnostics: { criticalCount: number; warningCount: number; findings: Array<{ id: string; severity: string; title: string; detail: string; workspaceId?: string }> };
    security: { criticalCount: number; warningCount: number; findings: Array<{ id: string; severity: string; title: string; detail: string; workspaceId?: string }> };
    releaseReadiness: {
      ready: boolean;
      status: string;
      recommendedGate: string;
      blockingReasons: string[];
      warnings: string[];
      checks: Array<{ id: string; status: string; message: string; detail?: string }>;
    };
    tunnels: { tools: Array<{ name: string; available: boolean; version?: string; error?: string }>; commands: Array<{ display: string }> };
    service: {
      platform: string;
      serviceName: string;
      manifestPath: string;
      manifestExists: boolean | null;
      command: string;
      statusCommands: string[];
      profileCommand: string;
      profileBundleCommand: string;
      installDryRunCommand: string;
      uninstallDryRunCommand: string;
    };
    nextActions: string[];
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Computer Linker doctor for ${report.machineName}`);
  console.log(`machineId: ${report.machineId ?? "not set"}`);
  console.log(`runtime: platform=${report.machine.platform} arch=${report.machine.arch} node=${report.machine.nodeVersion} shell=${report.machine.shell ?? "unknown"}`);
  console.log(`localMcpUrl: ${report.runtime.localMcpUrl}`);
  console.log(`localApiUrl: ${report.runtime.localApiUrl}`);
  console.log(`readyForTunnel: ${report.readyForTunnel ? "yes" : "no"}`);
  console.log(`auth: ${report.auth.mode} ownerToken=${report.auth.ownerTokenConfigured ? "configured" : "missing"}`);
  console.log(`publicBaseUrl: ${report.exposure.publicBaseUrl ?? "not configured"}`);
  console.log(`publicMcpUrl: ${report.exposure.publicMcpUrl ?? "not configured"}`);
  console.log(`workspaces: total=${report.workspaces.total} write=${report.workspaces.writable} shell=${report.workspaces.shellEnabled} codex=${report.workspaces.codexEnabled}`);
  console.log(`config: critical=${report.configDiagnostics.criticalCount} warning=${report.configDiagnostics.warningCount}`);
  console.log(`security: critical=${report.security.criticalCount} warning=${report.security.warningCount}`);
  console.log(`releaseReadiness: status=${report.releaseReadiness.status} ready=${report.releaseReadiness.ready ? "yes" : "no"} gate="${report.releaseReadiness.recommendedGate}"`);
  console.log(`service: platform=${report.service.platform} name=${report.service.serviceName} manifest=${report.service.manifestExists === null ? "service-manager" : report.service.manifestExists ? "present" : "missing"}`);
  console.log(`serviceCommand: ${report.service.command}`);
  console.log(`startup: ready=${report.startup.ready ? "yes" : "no"} recommended=${report.startup.recommendedMode}`);
  console.log(`toolReadiness: ready=${report.toolReadiness.ready ? "yes" : "no"} requiredMissing=${report.toolReadiness.requiredMissing.join(",") || "none"} recommendedMissing=${report.toolReadiness.recommendedMissing.join(",") || "none"}`);
  console.log("tunnel tools:");
  for (const tool of report.tunnels.tools) {
    console.log(`  ${tool.name}: ${tool.available ? "available" : "missing"}${tool.version ? ` (${tool.version})` : ""}`);
  }
  console.log("local tools:");
  for (const tool of report.localTools) {
    console.log(`  ${tool.name}: ${tool.available ? "available" : "missing"}${tool.version ? ` (${tool.version})` : ""}`);
  }
  if (report.toolReadiness.installHints.length > 0) {
    console.log("tool install hints:");
    for (const hint of report.toolReadiness.installHints) {
      const install = hint.install?.[report.machine.platform === "darwin" ? "macos" : report.machine.platform === "win32" ? "windows" : "linux"]
        ?? hint.install?.docs
        ?? "see the tool documentation";
      console.log(`  ${hint.name}: ${install}`);
    }
  }
  console.log("start commands:");
  console.log(`  local http: ${report.runtime.startCommands.start}`);
  if (report.runtime.startCommands.serveHttp !== report.runtime.startCommands.start) {
    console.log(`  http: ${report.runtime.startCommands.serveHttp}`);
  }
  console.log(`  stdio: ${report.runtime.startCommands.serveStdio}`);
  console.log("service commands:");
  console.log(`  profile: ${report.service.profileCommand}`);
  console.log(`  bundle: ${report.service.profileBundleCommand}`);
  console.log(`  install dry-run: ${report.service.installDryRunCommand}`);
  console.log(`  uninstall dry-run: ${report.service.uninstallDryRunCommand}`);
  for (const command of report.service.statusCommands) {
    console.log(`  status: ${command}`);
  }
  console.log("suggested tunnel commands:");
  for (const command of report.tunnels.commands) {
    console.log(`  ${command.display}`);
  }
  if (report.exposure.blockingReasons.length > 0) {
    console.log("blocking reasons:");
    for (const reason of report.exposure.blockingReasons) {
      console.log(`  - ${reason}`);
    }
  }
  if (report.exposure.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of report.exposure.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("security findings:");
  for (const finding of report.security.findings) {
    const workspace = finding.workspaceId ? ` workspace=${finding.workspaceId}` : "";
    console.log(`  [${finding.severity}] ${finding.id}${workspace}: ${finding.title}`);
  }
  console.log("config findings:");
  for (const finding of report.configDiagnostics.findings) {
    const workspace = finding.workspaceId ? ` workspace=${finding.workspaceId}` : "";
    console.log(`  [${finding.severity}] ${finding.id}${workspace}: ${finding.title}`);
  }
  if (report.releaseReadiness.blockingReasons.length > 0) {
    console.log("release blocking reasons:");
    for (const reason of report.releaseReadiness.blockingReasons) {
      console.log(`  - ${reason}`);
    }
  }
  if (report.releaseReadiness.warnings.length > 0) {
    console.log("release warnings:");
    for (const warning of report.releaseReadiness.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("next actions:");
  for (const action of report.nextActions) {
    console.log(`  - ${action}`);
  }
}

function repairConfig(options: { dryRun?: boolean } = {}): {
  kind: "computer-linker-config-repair";
  schemaVersion: 1;
  configPath: string;
  dryRun: boolean;
  changed: boolean;
  repairs: Array<{ id: string; status: "applied" | "planned" | "skipped"; detail: string; workspaceId?: string }>;
} {
  const config = loadConfig();
  const dryRun = Boolean(options.dryRun);
  const applyStatus: "planned" | "applied" = dryRun ? "planned" : "applied";
  const repairs: Array<{ id: string; status: "applied" | "planned" | "skipped"; detail: string; workspaceId?: string }> = [];
  let changed = false;
  let workspaces = [...config.workspaces];
  const bootstrapWorkspaces = workspaces.filter(isBootstrapDefaultWorkspace);
  if (bootstrapWorkspaces.length > 0 && workspaces.length > bootstrapWorkspaces.length) {
    workspaces = workspaces.filter((workspace) => !isBootstrapDefaultWorkspace(workspace));
    changed = true;
    for (const workspace of bootstrapWorkspaces) {
      repairs.push({
        id: "remove-bootstrap-current-workspace",
        status: applyStatus,
        workspaceId: workspace.id,
        detail: "Removed the default current-directory scope after explicit workspaces were configured.",
      });
    }
  } else if (bootstrapWorkspaces.length > 0) {
    repairs.push({
      id: "remove-bootstrap-current-workspace",
      status: "skipped",
      workspaceId: bootstrapWorkspaces[0].id,
      detail: "Skipped because it is the only configured workspace. Add an explicit folder with `computer-linker start <folder>` first.",
    });
  }

  const duplicateRepair = removeExactDuplicateWorkspaces(workspaces);
  workspaces = duplicateRepair.workspaces;
  if (duplicateRepair.repairs.length > 0) {
    changed = true;
    repairs.push(...duplicateRepair.repairs.map((repair) => ({
      ...repair,
      status: applyStatus,
    })));
  }

  workspaces = workspaces.map((workspace) => {
    if (!workspace.permissions.shell && !workspace.permissions.codex) return workspace;
    const repairedPolicy = repairedExecutionPolicy(workspace.policy, workspace.permissions);
    if (!policyChanged(workspace.policy, repairedPolicy)) return workspace;
    changed = true;
    repairs.push({
      id: workspace.policy ? "complete-execution-policy" : "add-default-execution-policy",
      status: applyStatus,
      workspaceId: workspace.id,
      detail: workspace.policy
        ? "Filled missing execution policy defaults for an execution-enabled scope."
        : "Added default command allowlist, denylist, runtime cap, and output cap for an execution-enabled scope.",
    });
    return {
      ...workspace,
      policy: repairedPolicy,
    };
  });

  if (repairs.length === 0) {
    repairs.push({
      id: "config-repair-not-needed",
      status: "skipped",
      detail: "No automatic config repairs were needed.",
    });
  }

  const writtenPath = changed && !dryRun
    ? writeConfig({ ...config, workspaces })
    : configPath();
  return {
    kind: "computer-linker-config-repair",
    schemaVersion: 1,
    configPath: writtenPath,
    dryRun,
    changed,
    repairs,
  };
}

function history(args: string[] = []): void {
  if (hasHelpFlag(args)) {
    printHistoryHelp();
    return;
  }
  assertKnownHistoryOptions(args);
  const view = readHistoryViewOption(args);
  const limit = readOptionalIntegerOption(args, "--limit", "history --limit");
  const workspaceId = readOptionalStringOption(args, "--workspace", "history --workspace");
  const query = readOptionalStringOption(args, "--query", "history --query");
  const output = readOptionalStringOption(args, "--output", "history --output");
  const insight = historyInsight({
    view,
    limit,
    workspaceId,
    query,
  });

  if (output) {
    writeJsonFile(resolve(expandHomePath(output)), insight);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(insight, null, 2));
    return;
  }

  console.log(`Computer Linker history (${insight.view})`);
  console.log(`generatedAt: ${insight.generatedAt}`);
  console.log(`events: total=${insight.summary.totalEvents} success=${insight.summary.successfulEvents} failed=${insight.summary.failedEvents}`);
  if (insight.summary.lastWorkspaceOperation) {
    console.log(`lastWorkspaceOperation: ${insight.summary.lastWorkspaceOperation.operation ?? "unknown"} target=${insight.summary.lastWorkspaceOperation.target ?? insight.summary.lastWorkspaceOperation.path ?? "unknown"}`);
  }
  if (insight.failedReplay?.length) {
    console.log(`failedReplay: ${insight.failedReplay.length}`);
  }
  if (insight.sessions?.length) {
    console.log(`sessions: ${insight.sessions.length}`);
  }
  if (insight.connections?.length) {
    console.log(`connections: ${insight.connections.length}`);
  }
  if (output) {
    console.log(`written: ${resolve(expandHomePath(output))}`);
  }
  console.log("next actions:");
  for (const action of insight.last?.suggestedNextActions ?? ["Use --json for the full redacted history insight payload."]) {
    console.log(`  - ${action}`);
  }
}

function assertKnownHistoryOptions(args: string[]): void {
  const valueOptions = new Set(["--view", "--workspace", "--query", "--limit", "--output"]);
  const flagOptions = new Set(["--json"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown history argument: ${arg}`);
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown history option: ${arg}`);
  }
}

function readHistoryViewOption(args: string[]): HistoryInsightView {
  const value = readOption(args, "--view");
  if (args.includes("--view") && (!value || value.startsWith("--"))) {
    throw new Error("history --view must be one of: summary, last, timeline, sessions, connections, failed_replay, debug_bundle");
  }
  const view = historyInsightView(value);
  if (value && view !== value) {
    throw new Error("history --view must be one of: summary, last, timeline, sessions, connections, failed_replay, debug_bundle");
  }
  return view;
}

function profile(args: string[]): void {
  if (hasHelpFlag(args)) {
    printProfileHelp();
    return;
  }
  if (args.includes("--chatgpt")) {
    throw new Error("profile --chatgpt was removed; use `computer-linker client chatgpt profile` only when ChatGPT asks for connector-specific fields.");
  }
  if (args.includes("--mode")) {
    throw new Error("profile --mode is only supported by `computer-linker client chatgpt profile --mode ...`.");
  }
  if (args.includes("--url")) {
    throw new Error("profile --url is only supported by `computer-linker client chatgpt profile --url ...`.");
  }
  const includeSecrets = args.includes("--show-token");
  const unknown = args.filter((arg) => arg !== "--show-token");
  if (unknown.length > 0) {
    throw new Error(`Unknown profile option: ${unknown[0]}`);
  }
  console.log(JSON.stringify(connectionProfile(loadConfig(), includeSecrets), null, 2));
}

async function client(args: string[]): Promise<void> {
  const [clientName, ...rest] = args;
  if (clientName === "help") {
    printClientHelpTopic(rest);
    return;
  }
  if (clientName === "--help" || clientName === "-h") {
    printClientHelp();
    return;
  }
  if (hasHelpFlag(rest)) {
    printClientHelpTopic([clientName]);
    return;
  }
  if (clientName === "setup") {
    clientSetup(rest);
    return;
  }
  if (clientName === "smoke") {
    await clientSmoke(rest);
    return;
  }
  if (clientName === "diagnose") {
    await diagnoseClient(rest);
    return;
  }
  if (clientName !== "chatgpt") {
    throw new Error("Usage: computer-linker client <setup|smoke|diagnose|chatgpt>");
  }
  await chatGptClient(rest, "client chatgpt");
}

interface McpClientSetupCliReport {
  machineName?: string;
  localReady?: boolean;
  remoteReady?: boolean;
  connection?: {
    stdio?: { command?: string; args?: string[] };
    localMcpUrl?: string;
    publicMcpUrl?: string | null;
    publicBaseUrlSource?: string | null;
    tunnel?: {
      provider?: string;
      mode?: string;
      tunnelId?: string;
      localMcpTarget?: string;
      publicUrlRequired?: boolean;
    } | null;
  };
  auth?: {
    mode?: string;
    bearerHeader?: string | null;
    alternateBearerHeader?: string | null;
    localBearerHeader?: string | null;
    notes?: string[];
  };
  tools?: string[];
  firstPrompt?: string;
  agentInstructions?: string[];
  remoteBlockingReasons?: string[];
  warnings?: string[];
  nextActions?: string[];
}

function clientSetup(args: string[]): void {
  const unknown = args.filter((arg) => arg !== "--json" && arg !== "--show-token" && arg !== "--details");
  if (unknown.length > 0) {
    throw new Error(`Unknown client setup option: ${unknown[0]}`);
  }
  const report = getMcpClientSetup({
    tunnels: listTunnelProcesses(),
    includeSecrets: args.includes("--show-token"),
  }) as McpClientSetupCliReport;
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  process.stdout.write(args.includes("--details") ? formatDetailedMcpClientSetup(report) : formatMcpClientSetup(report));
}

function formatMcpClientSetup(report: McpClientSetupCliReport): string {
  const lines = [
    "Computer Linker MCP client setup",
    `ready: ${clientSetupReadySummary(report)}`,
    `connect: ${clientSetupConnectionSummary(report)}`,
    `auth: ${clientSetupAuthSummary(report)}`,
    `tools: ${report.tools?.length ?? 0} stable MCP tools`,
  ];
  if (clientSetupShouldShowBearerHeader(report) && report.auth?.bearerHeader) {
    lines.push(`bearer header: ${report.auth.bearerHeader}`);
  }
  if (report.remoteBlockingReasons?.length) {
    lines.push("blocked by:");
    for (const reason of report.remoteBlockingReasons.slice(0, 3)) lines.push(`  - ${reason}`);
    appendRemainingCount(lines, report.remoteBlockingReasons.length, 3, "blocker", invocationCommand("client", "setup", "--details"));
  } else if (report.warnings?.length) {
    lines.push(`attention: ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}; run \`${invocationCommand("client", "setup", "--details")}\``);
  }
  if (report.connection?.tunnel?.provider === "openai" && report.connection.tunnel.tunnelId) {
    lines.push(`tunnel id: ${report.connection.tunnel.tunnelId}`);
  }
  if (report.nextActions?.length) {
    lines.push("next:");
    for (const action of report.nextActions.slice(0, 3)) lines.push(`  - ${action}`);
    appendRemainingCount(lines, report.nextActions.length, 3, "action", invocationCommand("client", "setup", "--details"));
  }
  lines.push(`details: ${invocationCommand("client", "setup", "--details")}`);
  return `${lines.join("\n")}\n`;
}

function formatDetailedMcpClientSetup(report: McpClientSetupCliReport): string {
  const publicMcpUrlText = report.connection?.tunnel?.provider === "openai"
    ? "(not used in OpenAI tunnel mode)"
    : report.connection?.publicMcpUrl ?? "(not configured)";
  const lines = [
    "Computer Linker MCP client setup",
    `machine: ${report.machineName ?? "unknown"}`,
    `localReady: ${report.localReady ? "yes" : "no"}`,
    `remoteReady: ${report.remoteReady ? "yes" : "no"}`,
    `localMcpUrl: ${report.connection?.localMcpUrl ?? "(unknown)"}`,
    `publicMcpUrl: ${publicMcpUrlText}`,
    `auth: ${report.auth?.mode ?? "unknown"}`,
  ];
  if (report.connection?.tunnel?.provider === "openai") {
    lines.push("tunnel: OpenAI Secure MCP Tunnel active");
    lines.push(`tunnelId: ${report.connection.tunnel.tunnelId ?? "(unknown)"}`);
    lines.push(`tunnelMcpTarget: ${report.connection.tunnel.localMcpTarget ?? report.connection.localMcpUrl ?? "(unknown)"}`);
  }
  if (report.auth?.bearerHeader) {
    lines.push(`bearerHeader: ${report.auth.bearerHeader}`);
  }
  if (report.auth?.localBearerHeader && report.auth.localBearerHeader !== report.auth.bearerHeader) {
    lines.push(`localBearerHeader: ${report.auth.localBearerHeader}`);
  }
  if (report.auth?.notes?.length) {
    lines.push("auth notes:");
    for (const note of report.auth.notes) lines.push(`  - ${note}`);
  }
  if (report.connection?.stdio?.command) {
    lines.push(`stdio: ${[report.connection.stdio.command, ...(report.connection.stdio.args ?? [])].join(" ")}`);
  }
  if (report.tools?.length) {
    lines.push(`tools: ${report.tools.join(", ")}`);
  }
  if (report.firstPrompt) {
    lines.push("first prompt:");
    lines.push(`  ${report.firstPrompt}`);
  }
  if (report.agentInstructions?.length) {
    lines.push("agent instructions:");
    for (const instruction of report.agentInstructions) lines.push(`  ${instruction}`);
  }
  if (report.remoteBlockingReasons?.length) {
    lines.push("remote blockers:");
    for (const reason of report.remoteBlockingReasons) lines.push(`  - ${reason}`);
  }
  if (report.warnings?.length) {
    lines.push("warnings:");
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  if (report.nextActions?.length) {
    lines.push("next actions:");
    for (const action of report.nextActions) lines.push(`  - ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function clientSetupReadySummary(report: McpClientSetupCliReport): string {
  if (report.remoteReady) return "yes (remote)";
  if (report.localReady) return "yes (local only)";
  return "no";
}

function clientSetupConnectionSummary(report: McpClientSetupCliReport): string {
  const tunnel = report.connection?.tunnel;
  if (tunnel?.provider === "openai") {
    return `OpenAI Tunnel mode${tunnel.tunnelId ? ` (${tunnel.tunnelId})` : ""}`;
  }
  if (report.connection?.publicMcpUrl) return report.connection.publicMcpUrl;
  if (report.connection?.localMcpUrl) return `local only at ${report.connection.localMcpUrl}`;
  return "not configured";
}

function clientSetupAuthSummary(report: McpClientSetupCliReport): string {
  if (report.auth?.mode === "openai-secure-tunnel") {
    return "handled by tunnel-client; do not paste a bearer token into ChatGPT Tunnel mode";
  }
  if (report.auth?.bearerHeader) {
    return report.auth.bearerHeader.includes("<ownerToken>") ? "bearer token configured" : "bearer token shown below";
  }
  return report.auth?.mode ?? "unknown";
}

function clientSetupShouldShowBearerHeader(report: McpClientSetupCliReport): boolean {
  return Boolean(report.auth?.bearerHeader && !report.auth.bearerHeader.includes("<ownerToken>"));
}

async function clientSmoke(args: string[]): Promise<void> {
  const unknown = args.filter((arg, index) => (
    arg !== "--json" &&
    arg !== "--show-token" &&
    arg !== "--allow-http" &&
    arg !== "--url" &&
    arg !== "--token" &&
    arg !== "--timeout-ms" &&
    args[index - 1] !== "--url" &&
    args[index - 1] !== "--token" &&
    args[index - 1] !== "--timeout-ms"
  ));
  if (unknown.length > 0) {
    throw new Error(`Unknown client smoke option: ${unknown[0]}`);
  }
  const timeoutMs = readOptionalIntegerOption(args, "--timeout-ms", "client smoke --timeout-ms");
  const report = await runWorkspaceLinkerMcpClientSmoke(loadConfig(), {
    url: readOption(args, "--url"),
    token: readOption(args, "--token"),
    includeSecret: args.includes("--show-token"),
    allowHttp: args.includes("--allow-http"),
    timeoutMs,
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  process.stdout.write(formatWorkspaceLinkerClientSmoke(report));
}

type ClientDiagnosisTarget = "local" | "remote" | "url";

interface McpClientDiagnosisReport {
  kind: "computer-linker-client-diagnosis";
  schemaVersion: 1;
  target: ClientDiagnosisTarget;
  url: string | null;
  generatedAt: string;
  setup: McpClientSetupCliReport;
  smoke: WorkspaceLinkerClientSmokeReport;
  history: {
    connections: HistoryInsight;
    last: HistoryInsight;
  };
  diagnosis: {
    ready: boolean;
    blockingReasons: string[];
    warnings: string[];
    nextActions: string[];
  };
}

async function diagnose(args: string[]): Promise<void> {
  const [target = "client", ...rest] = args;
  if (target === "--help" || target === "-h" || target === "help") {
    printDiagnoseHelp();
    return;
  }
  if (target !== "client") {
    throw new Error("Usage: computer-linker diagnose client [--local|--remote|--url https://.../mcp] [--json]");
  }
  if (hasHelpFlag(rest)) {
    printDiagnoseHelp();
    return;
  }
  await diagnoseClient(rest);
}

async function diagnoseClient(args: string[]): Promise<void> {
  const unknown = args.filter((arg, index) => (
    arg !== "--json" &&
    arg !== "--show-token" &&
    arg !== "--allow-http" &&
    arg !== "--local" &&
    arg !== "--remote" &&
    arg !== "--url" &&
    arg !== "--token" &&
    arg !== "--timeout-ms" &&
    args[index - 1] !== "--url" &&
    args[index - 1] !== "--token" &&
    args[index - 1] !== "--timeout-ms"
  ));
  if (unknown.length > 0) {
    throw new Error(`Unknown client diagnose option: ${unknown[0]}`);
  }
  const explicitTargets = [args.includes("--local"), args.includes("--remote"), args.includes("--url")].filter(Boolean).length;
  if (explicitTargets > 1) {
    throw new Error("client diagnose accepts only one target: --local, --remote, or --url");
  }

  const config = loadConfig();
  const urlOption = readOption(args, "--url");
  const target: ClientDiagnosisTarget = urlOption ? "url" : args.includes("--remote") ? "remote" : "local";
  const localUrl = `http://${config.host ?? "127.0.0.1"}:${config.port ?? 3939}/mcp`;
  const smokeUrl = target === "local" ? localUrl : target === "url" ? urlOption : undefined;
  const timeoutMs = readOptionalIntegerOption(args, "--timeout-ms", "client diagnose --timeout-ms");
  const setup = getMcpClientSetup({
    tunnels: listTunnelProcesses(),
    includeSecrets: args.includes("--show-token"),
  }) as McpClientSetupCliReport;
  const smoke = await runWorkspaceLinkerMcpClientSmoke(config, {
    url: smokeUrl,
    token: readOption(args, "--token"),
    includeSecret: args.includes("--show-token"),
    allowHttp: target === "local" || args.includes("--allow-http"),
    timeoutMs,
    clientName: "computer-linker-client-diagnose",
  });
  const historyConnections = historyInsight({ view: "connections", limit: 20 });
  const historyLast = historyInsight({ view: "last", limit: 20 });
  const report = buildClientDiagnosisReport({
    target,
    url: smokeUrl ?? setup.connection?.publicMcpUrl ?? null,
    setup,
    smoke,
    connections: historyConnections,
    last: historyLast,
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  process.stdout.write(formatClientDiagnosis(report));
}

function buildClientDiagnosisReport(input: {
  target: ClientDiagnosisTarget;
  url: string | null;
  setup: McpClientSetupCliReport;
  smoke: WorkspaceLinkerClientSmokeReport;
  connections: HistoryInsight;
  last: HistoryInsight;
}): McpClientDiagnosisReport {
  const blockingReasons = [...input.smoke.blockingReasons];
  const warnings = [...input.smoke.warnings, ...(input.setup.warnings ?? [])];
  if (input.target === "remote" && !input.setup.remoteReady) {
    blockingReasons.push(...(input.setup.remoteBlockingReasons ?? ["Remote MCP client setup is not ready."]));
  }
  const hasConnectionHistory = (input.connections.connections?.length ?? 0) > 0;
  const nextActions = new Set<string>(input.smoke.nextActions);
  if (input.target === "remote" && !input.setup.remoteReady) {
    for (const action of input.setup.nextActions ?? []) nextActions.add(action);
  }
  if (!hasConnectionHistory) {
    nextActions.add("After an external MCP client connects, run `computer-linker history --view connections` to verify incoming traffic.");
  }
  if (input.smoke.ready && (input.target !== "remote" || input.setup.remoteReady)) {
    nextActions.add("Use `computer-linker client setup --details` for the agent prompt and stable tool contract.");
  }
  return {
    kind: "computer-linker-client-diagnosis",
    schemaVersion: 1,
    target: input.target,
    url: input.url,
    generatedAt: new Date().toISOString(),
    setup: input.setup,
    smoke: input.smoke,
    history: {
      connections: input.connections,
      last: input.last,
    },
    diagnosis: {
      ready: blockingReasons.length === 0,
      blockingReasons,
      warnings,
      nextActions: [...nextActions],
    },
  };
}

function formatClientDiagnosis(report: McpClientDiagnosisReport): string {
  const lines = [
    "Computer Linker client diagnosis",
    `target: ${report.target}${report.url ? ` ${report.url}` : ""}`,
    `ready: ${report.diagnosis.ready ? "yes" : "no"}`,
    `setup: local=${report.setup.localReady ? "ready" : "not-ready"} remote=${report.setup.remoteReady ? "ready" : "not-ready"}`,
    `smoke: ${report.smoke.ready ? "pass" : "fail"} (${report.smoke.checks.filter((check) => check.status === "pass").length}/${report.smoke.checks.length} checks passed)`,
    `traffic: ${(report.history.connections.connections?.length ?? 0)} recent connection group${(report.history.connections.connections?.length ?? 0) === 1 ? "" : "s"}`,
  ];
  if (report.diagnosis.blockingReasons.length > 0) {
    lines.push("blocked by:");
    for (const reason of report.diagnosis.blockingReasons.slice(0, 5)) lines.push(`  - ${reason}`);
    appendRemainingCount(lines, report.diagnosis.blockingReasons.length, 5, "blocker", invocationCommand("diagnose", "client", "--json"));
  }
  if (report.diagnosis.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of report.diagnosis.warnings.slice(0, 5)) lines.push(`  - ${warning}`);
    appendRemainingCount(lines, report.diagnosis.warnings.length, 5, "warning", invocationCommand("diagnose", "client", "--json"));
  }
  lines.push("next:");
  for (const action of report.diagnosis.nextActions.slice(0, 5)) lines.push(`  - ${action}`);
  appendRemainingCount(lines, report.diagnosis.nextActions.length, 5, "action", invocationCommand("diagnose", "client", "--json"));
  return `${lines.join("\n")}\n`;
}

async function chatGptClient(args: string[], commandPrefix: string): Promise<void> {
  const [subcommand] = args;
  if (subcommand === "url") {
    const rest = args.slice(1);
    const unknown = rest.filter((arg) => arg !== "--json" && arg !== "--show-token");
    if (unknown.length > 0) {
      throw new Error(`Unknown ${commandPrefix} url option: ${unknown[0]}`);
    }
    const report = chatGptUrl(loadConfig(), rest.includes("--show-token"), {
      tunnels: listTunnelProcesses(),
    });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatChatGptUrl(report));
    return;
  }

  if (subcommand === "smoke") {
    const rest = args.slice(1);
    const unknown = rest.filter((arg, index) => (
      arg !== "--json" &&
      arg !== "--show-token" &&
      arg !== "--allow-http" &&
      arg !== "--url" &&
      arg !== "--token" &&
      arg !== "--timeout-ms" &&
      rest[index - 1] !== "--url" &&
      rest[index - 1] !== "--token" &&
      rest[index - 1] !== "--timeout-ms"
    ));
    if (unknown.length > 0) {
      throw new Error(`Unknown ${commandPrefix} smoke option: ${unknown[0]}`);
    }
    const timeoutMs = readOptionalIntegerOption(rest, "--timeout-ms", `${commandPrefix} smoke --timeout-ms`);
    const report = await chatGptSmoke(loadConfig(), {
      url: readOption(rest, "--url"),
      token: readOption(rest, "--token"),
      includeSecret: rest.includes("--show-token"),
      allowHttp: rest.includes("--allow-http"),
      timeoutMs,
    });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatChatGptSmoke(report));
    return;
  }

  if (!subcommand || subcommand === "verify") {
    const rest = subcommand ? args.slice(1) : args;
    const unknown = rest.filter((arg, index) => (
      arg !== "--json" &&
      arg !== "--mode" &&
      rest[index - 1] !== "--mode"
    ));
    if (unknown.length > 0) {
      throw new Error(`Unknown ${commandPrefix} verify option: ${unknown[0]}`);
    }
    const modeValue = readOption(rest, "--mode");
    if (rest.includes("--mode") && (!modeValue || modeValue.startsWith("--"))) {
      throw new Error(`${commandPrefix} verify --mode must be one of: safe, coding, full`);
    }
    const report = chatGptVerify(loadConfig(), parseChatGptVerifyMode(modeValue));
    if (rest.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatChatGptVerify(report));
    return;
  }

  if (subcommand === "profile" || subcommand === "manifest" || subcommand === "connector" || subcommand === "files") {
    const rest = args.slice(1);
    const output = chatGptProfileCommand(
      subcommand === "files" && !rest.includes("--output-dir") ? ["--output-dir", ...rest] : rest,
      `${commandPrefix} ${subcommand}`,
      subcommand,
    );
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  throw new Error(`Unknown ${commandPrefix} command: ${subcommand}`);
}

function chatGptProfileCommand(
  args: string[],
  commandPrefix: string,
  forcedFormat?: "profile" | "manifest" | "connector" | "files",
): unknown {
  const format = readOption(args, "--format") ?? "profile";
  const hasOutputDir = args.includes("--output-dir");
  const outputDir = readOption(args, "--output-dir");
  const unknown = args.filter((arg, index) => (
    arg !== "--show-token" &&
    arg !== "--format" &&
    arg !== "--output-dir" &&
    arg !== "--mode" &&
    arg !== "--url" &&
    args[index - 1] !== "--format" &&
    args[index - 1] !== "--output-dir" &&
    args[index - 1] !== "--url" &&
    args[index - 1] !== "--mode"
  ));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${commandPrefix} option: ${unknown[0]}`);
  }
  if (forcedFormat && args.includes("--format")) {
    throw new Error(`${commandPrefix} does not accept --format; use client chatgpt profile, manifest, connector, or files`);
  }
  const selectedFormat = forcedFormat ?? format;
  if (selectedFormat !== "profile" && selectedFormat !== "manifest" && selectedFormat !== "connector" && selectedFormat !== "files") {
    throw new Error(`${commandPrefix} --format must be one of: profile, manifest, connector, files`);
  }

  const config = loadConfig();
  const includeSecrets = args.includes("--show-token");
  const mode = readChatGptModeOption(args, `${commandPrefix} --mode`);
  const publicBaseUrl = readPublicUrlOption(args, `${commandPrefix} --url`);
  if (hasOutputDir || selectedFormat === "files") {
    return writeChatGptProfileFiles(config, includeSecrets, outputDir, mode, { publicBaseUrl }, commandPrefix);
  }
  return selectedFormat === "manifest"
    ? chatGptAppManifest(config, mode, { publicBaseUrl })
    : selectedFormat === "connector"
      ? chatGptConnectorConfig(config, includeSecrets, mode, { publicBaseUrl })
      : chatGptConnectProfile(config, includeSecrets, mode, { publicBaseUrl });
}

function writeChatGptProfileFiles(config: LocalPortConfig, includeSecrets: boolean, outputDir: string | undefined, mode: ReturnType<typeof parseChatGptProfileMode>, options: { publicBaseUrl?: string } = {}, commandPrefix = "client chatgpt files"): {
  kind: "chatgpt-config-files";
  outputDir: string;
  files: Record<"profile" | "manifest" | "connector" | "operationRegistry" | "index", string>;
} {
  if (!outputDir || outputDir.startsWith("--")) {
    throw new Error(`${commandPrefix} --output-dir requires a directory path`);
  }
  const directory = expandHomePath(outputDir);
  mkdirSync(directory, { recursive: true });
  const profilePath = join(directory, "chatgpt-profile.json");
  const manifestPath = join(directory, "chatgpt-app-manifest.json");
  const connectorPath = join(directory, "chatgpt-connector-config.json");
  const operationRegistryPath = join(directory, "operation-registry.json");
  const indexPath = join(directory, "chatgpt-index.json");
  const files = {
    profile: profilePath,
    manifest: manifestPath,
    connector: connectorPath,
    operationRegistry: operationRegistryPath,
    index: indexPath,
  };
  const profile = chatGptConnectProfile(config, includeSecrets, mode, options);
  const manifest = chatGptAppManifest(config, mode, options);
  const connector = chatGptConnectorConfig(config, includeSecrets, mode, options);
  const operations = publicComputerOperationRegistry();
  const operationRegistry = {
    kind: "operation-registry",
    schemaVersion: 1,
    contract: computerOperationContract,
    count: operations.length,
    operations,
  };
  const index = {
    kind: "chatgpt-config-files",
    schemaVersion: 1,
    mode,
    appName: manifest.appName,
    mcpServerUrl: connector.mcpServerUrl,
    files,
    nextSteps: [
      "Use chatgpt-app-manifest.json when ChatGPT asks for app metadata.",
      "Use chatgpt-connector-config.json when ChatGPT asks for direct connector fields.",
      "Use chatgpt-profile.json for the full setup profile and GPT instructions.",
      "Use operation-registry.json when ChatGPT needs the exact operation names, permissions, payload fields, and safety boundaries.",
    ],
  };

  writeJsonFile(profilePath, profile);
  writeJsonFile(manifestPath, manifest);
  writeJsonFile(connectorPath, connector);
  writeJsonFile(operationRegistryPath, operationRegistry);
  writeJsonFile(indexPath, index);
  return {
    kind: "chatgpt-config-files",
    outputDir: directory,
    files,
  };
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function config(args: string[]): void {
  const [subcommand, value] = args;
  if (subcommand === "help") {
    printConfigHelpTopic(args.slice(1));
    return;
  }
  if (subcommand === "--help" || subcommand === "-h") {
    printConfigHelp();
    return;
  }
  if (hasHelpFlag(args.slice(1))) {
    printConfigHelpTopic([subcommand]);
    return;
  }
  if (!subcommand || subcommand === "path") {
    console.log(configPath());
    return;
  }

  if (subcommand === "show") {
    const rest = args.slice(1);
    const unknown = rest.filter((arg) => arg !== "--show-token");
    if (unknown.length > 0) {
      throw new Error(`Unknown config show option: ${unknown[0]}`);
    }
    console.log(JSON.stringify(redactedConfig(loadConfig(), rest.includes("--show-token")), null, 2));
    return;
  }

  if (subcommand === "validate") {
    validateConfig(args.slice(1));
    return;
  }

  if (subcommand === "policy") {
    configPolicy(args.slice(1));
    return;
  }

  if (subcommand === "token") {
    configToken(args.slice(1));
    return;
  }

  if (subcommand === "set-public-url" || subcommand === "set-public-base-url") {
    const publicBaseUrl = requireHttpsUrl(value, "public URL");
    const writtenPath = writeConfig({
      ...loadConfig(),
      publicBaseUrl,
    });
    console.log(`Updated publicBaseUrl in ${writtenPath}`);
    console.log(`Public MCP URL: ${new URL("/mcp", publicBaseUrl).href}`);
    return;
  }

  if (subcommand === "clear-public-url" || subcommand === "clear-public-base-url") {
    const current = loadConfig();
    const writtenPath = writeConfig({
      ...current,
      publicBaseUrl: undefined,
    });
    console.log(`Cleared publicBaseUrl in ${writtenPath}`);
    return;
  }

  throw new Error(`Unknown config command: ${subcommand}`);
}

function redactedConfig(config: LocalPortConfig, includeSecrets: boolean): LocalPortConfig {
  if (includeSecrets || !config.ownerToken) return config;
  return {
    ...config,
    ownerToken: "<ownerToken>",
  };
}

function configToken(args: string[]): void {
  const action = args.find((arg) => !arg.startsWith("--")) ?? "status";
  const flags = args.filter((arg) => arg.startsWith("--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  for (const flag of flags) {
    if (flag !== "--json" && flag !== "--show-token") {
      throw new Error(`Unknown config token option: ${flag}`);
    }
  }
  if (positional.length > 1 || (action !== "status" && action !== "rotate")) {
    throw new Error("Usage: computer-linker config token [rotate] [--show-token] [--json]");
  }

  const includeSecret = args.includes("--show-token");
  const config = loadConfig();
  let ownerToken = config.ownerToken;
  let writtenPath = configPath();
  let rotated = false;
  if (action === "rotate") {
    ownerToken = generateOwnerToken();
    writtenPath = writeConfig({
      ...config,
      ownerToken,
    });
    rotated = true;
  }

  const tokenConfigured = Boolean(ownerToken);
  const authHeader = tokenConfigured
    ? `Authorization: Bearer ${includeSecret ? ownerToken : "<ownerToken>"}`
    : null;
  const nextActions = tokenConfigured
    ? rotated
      ? [
          "Update MCP clients with the new Authorization bearer token.",
          "Restart the HTTP server after token-state changes when using OAuth clients.",
        ]
      : ["Run `computer-linker config token rotate --show-token` when you need to replace the owner token."]
    : ["Run `computer-linker config token rotate --show-token` before exposing Computer Linker through a tunnel."];
  const report = {
    kind: "computer-linker-owner-token",
    schemaVersion: 1,
    configPath: writtenPath,
    tokenConfigured,
    rotated,
    authHeader,
    ownerToken: includeSecret ? ownerToken : undefined,
    nextActions,
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Computer Linker owner token");
  console.log(`configPath: ${report.configPath}`);
  console.log(`tokenConfigured: ${report.tokenConfigured ? "yes" : "no"}`);
  console.log(`rotated: ${report.rotated ? "yes" : "no"}`);
  if (report.authHeader) console.log(`authHeader: ${report.authHeader}`);
  if (includeSecret && ownerToken) console.log(`ownerToken: ${ownerToken}`);
  console.log("next actions:");
  for (const actionText of nextActions) {
    console.log(`  - ${actionText}`);
  }
}

function setup(args: string[]): void {
  const [subcommand, ...rest] = args;
  if (subcommand === "help") {
    printSetupHelpTopic(rest);
    return;
  }
  if (subcommand === "--help" || subcommand === "-h") {
    printSetupHelp();
    return;
  }
  if (hasHelpFlag(rest)) {
    printSetupHelpTopic([subcommand]);
    return;
  }
  if (subcommand === "mcp-only" || subcommand === "cloudflare-mcp") {
    setupMcpOnly(rest, "setup mcp-only");
    return;
  }

  if (!subcommand) {
    throw new Error(setupMcpOnlyUsage());
  }

  setupMcpOnly(args, "setup");
}

type SetupOutputMode = "full" | "startup";

function setupMcpOnly(args: string[], commandLabel = "setup", outputMode: SetupOutputMode = "full"): void {
  const options = parseSetupMcpOnlyOptions(args, commandLabel);
  const config = loadConfig();
  const ownerToken = config.ownerToken ?? generateOwnerToken();
  const initiallyRemovedBootstrapWorkspaces = !config.ownerToken && options.workspacePath
    ? config.workspaces.filter(isBootstrapDefaultWorkspace)
    : [];
  const nextConfig: LocalPortConfig = {
    ...config,
    ownerToken,
    publicBaseUrl: options.publicBaseUrl ?? config.publicBaseUrl,
    publicMcpOnly: true,
    workspaces: config.ownerToken ? [...config.workspaces] : config.workspaces.filter((workspace) => !isBootstrapDefaultWorkspace(workspace)),
  };
  let workspaceSummary: {
    id: string;
    name: string;
    path: string;
    created: boolean;
    permissions: { read: boolean; write: boolean; shell: boolean; codex: boolean; screen?: boolean };
    policy?: WorkspacePolicy;
    policyCreated: boolean;
  } | undefined;

  if (options.workspaceId && options.workspacePath) {
    const workspacePath = expandHomePath(options.workspacePath);
    let index = nextConfig.workspaces.findIndex((workspace) => workspace.id === options.workspaceId);
    if (index === -1 && !options.workspaceIdExplicit && options.reuseExistingPath) {
      const pathKey = normalizedWorkspacePathKey(workspacePath);
      if (pathKey) {
        index = nextConfig.workspaces.findIndex((workspace) => normalizedWorkspacePathKey(workspace.path) === pathKey);
      }
    }
    const existing = index === -1 ? undefined : nextConfig.workspaces[index];
    const permissions = {
      read: true,
      write: options.readOnly ? false : options.write ? true : existing?.permissions.write ?? false,
      shell: options.readOnly ? false : options.shell ? true : existing?.permissions.shell ?? false,
      codex: options.readOnly ? false : options.codex ? true : existing?.permissions.codex ?? false,
      screen: options.readOnly ? false : options.screen ? true : existing?.permissions.screen ?? false,
    };
    const workspace = {
      id: existing?.id ?? options.workspaceId,
      name: options.workspaceName ?? existing?.name ?? workspaceNameFromPath(options.workspacePath),
      path: workspacePath,
      permissions,
      policy: existing?.policy ?? defaultExecutionPolicyForPermissions(permissions),
    };
    if (index === -1) nextConfig.workspaces.push(workspace);
    else nextConfig.workspaces[index] = workspace;
    workspaceSummary = {
      id: workspace.id,
      name: workspace.name,
      path: resolve(expandHomePath(workspace.path)),
      created: index === -1,
      permissions,
      policy: workspace.policy,
      policyCreated: !existing?.policy && Boolean(workspace.policy),
    };
  }

  const bootstrapCleanup = options.workspacePath
    ? removeBootstrapDefaultWorkspacesAfterExplicitSetup(nextConfig.workspaces)
    : { workspaces: nextConfig.workspaces, removed: [] };
  nextConfig.workspaces = bootstrapCleanup.workspaces;
  const removedBootstrapWorkspaces = uniqueWorkspaceSummaries([
    ...initiallyRemovedBootstrapWorkspaces,
    ...bootstrapCleanup.removed,
  ]);

  const writtenPath = writeConfig(nextConfig);
  const mcpUrl = options.publicBaseUrl ? new URL("/mcp", options.publicBaseUrl).href : undefined;
  const host = options.publicBaseUrl ? new URL(options.publicBaseUrl).host : undefined;
  const localTarget = `http://${nextConfig.host ?? "127.0.0.1"}:${nextConfig.port ?? 3939}`;
  const wafExpression = host ? `(http.host eq "${host}" and http.request.uri.path ne "/mcp")` : undefined;
  const startCommandParts = [...invocationCommandParts(), "start"];
  if (options.tunnelProvider) startCommandParts.push("--tunnel", options.tunnelProvider);
  if (options.tunnelProvider === "openai") startCommandParts.push("--tunnel-id", options.openaiTunnelId ?? "tunnel_...");
  const startCommand = formatCliCommand(startCommandParts);
  const result = {
    kind: "computer-linker-mcp-only-setup",
    schemaVersion: 1,
    configPath: writtenPath,
    publicBaseUrl: options.publicBaseUrl ?? null,
    publicMcpUrl: mcpUrl,
    publicMcpOnly: true,
    tunnel: options.tunnelProvider ?? null,
    openaiTunnelId: options.openaiTunnelId ?? null,
    localTunnelTarget: localTarget,
    authHeader: options.showToken ? `Authorization: Bearer ${ownerToken}` : "Authorization: Bearer <ownerToken>",
    ownerToken: options.showToken ? ownerToken : undefined,
    ownerTokenCreated: !config.ownerToken,
    workspace: workspaceSummary,
    removedBootstrapWorkspaces,
    cloudflare: {
      tunnelPublicHostname: host,
      tunnelService: localTarget,
      wafRuleName: "Optional defense-in-depth: block non-MCP paths",
      wafExpression,
      wafAction: "Block",
    },
    commands: {
      start: startCommand,
      startLocalOnly: invocationCommand("start"),
      showToken: invocationCommand("profile", "--show-token"),
    },
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (outputMode === "startup") {
    printStartupSetupSummary(result);
    return;
  }

  printSetupSummary(result);
}

type SetupMcpOnlyTextResult = {
  configPath: string;
  publicMcpUrl?: string;
  publicBaseUrl: string | null;
  tunnel: TunnelProviderName | null;
  openaiTunnelId: string | null;
  localTunnelTarget: string;
  authHeader: string;
  ownerToken?: string;
  ownerTokenCreated: boolean;
  workspace?: {
    id: string;
    name: string;
    path: string;
    created: boolean;
    permissions: { read: boolean; write: boolean; shell: boolean; codex: boolean; screen?: boolean };
    policy?: WorkspacePolicy;
    policyCreated: boolean;
  };
  removedBootstrapWorkspaces: Array<{ id: string }>;
  cloudflare: {
    tunnelPublicHostname?: string;
    tunnelService: string;
    wafExpression?: string;
  };
  commands: {
    start: string;
    startLocalOnly: string;
    showToken: string;
  };
};

function printStartupSetupSummary(result: SetupMcpOnlyTextResult): void {
  const lines = ["Computer Linker auto setup"];
  if (result.ownerTokenCreated) lines.push("owner token: created");
  if (result.ownerToken) lines.push(`owner token: ${result.ownerToken}`);
  if (result.workspace) {
    lines.push(`workspace: ${result.workspace.created ? "created" : "updated"} ${result.workspace.id} (${result.workspace.name})`);
    lines.push(`path: ${result.workspace.path}`);
    lines.push(`access: ${setupAccessSummary(result.workspace.permissions)}`);
    if (result.workspace.policy) lines.push(`command policy: ${result.workspace.policyCreated ? "default limits" : "configured"}`);
  }
  if (result.removedBootstrapWorkspaces.length > 0) {
    lines.push(`removed bootstrap workspace: ${result.removedBootstrapWorkspaces.map((workspace) => workspace.id).join(", ")}`);
  }
  console.log(lines.join("\n"));
}

function printSetupSummary(result: SetupMcpOnlyTextResult): void {
  const lines = [
    "Computer Linker setup",
    `connect: ${setupConnectionSummary(result)}`,
    "public access: MCP endpoint only",
    `auth: ${result.ownerToken ? "bearer token shown below" : "bearer token configured"}`,
  ];
  if (result.ownerToken) lines.push(`auth header: ${result.authHeader}`);
  if (result.workspace) {
    lines.push(`workspace: ${result.workspace.created ? "created" : "updated"} ${result.workspace.id} (${result.workspace.name})`);
    lines.push(`path: ${result.workspace.path}`);
    lines.push(`access: ${setupAccessSummary(result.workspace.permissions)}`);
    if (result.workspace.policy) lines.push(`command policy: ${result.workspace.policyCreated ? "default limits" : "configured"}`);
  }
  if (result.removedBootstrapWorkspaces.length > 0) {
    lines.push(`removed bootstrap workspace: ${result.removedBootstrapWorkspaces.map((workspace) => workspace.id).join(", ")}`);
  }
  lines.push("next:");
  for (const action of setupNextActions(result)) lines.push(`  - ${action}`);
  lines.push("details: rerun the same setup command with --json for policy/WAF details");
  console.log(lines.join("\n"));
}

function setupConnectionSummary(result: SetupMcpOnlyTextResult): string {
  if (result.tunnel === "openai") {
    return `OpenAI Tunnel mode${result.openaiTunnelId ? ` (${result.openaiTunnelId})` : ""}`;
  }
  if (result.publicMcpUrl) return result.publicMcpUrl;
  if (result.tunnel) return `${result.tunnel} tunnel URL will be detected when start runs`;
  return "local only";
}

function setupAccessSummary(permissions: NonNullable<SetupMcpOnlyTextResult["workspace"]>["permissions"]): string {
  const parts = [permissions.write ? "read/write" : "read-only"];
  if (permissions.shell) parts.push("commands");
  if (permissions.codex) parts.push("codex");
  if (permissions.screen) parts.push("screen");
  return parts.join(", ");
}

function setupNextActions(result: SetupMcpOnlyTextResult): string[] {
  if (result.tunnel === "openai") {
    return [
      `Start server and tunnel: ${result.commands.start}`,
      "In ChatGPT connector settings, choose Tunnel mode and use the tunnel id.",
      `Use ${invocationCommand("client", "setup")} for other MCP clients.`,
    ];
  }
  if (result.tunnel) {
    return [
      `Start server and tunnel: ${result.commands.start}`,
      `Use ${invocationCommand("client", "setup")} after the tunnel is running.`,
      "Keep the start terminal open while the workspace is in use.",
    ];
  }
  if (result.publicMcpUrl) {
    return [
      `Start server: ${result.commands.start}`,
      `Use ${invocationCommand("client", "setup")} for auth and first-prompt guidance.`,
      "Optional network WAF details are available in setup --json.",
    ];
  }
  return [
    `Start server: ${result.commands.start}`,
    `Use ${invocationCommand("client", "setup")} to connect a local MCP client.`,
    `For remote ChatGPT access, use \`${invocationCommand("setup")} <folder> --dev --tunnel openai --tunnel-id tunnel_...\`.`,
  ];
}

function parseSetupMcpOnlyOptions(args: string[], commandLabel = "setup"): {
  publicBaseUrl?: string;
  tunnelProvider?: TunnelProviderName;
  openaiTunnelId?: string;
  workspaceId?: string;
  workspaceIdExplicit: boolean;
  reuseExistingPath: boolean;
  workspacePath?: string;
  workspaceName?: string;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen: boolean;
  readOnly: boolean;
  dev: boolean;
  showToken: boolean;
  json: boolean;
} {
  const valueOptions = new Set(["--url", "--id", "--name", "--tunnel", "--tunnel-id"]);
  const flagOptions = new Set(["--dev", "--coding", "--full-trust", "--write", "--shell", "--codex", "--screen", "--read-only", "--show-token", "--json"]);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (valueOptions.has(arg)) {
      index += 1;
      if (!args[index] || args[index].startsWith("--")) throw new Error(`${commandLabel} ${arg} requires a value`);
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown ${commandLabel} option: ${arg}`);
  }

  const explicitUrl = readOptionalStringOption(args, "--url", `${commandLabel} --url`);
  const explicitWorkspaceId = readOptionalStringOption(args, "--id", `${commandLabel} --id`);
  const tunnelProviderValue = readOptionalStringOption(args, "--tunnel", `${commandLabel} --tunnel`);
  const tunnelProvider = tunnelProviderValue ? parseTunnelProvider(tunnelProviderValue, `${commandLabel} --tunnel`) : undefined;
  const openaiTunnelId = readOptionalStringOption(args, "--tunnel-id", `${commandLabel} --tunnel-id`);
  if (openaiTunnelId && tunnelProvider !== "openai") {
    throw new Error(`${commandLabel} --tunnel-id is only valid with --tunnel openai`);
  }
  const firstPositionalIsUrl = typeof positional[0] === "string" && /^https?:\/\//i.test(positional[0]);
  const positionalUrl = explicitUrl ? undefined : firstPositionalIsUrl ? positional[0] : undefined;
  const positionalWorkspaceArgs = positionalUrl ? positional.slice(1) : positional;
  const [firstWorkspaceArg, secondWorkspaceArg, ...extra] = positionalWorkspaceArgs;
  if (extra.length > 0) {
    throw new Error(setupMcpOnlyUsage());
  }
  if (explicitUrl && typeof firstWorkspaceArg === "string" && /^https?:\/\//i.test(firstWorkspaceArg)) {
    throw new Error(`${commandLabel} accepts either <https-url> or --url, not both`);
  }
  if (explicitWorkspaceId && !firstWorkspaceArg) {
    throw new Error(`${commandLabel} --id requires a workspace path`);
  }
  if (explicitWorkspaceId && secondWorkspaceArg) {
    throw new Error(`${commandLabel} accepts either --id with <workspace-path> or legacy <workspace-id workspace-path>`);
  }

  const url = explicitUrl ?? positionalUrl;
  const workspacePath = secondWorkspaceArg ?? firstWorkspaceArg;
  if (!url && !workspacePath && tunnelProvider !== "tailscale" && tunnelProvider !== "openai") {
    throw new Error(setupMcpOnlyUsage());
  }
  const workspaceId = secondWorkspaceArg ? firstWorkspaceArg : explicitWorkspaceId ?? (workspacePath ? workspaceIdFromPath(workspacePath) : undefined);
  const permissionFlags = permissionPresetFlags(args, commandLabel);
  return {
    publicBaseUrl: url ? requireHttpsUrl(url, `${commandLabel} URL`, setupMcpOnlyUsage()) : undefined,
    tunnelProvider,
    openaiTunnelId,
    workspaceId,
    workspaceIdExplicit: Boolean(secondWorkspaceArg || explicitWorkspaceId),
    reuseExistingPath: commandLabel !== "setup mcp-only",
    workspacePath,
    workspaceName: readOptionalStringOption(args, "--name", `${commandLabel} --name`),
    write: permissionFlags.write,
    shell: permissionFlags.shell,
    codex: permissionFlags.codex,
    screen: permissionFlags.screen,
    readOnly: permissionFlags.readOnly,
    dev: permissionFlags.dev,
    showToken: args.includes("--show-token"),
    json: args.includes("--json"),
  };
}

function setupMcpOnlyUsage(): string {
  return [
    "Usage: computer-linker setup <workspace-path> [--dev|--coding|--read-only|--full-trust] [--tunnel cloudflare|tailscale|openai] [--tunnel-id tunnel_...] [--id workspace-id] [--name name] [--write] [--shell] [--codex] [--screen] [--show-token] [--json]",
    "       computer-linker setup <https-url> [workspace-path] [--write] [--screen] [--show-token]",
    "Legacy: computer-linker setup mcp-only <https-url|workspace-path> [workspace-path] [...]",
  ].join("\n");
}

function isBootstrapDefaultWorkspace(workspace: LocalPortConfig["workspaces"][number]): boolean {
  return workspace.id === "current" &&
    workspace.name === "Current directory" &&
    resolve(expandHomePath(workspace.path)) === resolve(process.cwd()) &&
    workspace.permissions.read === true &&
    workspace.permissions.write === true &&
    workspace.permissions.shell === true &&
    workspace.permissions.codex === false &&
    Boolean(workspace.permissions.screen) === false &&
    !workspace.policy;
}

function removeBootstrapDefaultWorkspacesAfterExplicitSetup(workspaces: WorkspaceConfigEntry[]): {
  workspaces: WorkspaceConfigEntry[];
  removed: WorkspaceConfigEntry[];
} {
  const removed = workspaces.filter(isBootstrapDefaultWorkspace);
  if (removed.length === 0 || workspaces.length <= removed.length) {
    return { workspaces, removed: [] };
  }
  return {
    workspaces: workspaces.filter((workspace) => !isBootstrapDefaultWorkspace(workspace)),
    removed,
  };
}

function uniqueWorkspaceSummaries(workspaces: WorkspaceConfigEntry[]): Array<{ id: string; name: string; path: string }> {
  const seen = new Set<string>();
  const summaries: Array<{ id: string; name: string; path: string }> = [];
  for (const workspace of workspaces) {
    if (seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    summaries.push({
      id: workspace.id,
      name: workspace.name,
      path: resolve(expandHomePath(workspace.path)),
    });
  }
  return summaries;
}

function defaultExecutionPolicyForPermissions(
  permissions: { shell: boolean; codex: boolean },
): WorkspacePolicy | undefined {
  if (!permissions.shell && !permissions.codex) return undefined;
  const allowedCommands = [
    "npm *",
    "pnpm *",
    "yarn *",
    "bun *",
    "node *",
    "npx *",
    "git *",
  ];
  if (permissions.codex) allowedCommands.push("codex *");
  return {
    maxRuntimeSeconds: permissions.codex ? 1800 : 600,
    maxOutputBytes: 200000,
    allowedCommands,
    deniedCommands: ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"],
  };
}

function repairedExecutionPolicy(
  policy: WorkspacePolicy | undefined,
  permissions: { shell: boolean; codex: boolean },
): WorkspacePolicy | undefined {
  const defaults = defaultExecutionPolicyForPermissions(permissions);
  if (!defaults) return policy;
  if (!policy) return defaults;
  return {
    ...policy,
    maxRuntimeSeconds: policy.maxRuntimeSeconds ?? defaults.maxRuntimeSeconds,
    maxOutputBytes: policy.maxOutputBytes ?? defaults.maxOutputBytes,
    allowedCommands: policy.allowedCommands?.length ? policy.allowedCommands : defaults.allowedCommands,
    deniedCommands: mergePolicyList(policy.deniedCommands, defaults.deniedCommands ?? []),
  };
}

function policyChanged(before: WorkspacePolicy | undefined, after: WorkspacePolicy | undefined): boolean {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

function removeExactDuplicateWorkspaces(workspaces: WorkspaceConfigEntry[]): {
  workspaces: WorkspaceConfigEntry[];
  repairs: Array<{ id: string; status: "applied"; detail: string; workspaceId?: string }>;
} {
  const kept: WorkspaceConfigEntry[] = [];
  const firstByPath = new Map<string, WorkspaceConfigEntry>();
  const repairs: Array<{ id: string; status: "applied"; detail: string; workspaceId?: string }> = [];

  for (const workspace of workspaces) {
    const pathKey = normalizedWorkspacePathKey(workspace.path);
    const first = pathKey ? firstByPath.get(pathKey) : undefined;
    if (first && workspaceEquivalentForDuplicateCleanup(first, workspace)) {
      repairs.push({
        id: "remove-exact-duplicate-workspace",
        status: "applied",
        workspaceId: workspace.id,
        detail: `Removed duplicate scope ${workspace.id}; it points at the same folder with the same permissions and policy as ${first.id}.`,
      });
      continue;
    }

    kept.push(workspace);
    if (pathKey && !firstByPath.has(pathKey)) firstByPath.set(pathKey, workspace);
  }

  return { workspaces: kept, repairs };
}

function workspaceEquivalentForDuplicateCleanup(a: WorkspaceConfigEntry, b: WorkspaceConfigEntry): boolean {
  return normalizedWorkspacePathKey(a.path) === normalizedWorkspacePathKey(b.path) &&
    JSON.stringify(normalizedPermissionShape(a.permissions)) === JSON.stringify(normalizedPermissionShape(b.permissions)) &&
    JSON.stringify(a.policy ?? null) === JSON.stringify(b.policy ?? null);
}

function normalizedPermissionShape(permissions: WorkspaceConfigEntry["permissions"]): Required<WorkspaceConfigEntry["permissions"]> {
  return {
    read: Boolean(permissions.read),
    write: Boolean(permissions.write),
    shell: Boolean(permissions.shell),
    codex: Boolean(permissions.codex),
    screen: Boolean(permissions.screen),
  };
}

function normalizedWorkspacePathKey(path: string | undefined): string | undefined {
  const text = path?.trim();
  if (!text) return undefined;
  const resolved = resolve(expandHomePath(text));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function workspaceIdFromPath(path: string): string {
  const name = basename(resolve(expandHomePath(path)));
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function workspaceNameFromPath(path: string): string {
  return basename(resolve(expandHomePath(path))) || "Workspace";
}

function validateConfig(args: string[]): void {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new Error(`Unknown config validate option: ${unknown[0]}`);
  }
  const doctor = getLocalPortDoctor() as {
    configDiagnostics: { criticalCount: number; warningCount: number; findings: unknown[] };
    security: { criticalCount: number; warningCount: number; findings: unknown[] };
    releaseReadiness: {
      ready: boolean;
      status: string;
      blockingReasons: string[];
      warnings: string[];
      recommendedGate: string;
    };
  };
  const report = {
    kind: "computer-linker-config-validation",
    schemaVersion: 1,
    configPath: configPath(),
    ready: doctor.releaseReadiness.ready,
    status: doctor.releaseReadiness.status,
    configDiagnostics: doctor.configDiagnostics,
    security: doctor.security,
    releaseReadiness: doctor.releaseReadiness,
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Computer Linker config validation");
    console.log(`configPath: ${report.configPath}`);
    console.log(`status: ${report.status} ready=${report.ready ? "yes" : "no"}`);
    console.log(`config: critical=${report.configDiagnostics.criticalCount} warning=${report.configDiagnostics.warningCount}`);
    console.log(`security: critical=${report.security.criticalCount} warning=${report.security.warningCount}`);
    if (doctor.releaseReadiness.blockingReasons.length > 0) {
      console.log("blocking reasons:");
      for (const reason of doctor.releaseReadiness.blockingReasons) {
        console.log(`  - ${reason}`);
      }
    }
    if (doctor.releaseReadiness.warnings.length > 0) {
      console.log("warnings:");
      for (const warning of doctor.releaseReadiness.warnings) {
        console.log(`  - ${warning}`);
      }
    }
  }

  if (doctor.releaseReadiness.status === "blocked") {
    process.exitCode = 1;
  }
}

function configPolicy(args: string[]): void {
  const [workspaceId] = args;
  if (!workspaceId || workspaceId.startsWith("--")) {
    throw new Error("Usage: computer-linker config policy <workspace-id> [--json] [--allow pattern] [--deny pattern] [--max-runtime-seconds n] [--max-output-bytes n] [--clear|--clear-allowed|--clear-denied]");
  }
  assertKnownConfigPolicyOptions(args.slice(1));
  const config = loadConfig();
  const index = config.workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (index === -1) {
    throw new Error(`Unknown workspace: ${workspaceId}`);
  }
  const rest = args.slice(1);
  const current = config.workspaces[index];
  const updates = configPolicyUpdates(rest);
  const hasUpdates = policyHasUpdates(updates);

  if (!hasUpdates) {
    printConfigPolicy(current.id, current.policy, rest.includes("--json"));
    return;
  }

  const nextPolicy = applyPolicyUpdates(current.policy, updates);
  config.workspaces[index] = {
    ...current,
    policy: nextPolicy,
  };
  const writtenPath = writeConfig(config);
  const updated = loadConfig().workspaces.find((workspace) => workspace.id === workspaceId);
  if (rest.includes("--json")) {
    console.log(JSON.stringify({
      kind: "computer-linker-config-policy",
      workspaceId,
      configPath: writtenPath,
      policy: updated?.policy ?? {},
    }, null, 2));
    return;
  }
  console.log(`Updated policy for workspace ${workspaceId} in ${writtenPath}`);
  printPolicyLines(updated?.policy);
}

function assertKnownConfigPolicyOptions(args: string[]): void {
  const valueOptions = new Set(["--allow", "--deny", "--max-runtime-seconds", "--max-output-bytes"]);
  const flagOptions = new Set(["--json", "--clear", "--clear-allowed", "--clear-denied"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown config policy argument: ${arg}`);
    if (valueOptions.has(arg)) {
      index += 1;
      if (!args[index] || args[index].startsWith("--")) throw new Error(`config policy ${arg} requires a value`);
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown config policy option: ${arg}`);
  }
}

function configPolicyUpdates(args: string[]): {
  clear: boolean;
  clearAllowed: boolean;
  clearDenied: boolean;
  allowedCommands: string[];
  deniedCommands: string[];
  maxRuntimeSeconds?: number;
  maxOutputBytes?: number;
} {
  return {
    clear: args.includes("--clear"),
    clearAllowed: args.includes("--clear-allowed"),
    clearDenied: args.includes("--clear-denied"),
    allowedCommands: readRepeatedOptions(args, "--allow", "config policy --allow"),
    deniedCommands: readRepeatedOptions(args, "--deny", "config policy --deny"),
    maxRuntimeSeconds: readOptionalIntegerOption(args, "--max-runtime-seconds", "config policy --max-runtime-seconds"),
    maxOutputBytes: readOptionalIntegerOption(args, "--max-output-bytes", "config policy --max-output-bytes"),
  };
}

function policyHasUpdates(updates: ReturnType<typeof configPolicyUpdates>): boolean {
  return (
    updates.clear ||
    updates.clearAllowed ||
    updates.clearDenied ||
    updates.allowedCommands.length > 0 ||
    updates.deniedCommands.length > 0 ||
    updates.maxRuntimeSeconds !== undefined ||
    updates.maxOutputBytes !== undefined
  );
}

function applyPolicyUpdates(
  policy: WorkspacePolicy | undefined,
  updates: ReturnType<typeof configPolicyUpdates>,
): WorkspacePolicy | undefined {
  const next: WorkspacePolicy = updates.clear ? {} : { ...(policy ?? {}) };
  if (updates.clearAllowed) delete next.allowedCommands;
  if (updates.clearDenied) delete next.deniedCommands;
  if (updates.maxRuntimeSeconds !== undefined) next.maxRuntimeSeconds = updates.maxRuntimeSeconds;
  if (updates.maxOutputBytes !== undefined) next.maxOutputBytes = updates.maxOutputBytes;
  if (updates.allowedCommands.length > 0) {
    next.allowedCommands = mergePolicyList(next.allowedCommands, updates.allowedCommands);
  }
  if (updates.deniedCommands.length > 0) {
    next.deniedCommands = mergePolicyList(next.deniedCommands, updates.deniedCommands);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function mergePolicyList(current: string[] | undefined, next: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...(current ?? []), ...next]) {
    const text = item.trim().replace(/\s+/g, " ");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    merged.push(text);
  }
  return merged;
}

function printConfigPolicy(workspaceId: string, policy: WorkspacePolicy | undefined, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({
      kind: "computer-linker-config-policy",
      workspaceId,
      configPath: configPath(),
      policy: policy ?? {},
    }, null, 2));
    return;
  }
  console.log(`Computer Linker policy for ${workspaceId}`);
  printPolicyLines(policy);
}

function printPolicyLines(policy: WorkspacePolicy | undefined): void {
  console.log(`maxRuntimeSeconds: ${policy?.maxRuntimeSeconds ?? "not set"}`);
  console.log(`maxOutputBytes: ${policy?.maxOutputBytes ?? "not set"}`);
  console.log(`allowedCommands: ${policy?.allowedCommands?.join(", ") || "not set"}`);
  console.log(`deniedCommands: ${policy?.deniedCommands?.join(", ") || "not set"}`);
}

function formatPermissions(permissions: LocalPortConfig["workspaces"][number]["permissions"]): string {
  return [
    `read=${permissions.read}`,
    `write=${permissions.write}`,
    `shell=${permissions.shell}`,
    `codex=${permissions.codex}`,
    `screen=${Boolean(permissions.screen)}`,
  ].join(" ");
}

function addWorkspace(args: string[]): void {
  const options = parseWorkspaceAddOptions(args);

  const config = loadConfig();
  if (config.workspaces.some((entry) => entry.id === options.id)) {
    throw new Error(`Workspace already exists: ${options.id}`);
  }

  config.workspaces.push({
    id: options.id,
    name: options.name,
    path: expandHomePath(options.path),
    permissions: {
      read: true,
      write: options.write,
      shell: options.shell,
      codex: options.codex,
      screen: options.screen,
    },
  });

  const writtenPath = writeConfig(config);
  console.log(`Added workspace ${options.id} (${options.name}) -> ${resolve(expandHomePath(options.path))} to ${writtenPath}`);
}

function parseWorkspaceAddOptions(args: string[]): {
  id: string;
  name: string;
  path: string;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen: boolean;
} {
  const usage = "Usage: computer-linker workspace add <path> [--id workspace-id] [--name name] [--dev|--coding|--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]\nLegacy: computer-linker workspace add <id> <path> [--name name] [--dev|--coding|--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]";
  const valueOptions = new Set(["--id", "--name"]);
  const flagOptions = new Set(["--dev", "--coding", "--full-trust", "--read-only", "--write", "--shell", "--codex", "--screen"]);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (valueOptions.has(arg)) {
      index += 1;
      if (!args[index] || args[index].startsWith("--")) throw new Error(`workspace add ${arg} requires a value`);
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown workspace add option: ${arg}`);
  }

  const explicitId = readOptionalStringOption(args, "--id", "workspace add --id");
  const explicitName = readOptionalStringOption(args, "--name", "workspace add --name");
  const [first, second, ...extra] = positional;
  if (!first || extra.length > 0) throw new Error(usage);
  if (explicitId && second) {
    throw new Error("workspace add accepts either --id with <path> or legacy <id> <path>");
  }

  const path = second ?? first;
  const id = second ? first : explicitId ?? workspaceIdFromPath(path);
  const permissionFlags = permissionPresetFlags(args, "workspace add");
  return {
    id,
    name: explicitName ?? workspaceNameFromPath(path),
    path,
    write: permissionFlags.write,
    shell: permissionFlags.shell,
    codex: permissionFlags.codex,
    screen: permissionFlags.screen,
  };
}

function updateWorkspace(args: string[]): void {
  const [id] = args;
  if (!id) {
    throw new Error("Usage: computer-linker workspace update <id> [--name name] [--path path] [--dev|--coding|--read-only|--full-trust] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen]");
  }
  assertReadOnlyNotMixed(args, "workspace update");

  const config = loadConfig();
  const index = config.workspaces.findIndex((entry) => entry.id === id);
  if (index === -1) {
    throw new Error(`Unknown workspace: ${id}`);
  }

  const current = config.workspaces[index];
  const readOnly = args.includes("--read-only");
  const fullTrust = args.includes("--full-trust");
  const coding = args.includes("--dev") || args.includes("--coding") || fullTrust;
  config.workspaces[index] = {
    ...current,
    name: readOption(args, "--name") ?? current.name,
    path: readOption(args, "--path") ? expandHomePath(readOption(args, "--path") ?? current.path) : current.path,
    permissions: {
      read: true,
      write: readOnly ? false : coding ? true : booleanFlag(args, "write", current.permissions.write),
      shell: readOnly ? false : coding ? true : booleanFlag(args, "shell", current.permissions.shell),
      codex: readOnly ? false : fullTrust ? true : booleanFlag(args, "codex", current.permissions.codex),
      screen: readOnly ? false : fullTrust ? true : booleanFlag(args, "screen", Boolean(current.permissions.screen)),
    },
  };

  const writtenPath = writeConfig(config);
  console.log(`Updated workspace ${id} in ${writtenPath}`);
}

function removeWorkspace(args: string[]): void {
  const [id] = args;
  if (!id) {
    throw new Error("Usage: computer-linker workspace remove <id>");
  }

  const config = loadConfig();
  const nextWorkspaces = config.workspaces.filter((entry) => entry.id !== id);
  if (nextWorkspaces.length === config.workspaces.length) {
    throw new Error(`Unknown workspace: ${id}`);
  }

  writeConfig({
    ...config,
    workspaces: nextWorkspaces,
  });
  console.log(`Removed workspace ${id}`);
}

async function serve(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    printServeHelp();
    return;
  }
  const transport = readOption(args, "--transport") ?? "stdio";
  if (transport === "stdio") {
    await serveStdio();
    return;
  }
  if (transport !== "http") {
    throw new Error(`Unknown transport: ${transport}`);
  }

  const config = loadConfig();
  const server = serveHttp();
  console.log(`Computer Linker HTTP MCP server listening at ${server.url}`);
  console.log(startupPublicMcpUrlLine(config, undefined, server.publicUrl));
  console.log(`Local API: ${server.apiUrl}`);
  printHttpAuthHint();
  await waitForShutdown(server.close);
}

async function start(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    printStartHelp();
    return;
  }
  const options = parseStartOptions(args);
  if (options.workspacePath) {
    setupMcpOnly(startSetupArgs(options), "start", "startup");
  }
  let config = loadConfig();
  const localPort = config.port ?? 3939;
  let openAiClientPath: string | undefined;
  let openAiTunnelId: string | undefined;
  if (options.tunnelProvider) {
    assertExposeAuthConfigured(config, invocationCommand("start"));
    if (options.tunnelProvider === "openai") {
      openAiTunnelId = assertOpenAiTunnelConfigured(options.openaiTunnelId);
      const install = await ensureOpenAiTunnelClientInstalled({ clientPath: options.openaiClientPath });
      openAiClientPath = install.path;
      const source = install.source === "downloaded"
        ? `downloaded ${install.releaseTag ?? "latest official release"}`
        : install.source;
      console.log(`OpenAI tunnel-client: ready (${source})`);
    } else {
      assertTunnelToolAvailable(options.tunnelProvider, localPort, config.publicBaseUrl);
    }
    config = ensurePublicMcpOnlyForTunnel(config, options.tunnelProvider);
  }

  const server = serveHttp();
  const startupCheck = await runStartupCheck(config, server.url);

  try {
    if (options.tunnelProvider) {
      const tunnel = startTunnelProcess({
        provider: options.tunnelProvider,
        localPort,
        tailscaleMode: options.tailscaleMode,
        openaiTunnelId: openAiTunnelId,
        openaiClientPath: openAiClientPath,
        ownerToken: config.ownerToken,
      });
      if (options.tunnelProvider === "openai") {
        const readyTunnel = await waitForTunnelStartup(tunnel.id, Math.min(options.tunnelTimeoutMs, 3000));
        if (readyTunnel?.status === "exited") {
          throw new Error(`OpenAI tunnel-client exited before staying connected.${readyTunnel.stderr ? ` ${readyTunnel.stderr.trim()}` : ""}`);
        }
        printStartSummary({
          config,
          options,
          server,
          startupCheck,
          tunnel: {
            provider: "openai",
            display: tunnel.display,
            openAiTunnelId,
            status: "running",
          },
        });
        await waitForShutdown(server.close);
        return;
      }
      const readyTunnel = await waitForTunnelPublicUrl(tunnel.id, options.tunnelTimeoutMs);
      if (readyTunnel?.publicUrl) {
        const savedPath = saveDetectedTunnelPublicBaseUrl(options.tunnelProvider, readyTunnel.publicUrl);
        printStartSummary({
          config: savedPath ? loadConfig() : config,
          options,
          server,
          startupCheck,
          tunnel: {
            provider: options.tunnelProvider,
            display: tunnel.display,
            status: "running",
            publicUrl: readyTunnel.publicUrl,
            savedConfigPath: savedPath,
          },
        });
      } else if (readyTunnel?.status === "exited") {
        throw new Error(`Tunnel exited before a public URL was detected.${readyTunnel.stderr ? ` ${readyTunnel.stderr.trim()}` : ""}`);
      } else {
        printStartSummary({
          config,
          options,
          server,
          startupCheck,
          tunnel: {
            provider: options.tunnelProvider,
            display: tunnel.display,
            status: "pending",
          },
        });
      }
    } else {
      printStartSummary({ config, options, server, startupCheck });
    }
    await waitForShutdown(server.close);
  } catch (error) {
    server.close();
    throw error;
  }
}

function startupPublicMcpUrlLine(
  config: LocalPortConfig,
  tunnelProvider: TunnelProviderName | undefined,
  serverPublicUrl: string,
): string {
  if (tunnelProvider === "openai") {
    return "Public MCP URL: not used in OpenAI tunnel mode";
  }
  if (config.publicBaseUrl) {
    return `Public MCP URL: ${serverPublicUrl}`;
  }
  if (tunnelProvider) {
    return "Public MCP URL: pending tunnel detection";
  }
  return "Public MCP URL: not configured; local-only";
}

type StartupCheckSummary = {
  status: "ready" | "needs_attention" | "skipped";
  passed: number;
  total: number;
  blockingReasons: string[];
  detail?: string;
  command: string;
};

type StartTunnelSummary = {
  provider: TunnelProviderName;
  display: string;
  status: "running" | "pending";
  publicUrl?: string;
  savedConfigPath?: string;
  openAiTunnelId?: string;
};

async function runStartupCheck(config: LocalPortConfig, localMcpUrl: string): Promise<StartupCheckSummary> {
  const command = invocationCommand("client", "smoke", "--allow-http", "--url", localMcpUrl);
  try {
    await waitForSelfTestServer(new URL(localMcpUrl).origin, 10000);
    const report = await runWorkspaceLinkerMcpClientSmoke(config, {
      url: localMcpUrl,
      allowHttp: true,
      timeoutMs: 10000,
      clientName: "computer-linker-startup-check",
    });
    const passed = report.checks.filter((check) => check.status === "pass").length;
    const total = report.checks.length;
    if (report.ready) {
      return { status: "ready", passed, total, blockingReasons: [], command };
    }
    return { status: "needs_attention", passed, total, blockingReasons: report.blockingReasons, command };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "skipped", passed: 0, total: 0, blockingReasons: [], detail, command };
  }
}

function printStartSummary(input: {
  config: LocalPortConfig;
  options: StartOptions;
  server: ReturnType<typeof serveHttp>;
  startupCheck: StartupCheckSummary;
  tunnel?: StartTunnelSummary;
}): void {
  const { config, options, server, startupCheck, tunnel } = input;
  const localMcpUrl = server.url;
  const lines = [
    "Computer Linker started",
    "server: running",
    `local MCP: ${localMcpUrl}`,
    `connect: ${startConnectionSummary(config, options, server, tunnel)}`,
    `auth: ${startAuthSummary(config, options.tunnelProvider)}`,
    `startup check: ${formatStartupCheckStatus(startupCheck)}`,
    `tunnel: ${startTunnelLine(options, tunnel)}`,
  ];

  if (startupCheck.status === "needs_attention") {
    lines.push("startup issues:");
    for (const reason of startupCheck.blockingReasons.slice(0, 3)) lines.push(`  - ${reason}`);
    appendRemainingCount(lines, startupCheck.blockingReasons.length, 3, "startup issue", startupCheck.command);
  } else if (startupCheck.status === "skipped") {
    lines.push(`startup detail: ${startupCheck.detail}`);
  }

  if (tunnel?.provider === "openai") {
    lines.push(`tunnel id: ${tunnel.openAiTunnelId ?? "(not configured)"}`);
  }
  if (tunnel?.publicUrl) {
    lines.push(`public MCP: ${new URL("/mcp", tunnel.publicUrl).href}`);
    if (tunnel.savedConfigPath) lines.push(`saved public URL: ${tunnel.publicUrl}`);
  }

  lines.push("next:");
  for (const action of startNextActions(config, options, tunnel)) lines.push(`  - ${action}`);
  lines.push(`details: ${invocationCommand("status", "--details")}`);
  console.log(lines.join("\n"));
}

function formatStartupCheckStatus(check: StartupCheckSummary): string {
  if (check.status === "ready") return `ready (${check.passed}/${check.total})`;
  if (check.status === "needs_attention") return `needs attention (${check.passed}/${check.total})`;
  return "skipped";
}

function startConnectionSummary(
  config: LocalPortConfig,
  options: StartOptions,
  server: ReturnType<typeof serveHttp>,
  tunnel?: StartTunnelSummary,
): string {
  if (options.tunnelProvider === "openai") {
    return `OpenAI Tunnel mode${tunnel?.openAiTunnelId ? ` (${tunnel.openAiTunnelId})` : ""}`;
  }
  if (tunnel?.publicUrl) return new URL("/mcp", tunnel.publicUrl).href;
  if (config.publicBaseUrl && !options.tunnelProvider) return server.publicUrl;
  if (options.tunnelProvider) return "waiting for tunnel public URL";
  return "local only";
}

function startAuthSummary(config: LocalPortConfig, tunnelProvider?: TunnelProviderName): string {
  if (!config.ownerToken) return "loopback only; run computer-linker init before exposing";
  if (tunnelProvider === "openai") return "handled by tunnel-client; do not paste a bearer token into ChatGPT";
  return `bearer token configured; setup command: ${invocationCommand("client", "setup")}`;
}

function startTunnelLine(options: StartOptions, tunnel?: StartTunnelSummary): string {
  if (!options.tunnelProvider) {
    return options.noTunnelExplicit
      ? "disabled by --no-tunnel"
      : "disabled; restart with --tunnel openai, tailscale, or cloudflare for remote access";
  }
  if (!tunnel) return "starting";
  if (tunnel.status === "pending") return `${tunnel.provider} pending public URL`;
  if (tunnel.provider === "openai") return "OpenAI Secure MCP Tunnel active";
  return `${tunnel.provider} active`;
}

function startNextActions(config: LocalPortConfig, options: StartOptions, tunnel?: StartTunnelSummary): string[] {
  if (options.tunnelProvider === "openai") {
    return [
      "In ChatGPT connector settings, choose Tunnel mode and select or paste the tunnel id above.",
      "Keep this terminal running while ChatGPT uses the workspace.",
      `Use ${invocationCommand("client", "setup")} if another MCP client needs setup instructions.`,
    ];
  }
  if (tunnel?.publicUrl) {
    return [
      `Use ${new URL("/mcp", tunnel.publicUrl).href} as the remote MCP URL.`,
      `Use ${invocationCommand("client", "setup")} for auth and first-prompt guidance.`,
      "Keep this terminal running while the tunnel is in use.",
    ];
  }
  if (options.tunnelProvider) {
    return [
      `Run ${invocationCommand("tunnel", "status")} to inspect tunnel output.`,
      "Keep this terminal running while the tunnel is starting.",
      `Use ${invocationCommand("status", "--details")} for full readiness details.`,
    ];
  }
  return [
    `Use ${invocationCommand("client", "setup")} to connect a local MCP client.`,
    "For ChatGPT remote access, restart with `computer-linker start <workspace-path> --dev --tunnel openai --tunnel-id tunnel_...`.",
    config.ownerToken ? "Keep this terminal running while the client is connected." : `Run ${invocationCommand("init")} before exposing this computer.`,
  ];
}

function ensurePublicMcpOnlyForTunnel(config: LocalPortConfig, provider: TunnelProviderName): LocalPortConfig {
  if (config.publicMcpOnly) return config;
  const nextConfig = {
    ...config,
    publicMcpOnly: true,
  };
  writeConfig(nextConfig);
  console.log(`public access: MCP endpoint only for ${provider} tunnel.`);
  return nextConfig;
}

function saveDetectedTunnelPublicBaseUrl(provider: TunnelProviderName, publicUrl: string): string | undefined {
  if (provider !== "tailscale") return undefined;
  const publicBaseUrl = requireHttpsUrl(publicUrl, "detected tunnel URL");
  const config = loadConfig();
  if (config.publicBaseUrl === publicBaseUrl) return undefined;
  return writeConfig({
    ...config,
    publicBaseUrl,
  });
}

function startSetupArgs(options: StartOptions): string[] {
  const setupArgs: string[] = [];
  if (options.publicBaseUrl) setupArgs.push("--url", options.publicBaseUrl);
  if (options.workspacePath) setupArgs.push(options.workspacePath);
  if (options.workspaceId) setupArgs.push("--id", options.workspaceId);
  if (options.workspaceName) setupArgs.push("--name", options.workspaceName);
  if (options.tunnelProvider) setupArgs.push("--tunnel", options.tunnelProvider);
  if (options.openaiTunnelId) setupArgs.push("--tunnel-id", options.openaiTunnelId);
  if (options.dev) {
    setupArgs.push("--dev");
  } else {
    if (options.write) setupArgs.push("--write");
    if (options.shell) setupArgs.push("--shell");
  }
  if (options.codex) setupArgs.push("--codex");
  if (options.screen) setupArgs.push("--screen");
  if (options.readOnly) setupArgs.push("--read-only");
  if (options.showToken) setupArgs.push("--show-token");
  return setupArgs;
}

async function expose(args: string[]): Promise<void> {
  const provider = args[0] as TunnelProviderName | undefined;
  if (args[0] === "help") {
    printExposeHelpTopic(args.slice(1));
    return;
  }
  if (args[0] === "--help" || args[0] === "-h") {
    printExposeHelp();
    return;
  }
  if (hasHelpFlag(args.slice(1))) {
    printExposeHelpTopic([args[0]]);
    return;
  }
  if (provider !== "cloudflare" && provider !== "tailscale") {
    throw new Error("Usage: computer-linker expose <cloudflare|tailscale> [--mode funnel]");
  }

  let config = loadConfig();
  assertExposeAuthConfigured(config, invocationCommand("expose"));
  const localPort = config.port ?? 3939;
  const mode = readOption(args, "--mode");
  if (mode && provider !== "tailscale") {
    throw new Error("expose --mode is only valid with tailscale");
  }
  const tailscaleMode = provider === "tailscale"
    ? parseTailscaleMode(mode ?? "funnel", "expose --mode")
    : undefined;
  config = ensurePublicMcpOnlyForTunnel(config, provider);

  const server = serveHttp();
  console.log(`Computer Linker HTTP MCP server listening at ${server.url}`);
  console.log(startupPublicMcpUrlLine(config, provider, server.publicUrl));
  console.log(`Local API: ${server.apiUrl}`);
  printHttpAuthHint(provider);
  console.log("Expose mode starts a tunnel to the local HTTP MCP endpoint.");
  console.log("Use Tailscale ACLs, Cloudflare Access, or equivalent network controls for another layer of protection.");

  try {
    await exposeWithTunnel({
      provider,
      localPort,
      tailscaleMode,
    });
  } finally {
    server.close();
  }
}

type StartOptions = {
  workspacePath?: string;
  workspaceId?: string;
  workspaceName?: string;
  publicBaseUrl?: string;
  dev: boolean;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen: boolean;
  readOnly: boolean;
  showToken: boolean;
  noTunnelExplicit: boolean;
  tunnelProvider?: TunnelProviderName;
  tailscaleMode?: TailscaleMode;
  openaiTunnelId?: string;
  openaiClientPath?: string;
  tunnelTimeoutMs: number;
};

function parseStartOptions(args: string[]): StartOptions {
  const valueOptions = new Set(["--tunnel", "--mode", "--tunnel-timeout-ms", "--tunnel-id", "--tunnel-client", "--url", "--id", "--name"]);
  const flagOptions = new Set(["--no-tunnel", "--dev", "--coding", "--full-trust", "--write", "--shell", "--codex", "--screen", "--read-only", "--show-token"]);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (valueOptions.has(arg)) {
      index += 1;
      if (!args[index] || args[index].startsWith("--")) throw new Error(`start ${arg} requires a value`);
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown start option: ${arg}`);
  }

  if (positional.length > 1) {
    throw new Error("Usage: computer-linker start [workspace-path] [--no-tunnel|--tunnel cloudflare|tailscale|openai] [--dev|--coding|--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]");
  }
  const workspacePath = positional[0];
  const setupOnlyOptions = ["--url", "--id", "--name", "--dev", "--coding", "--full-trust", "--write", "--shell", "--codex", "--screen", "--read-only", "--show-token"];
  const setupOnlyOption = setupOnlyOptions.find((option) => args.includes(option));
  if (setupOnlyOption && !workspacePath) {
    throw new Error(`start ${setupOnlyOption} is only valid when start is given a workspace path`);
  }
  if (args.includes("--no-tunnel") && args.includes("--tunnel")) {
    throw new Error("start accepts either --tunnel or --no-tunnel, not both");
  }

  const noTunnelExplicit = args.includes("--no-tunnel");
  const tunnelOption = readOptionalStringOption(args, "--tunnel", "start --tunnel");
  const tunnelProvider = noTunnelExplicit || !tunnelOption
    ? undefined
    : parseTunnelProvider(tunnelOption, "start --tunnel");
  const mode = readOptionalStringOption(args, "--mode", "start --mode");
  if (mode && tunnelProvider !== "tailscale") {
    throw new Error("start --mode is only valid with --tunnel tailscale");
  }
  const openaiTunnelId = readOptionalStringOption(args, "--tunnel-id", "start --tunnel-id");
  const openaiClientPath = readOptionalStringOption(args, "--tunnel-client", "start --tunnel-client");
  if ((openaiTunnelId || openaiClientPath) && tunnelProvider !== "openai") {
    throw new Error("start --tunnel-id and --tunnel-client are only valid with --tunnel openai");
  }
  const permissionFlags = permissionPresetFlags(args, "start");

  return {
    workspacePath,
    workspaceId: readOptionalStringOption(args, "--id", "start --id"),
    workspaceName: readOptionalStringOption(args, "--name", "start --name"),
    publicBaseUrl: readOptionalStringOption(args, "--url", "start --url"),
    dev: permissionFlags.dev,
    write: permissionFlags.write,
    shell: permissionFlags.shell,
    codex: permissionFlags.codex,
    screen: permissionFlags.screen,
    readOnly: permissionFlags.readOnly,
    showToken: args.includes("--show-token"),
    noTunnelExplicit,
    tunnelProvider,
    tailscaleMode: tunnelProvider === "tailscale" ? parseTailscaleMode(mode ?? "funnel", "start --mode") : undefined,
    openaiTunnelId,
    openaiClientPath,
    tunnelTimeoutMs: readOptionalIntegerOption(args, "--tunnel-timeout-ms", "start --tunnel-timeout-ms") ?? 8000,
  };
}

function parseTunnelProvider(value: string, command: string): TunnelProviderName {
  if (value === "cloudflare" || value === "tailscale" || value === "openai") return value;
  throw new Error(`${command} must be one of: cloudflare, tailscale, openai`);
}

function parseTailscaleMode(value: string, command: string): TailscaleMode {
  if (value === "funnel") return value;
  throw new Error(`${command} must be funnel`);
}

function assertTunnelToolAvailable(provider: TunnelProviderName, localPort: number, publicBaseUrl?: string): void {
  const status = tunnelDiagnostics({ localPort, publicBaseUrl, tunnels: listTunnelProcesses() })
    .providers.find((item) => item.provider === provider);
  if (status?.available) return;
  const tool = provider === "cloudflare" ? "cloudflared" : provider === "tailscale" ? "tailscale" : "tunnel-client";
  throw new Error(`${tool} is not available. Install ${tool}, choose another tunnel with --tunnel, or run ${invocationCommand("start")} without --tunnel.`);
}

function assertOpenAiTunnelConfigured(tunnelIdOption: string | undefined): string {
  const tunnelId = tunnelIdOption ?? configuredOpenAiTunnelId();
  if (!tunnelId) {
    throw new Error("start --tunnel openai requires --tunnel-id tunnel_... or COMPUTER_LINKER_OPENAI_TUNNEL_ID.");
  }
  if (!/^tunnel_[A-Za-z0-9_-]+$/.test(tunnelId)) {
    throw new Error("OpenAI tunnel id must look like tunnel_...");
  }
  if (!process.env.CONTROL_PLANE_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error(`OpenAI Secure MCP Tunnel requires CONTROL_PLANE_API_KEY (preferred) or OPENAI_API_KEY with Tunnels Read+Use permissions. Set it before starting. ${openAiTunnelApiKeyHint()}`);
  }
  return tunnelId;
}

function openAiTunnelApiKeyHint(): string {
  return "PowerShell: $env:CONTROL_PLANE_API_KEY = \"sk-...\"";
}

async function waitForTunnelStartup(id: string, timeoutMs: number): Promise<TunnelProcessSnapshot | undefined> {
  const deadline = Date.now() + timeoutMs;
  let latest: TunnelProcessSnapshot | undefined;
  while (Date.now() < deadline) {
    latest = listTunnelProcesses().find((tunnel) => tunnel.id === id);
    if (latest?.status === "exited") return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return listTunnelProcesses().find((tunnel) => tunnel.id === id) ?? latest;
}

async function waitForTunnelPublicUrl(id: string, timeoutMs: number): Promise<TunnelProcessSnapshot | undefined> {
  const deadline = Date.now() + timeoutMs;
  let latest: TunnelProcessSnapshot | undefined;
  while (Date.now() < deadline) {
    latest = listTunnelProcesses().find((tunnel) => tunnel.id === id);
    if (latest?.publicUrl) return latest;
    if (latest?.status === "exited") return latest;
    if (latest?.provider === "tailscale" && Date.now() - new Date(latest.startedAt).getTime() > 500) {
      const refreshed = refreshTunnelPublicUrl(latest.id);
      if (refreshed?.publicUrl) return refreshed;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return listTunnelProcesses().find((tunnel) => tunnel.id === id) ?? latest;
}

function assertExposeAuthConfigured(config: LocalPortConfig, command: string): void {
  if (config.ownerToken) return;
  throw new Error(
    `Refusing to expose Computer Linker without an owner token. Run \`${invocationCommand("init")}\` or set COMPUTER_LINKER_OWNER_TOKEN before using \`${command}\`.`,
  );
}

function printHttpAuthHint(tunnelProvider?: TunnelProviderName): void {
  const config = loadConfig();
  if (!config.ownerToken) {
    console.log("HTTP auth: local loopback only because ownerToken is not configured.");
    console.log(`Run \`${invocationCommand("init")}\` or set COMPUTER_LINKER_OWNER_TOKEN before exposing this server.`);
    return;
  }

  if (tunnelProvider === "openai") {
    console.log("HTTP auth: OpenAI tunnel-client forwards the owner token to the local MCP server.");
    console.log("ChatGPT Tunnel mode: select or paste the tunnel id; do not paste a bearer token into ChatGPT.");
    console.log(`Show token for local debugging only: ${invocationCommand("profile", "--show-token")}`);
    return;
  }

  console.log("OAuth: enabled. MCP clients can discover OAuth metadata from the public base URL.");
  console.log("HTTP auth: send this header from your MCP client:");
  console.log("Authorization: Bearer <ownerToken>");
  console.log(`Show token on a trusted local setup screen: ${invocationCommand("profile", "--show-token")}`);
}

function init(args: string[] = []): void {
  if (hasHelpFlag(args)) {
    printInitHelp();
    return;
  }
  const unknown = args.filter((arg) => arg !== "--show-token");
  if (unknown.length > 0) {
    throw new Error(`Unknown init option: ${unknown[0]}`);
  }
  const showToken = args.includes("--show-token");
  const path = configPath();
  if (existsSync(path)) {
    const config = loadConfig();
    if (!config.ownerToken) {
      const ownerToken = generateOwnerToken();
      writeConfig({
        ...config,
        ownerToken,
      });
      console.log(`Updated Computer Linker config with owner token: ${path}`);
      printOwnerTokenSetup(ownerToken, showToken, true);
      return;
    }
    console.log(`Computer Linker config already exists: ${path}`);
    printOwnerTokenSetup(config.ownerToken, showToken, false);
    return;
  }

  const createdPath = writeDefaultConfig();
  const config = JSON.parse(readFileSync(createdPath, "utf8")) as { ownerToken?: string };
  console.log(`Created Computer Linker config: ${createdPath}`);
  if (config.ownerToken) {
    printOwnerTokenSetup(config.ownerToken, showToken, true);
  }
}

function printOwnerTokenSetup(ownerToken: string, showToken: boolean, created: boolean): void {
  console.log(`ownerToken: ${created ? "created" : "configured"}`);
  console.log(`authHeader: Authorization: Bearer ${showToken ? ownerToken : "<ownerToken>"}`);
  if (showToken) {
    console.log(`ownerTokenValue: ${ownerToken}`);
  } else {
    console.log(`showToken: ${invocationCommand("profile", "--show-token")}`);
  }
}

type QuickstartOptions = {
  workspacePath?: string;
  publicBaseUrl?: string;
  tunnelProvider?: TunnelProviderName;
  openaiTunnelId?: string;
  dev: boolean;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen: boolean;
  readOnly: boolean;
  json: boolean;
};

type QuickstartReport = {
  kind: "computer-linker-quickstart";
  schemaVersion: 1;
  commandPrefix: string;
  workspacePath: string | null;
  placeholderWorkspacePath: string;
  permissions: {
    write: boolean;
    shell: boolean;
    codex: boolean;
    screen: boolean;
  };
  tunnel: {
    provider: TunnelProviderName | null;
    publicBaseUrl: string | null;
    openaiTunnelId: string | null;
  };
  commands: {
    selfTest: string;
    start: string;
    status: string;
    token: string;
    clientSetup: string;
    localSmoke: string;
    tunnelStatus?: string;
    historyConnections?: string;
  };
  connection: {
    localMcpUrl: string;
    mcpUrl: string;
    authHeader: string;
  };
  prerequisites: string[];
  terminalHint: string;
  nextActions: string[];
};

function quickstart(args: string[] = []): void {
  if (hasHelpFlag(args)) {
    printQuickstartHelp();
    return;
  }
  const options = parseQuickstartOptions(args);
  const report = buildQuickstartReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printQuickstartReport(report);
}

function parseQuickstartOptions(args: string[]): QuickstartOptions {
  const valueOptions = new Set(["--tunnel", "--tunnel-id", "--url"]);
  const flagOptions = new Set(["--dev", "--coding", "--full-trust", "--read-only", "--write", "--shell", "--codex", "--screen", "--json"]);
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (valueOptions.has(arg)) {
      index += 1;
      if (!args[index] || args[index].startsWith("--")) throw new Error(`quickstart ${arg} requires a value`);
      continue;
    }
    if (flagOptions.has(arg)) continue;
    throw new Error(`Unknown quickstart option: ${arg}`);
  }

  if (positional.length > 1) {
    throw new Error("Usage: computer-linker quickstart [workspace-path] [--tunnel cloudflare|tailscale|openai] [--tunnel-id tunnel_...] [--url https://...] [--dev|--coding|--read-only|--full-trust] [--write] [--shell] [--codex] [--screen] [--json]");
  }

  const tunnelOption = readOptionalStringOption(args, "--tunnel", "quickstart --tunnel");
  const tunnelProvider = tunnelOption ? parseTunnelProvider(tunnelOption, "quickstart --tunnel") : undefined;
  const openaiTunnelId = readOptionalStringOption(args, "--tunnel-id", "quickstart --tunnel-id");
  const publicBaseUrl = args.includes("--url")
    ? requireHttpsUrl(readOptionalStringOption(args, "--url", "quickstart --url"), "quickstart --url", "computer-linker quickstart [workspace-path] --url <https-url>")
    : undefined;

  if (openaiTunnelId && tunnelProvider !== "openai") {
    throw new Error("quickstart --tunnel-id is only valid with --tunnel openai");
  }
  if (publicBaseUrl && tunnelProvider === "openai") {
    throw new Error("quickstart --url is not used with --tunnel openai");
  }
  const permissionFlags = permissionPresetFlags(args, "quickstart");

  return {
    workspacePath: positional[0],
    publicBaseUrl,
    tunnelProvider,
    openaiTunnelId,
    dev: permissionFlags.dev,
    write: permissionFlags.write,
    shell: permissionFlags.shell,
    codex: permissionFlags.codex,
    screen: permissionFlags.screen,
    readOnly: permissionFlags.readOnly,
    json: args.includes("--json"),
  };
}

function buildQuickstartReport(options: QuickstartOptions): QuickstartReport {
  const placeholderWorkspacePath = process.platform === "win32" ? "C:\\Projects\\my-app" : "~/work/my-app";
  const workspacePath = options.workspacePath ?? placeholderWorkspacePath;
  const localMcpUrl = "http://127.0.0.1:3939/mcp";
  const commandParts = quickstartCommandParts();
  const commandPrefix = formatCliCommand(commandParts);
  const startParts = [...commandParts, "start", workspacePath];
  if (options.publicBaseUrl) startParts.push("--url", options.publicBaseUrl);
  if (options.dev) {
    startParts.push("--dev");
  } else {
    if (options.write) startParts.push("--write");
    if (options.shell) startParts.push("--shell");
  }
  if (options.codex) startParts.push("--codex");
  if (options.screen) startParts.push("--screen");
  if (options.tunnelProvider) startParts.push("--tunnel", options.tunnelProvider);
  if (options.tunnelProvider === "openai") startParts.push("--tunnel-id", options.openaiTunnelId ?? "tunnel_...");

  const tunnelStatus = options.tunnelProvider ? formatCliCommand([...commandParts, "tunnel", "status"]) : undefined;
  const historyConnections = options.tunnelProvider ? formatCliCommand([...commandParts, "history", "--view", "connections"]) : undefined;
  const mcpUrl = options.publicBaseUrl
    ? `${options.publicBaseUrl}/mcp`
    : options.tunnelProvider === "openai"
      ? `OpenAI tunnel ${options.openaiTunnelId ?? "tunnel_..."} uses the local MCP target ${localMcpUrl}`
      : options.tunnelProvider
        ? "Use the public tunnel URL printed by start, plus /mcp"
        : localMcpUrl;

  const nextActions = [
    "Run the start command and keep it open while the MCP client is connected.",
    "Use the startup check printed by start as the first readiness signal.",
    "Run client setup --show-token only on a trusted local screen when configuring client auth.",
    "Use client setup --details when the MCP client or agent needs full setup instructions.",
    "Use self-test only when you want an isolated install check.",
  ];
  if (options.tunnelProvider) {
    nextActions.push("Use tunnel status and connection history to confirm traffic reaches /mcp only.");
  }

  return {
    kind: "computer-linker-quickstart",
    schemaVersion: 1,
    commandPrefix,
    workspacePath: options.workspacePath ?? null,
    placeholderWorkspacePath,
    permissions: {
      write: options.write,
      shell: options.shell,
      codex: options.codex,
      screen: options.screen,
    },
    tunnel: {
      provider: options.tunnelProvider ?? null,
      publicBaseUrl: options.publicBaseUrl ?? null,
      openaiTunnelId: options.tunnelProvider === "openai" ? options.openaiTunnelId ?? "tunnel_..." : null,
    },
    commands: {
      selfTest: formatCliCommand([...commandParts, "self-test"]),
      start: formatCliCommand(startParts),
      status: formatCliCommand([...commandParts, "status"]),
      token: formatCliCommand([...commandParts, "client", "setup", "--show-token"]),
      clientSetup: formatCliCommand([...commandParts, "client", "setup"]),
      localSmoke: formatCliCommand([...commandParts, "client", "smoke", "--allow-http", "--url", localMcpUrl]),
      ...(tunnelStatus ? { tunnelStatus } : {}),
      ...(historyConnections ? { historyConnections } : {}),
    },
    connection: {
      localMcpUrl,
      mcpUrl,
      authHeader: "Authorization: Bearer <ownerToken>",
    },
    prerequisites: options.tunnelProvider === "openai"
      ? [
          "OpenAI Secure MCP Tunnel requires CONTROL_PLANE_API_KEY or OPENAI_API_KEY with Tunnels Read+Use permissions.",
          openAiTunnelApiKeyHint(),
        ]
      : [],
    terminalHint: "Keep the start command running. Run client setup and verify commands in another terminal.",
    nextActions,
  };
}

function printQuickstartReport(report: QuickstartReport): void {
  console.log("Computer Linker quickstart");
  console.log("");
  if (!report.workspacePath) {
    console.log(`workspace path: not provided; example uses ${report.placeholderWorkspacePath}`);
  } else {
    console.log(`workspace path: ${report.workspacePath}`);
  }
  console.log("");
  console.log("1. Start Computer Linker:");
  if (report.prerequisites.length > 0) {
    console.log(`   Prerequisite: ${report.prerequisites[0]}`);
    for (const prerequisite of report.prerequisites.slice(1)) {
      console.log(`                 ${prerequisite}`);
    }
  }
  console.log(`   ${report.commands.start}`);
  console.log(`   ${report.terminalHint}`);
  console.log("2. Configure MCP client:");
  console.log(`   MCP URL: ${report.connection.mcpUrl}`);
  if (report.tunnel.provider === "openai") {
    console.log("   Auth: handled by OpenAI tunnel-client; do not paste a bearer token into ChatGPT Tunnel mode.");
    console.log(`   ChatGPT connector: choose Tunnel and select or paste ${report.tunnel.openaiTunnelId ?? "tunnel_..."}.`);
  } else {
    console.log(`   Auth: ${report.connection.authHeader}`);
    console.log(`   Token: ${report.commands.token}`);
  }
  console.log(`   Agent instructions: ${report.commands.clientSetup}`);
  console.log("3. Verify:");
  console.log(`   ${report.commands.status}`);
  console.log(`   ${report.commands.localSmoke}`);
  if (report.commands.tunnelStatus) console.log(`   ${report.commands.tunnelStatus}`);
  if (report.commands.historyConnections) console.log(`   ${report.commands.historyConnections}`);
  console.log(`   optional isolated install check: ${report.commands.selfTest}`);
}

function quickstartCommandParts(): string[] {
  return invocationCommandParts();
}

function invocationCommand(...args: string[]): string {
  return formatCliCommand([...invocationCommandParts(), ...args]);
}

function invocationCommandParts(): string[] {
  if (isNpmDevCliInvocation()) {
    return ["npm", "run", "dev", "--"];
  }
  const scriptArg = process.argv[1];
  const invokedPath = scriptArg ? resolve(scriptArg) : "";
  const checkoutDistCliPath = resolve(process.cwd(), "dist", "cli.js");
  const normalizedInvokedPath = invokedPath.replaceAll("\\", "/").toLowerCase();
  if (
    normalizedInvokedPath.endsWith("/dist/cli.js") &&
    !isInstalledPackageCliPath(normalizedInvokedPath)
  ) {
    if (invokedPath === checkoutDistCliPath) {
      return ["node", process.platform === "win32" ? "dist\\cli.js" : "dist/cli.js"];
    }
    return ["node", invokedPath];
  }
  return ["computer-linker"];
}

function isInstalledPackageCliPath(normalizedInvokedPath: string): boolean {
  return /\/node_modules\/(?:@[^/]+\/)?computer-linker\/dist\/cli\.js$/.test(normalizedInvokedPath);
}

function isNpmDevCliInvocation(): boolean {
  return (
    process.env.npm_lifecycle_event === "dev" &&
    typeof process.env.npm_lifecycle_script === "string" &&
    /\btsx(?:\s+|$)/.test(process.env.npm_lifecycle_script) &&
    /src[\\/]+cli\.ts\b/.test(process.env.npm_lifecycle_script)
  );
}

function formatCliCommand(parts: string[]): string {
  return parts.map((part) => quoteCliPart(part)).join(" ");
}

function quoteCliPart(part: string): string {
  if (part === "") return "\"\"";
  if (process.platform === "win32") {
    if (!/[\s"&|<>^()%!:\\/]/.test(part)) return part;
    return `"${part.replaceAll("\"", "\"\"")}"`;
  }
  if (!/[\s"'\\$`!&|;<>(){}[\]*?]/.test(part)) return part;
  return `'${part.replaceAll("'", "'\\''")}'`;
}

function printHelp(args: string[] = []): void {
  if (args.length === 0) {
    printCoreHelp();
    return;
  }
  const [topic, ...rest] = args;
  if ((topic === "advanced" || topic === "all" || topic === "--advanced") && rest.length === 0) {
    printAdvancedHelp();
    return;
  }
  if (topic === "init" && rest.length === 0) {
    printInitHelp();
    return;
  }
  if (topic === "serve" && rest.length === 0) {
    printServeHelp();
    return;
  }
  if ((topic === "chatgpt" || topic === "client-chatgpt") && rest.length === 0) {
    printChatGptHelp();
    return;
  }
  if (topic === "client") {
    printClientHelpTopic(rest);
    return;
  }
  if (topic === "profile" && rest.length === 0) {
    printProfileHelp();
    return;
  }
  if (topic === "setup") {
    printSetupHelpTopic(rest);
    return;
  }
  if (topic === "expose") {
    printExposeHelpTopic(rest);
    return;
  }
  if (topic === "start" && rest.length === 0) {
    printStartHelp();
    return;
  }
  if (topic === "quickstart" && rest.length === 0) {
    printQuickstartHelp();
    return;
  }
  if (topic === "status" && rest.length === 0) {
    printStatusHelp();
    return;
  }
  if ((topic === "self-test" || topic === "selftest") && rest.length === 0) {
    printSelfTestHelp();
    return;
  }
  if (topic === "doctor" && rest.length === 0) {
    printDoctorHelp();
    return;
  }
  if (topic === "diagnose" && rest.length === 0) {
    printDiagnoseHelp();
    return;
  }
  if (topic === "history" && rest.length === 0) {
    printHistoryHelp();
    return;
  }
  if (topic === "config") {
    printConfigHelpTopic(rest);
    return;
  }
  if (topic === "tunnel") {
    printTunnelHelpTopic(rest);
    return;
  }
  if (topic === "service") {
    printServiceHelpTopic(rest);
    return;
  }
  if (topic === "workspace") {
    printWorkspaceHelpTopic(rest);
    return;
  }
  throw new Error(`Unknown help topic: ${topic}`);
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printVersion(): void {
  console.log(`computer-linker ${workspaceLinkerVersion()}`);
}

function printCliHelp(lines: string[]): void {
  console.log(formatCliHelp(lines.join("\n")));
}

function formatCliHelp(text: string): string {
  if (!isNpmDevCliInvocation()) return text;
  return text
    .replace(/\bcomputer-linker\b/g, "npm run dev --")
    .replace(/npm run dev -- --version/g, "npm run dev -- version");
}

function printInitHelp(): void {
  printCliHelp(
    [
      "Computer Linker init",
      "",
      "Usage:",
      "  computer-linker init [--show-token]",
      "",
      "What it does:",
      "  Creates the local config and owner token if they do not exist.",
      "  Use --show-token only on a trusted local setup screen.",
      "",
      "Example:",
      "  computer-linker init",
    ],
  );
}

function printServeHelp(): void {
  printCliHelp(
    [
      "Computer Linker serve",
      "",
      "Usage:",
      "  computer-linker serve",
      "  computer-linker serve --transport http",
      "  computer-linker serve --transport stdio",
      "",
      "What it does:",
      "  Starts the MCP server without changing workspace config.",
      "  For daily use, prefer `computer-linker start <folder>` so setup and server start happen together.",
    ],
  );
}

function printCoreHelp(): void {
  printCliHelp(
    [
      "Computer Linker",
      "",
      "Usage:",
      "  computer-linker start <workspace-path> --dev",
      "  computer-linker start <workspace-path> --dev --tunnel openai|tailscale|cloudflare",
      "  computer-linker client setup",
      "  computer-linker status",
      "  computer-linker help advanced",
      "",
      "First run:",
      "  1. Start local: computer-linker start C:\\Projects\\my-app --dev",
      "  2. Connect client: computer-linker client setup",
      "  3. Check state: computer-linker status",
      "",
      "Cloud client:",
      "  computer-linker start C:\\Projects\\my-app --dev --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start C:\\Projects\\my-app --dev --tunnel tailscale",
      "  computer-linker start C:\\Projects\\my-app --dev --tunnel cloudflare",
      "",
      "Before changing config:",
      "  computer-linker quickstart C:\\Projects\\my-app --dev",
      "",
      "Notes:",
      "  <workspace-path> is the folder to expose.",
      "  start creates config, token, and a workspace entry when needed, then runs a local startup check.",
      "  Workspace names default to the folder name.",
      "  --dev allows file edits and approved project commands for normal development work.",
      "  Tokens stay hidden by default; use client setup --show-token only on a trusted local setup screen.",
      "  Details: computer-linker help start | computer-linker help client setup | computer-linker help advanced",
    ],
  );
}

function printStartHelp(): void {
  printCliHelp(
    [
      "Computer Linker start",
      "",
      "Usage:",
      "  computer-linker start <workspace-path> [--dev] [--codex] [--screen]",
      "  computer-linker start <workspace-path> --dev --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start <workspace-path> --dev --tunnel tailscale",
      "  computer-linker start <workspace-path> --dev --tunnel cloudflare",
      "  computer-linker start",
      "",
      "What it does:",
      "  Creates config, owner token, and a workspace entry when needed.",
      "  Uses the folder name as the workspace name unless --name is provided.",
      "  Starts the local HTTP MCP server, runs a local startup check, and keeps running until you stop it.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --coding       Alias for --dev: writes and approved project commands.",
      "  --full-trust   Writes, approved commands, Codex operations, and screen capture.",
      "  --dev          Development preset: allow writes and approved project commands.",
      "  --write        Allow file edits in this workspace.",
      "  --shell        Allow approved local commands and package scripts.",
      "  --codex        Allow Codex operations in this workspace.",
      "  --screen       Allow screen capture operations.",
      "  --tunnel openai|tailscale|cloudflare",
      "  --show-token   Print the owner token on this trusted local screen.",
      "  OpenAI tunnel requires CONTROL_PLANE_API_KEY or OPENAI_API_KEY with Tunnels Read+Use permissions.",
      "",
      "Examples:",
      "  computer-linker start C:\\Projects\\my-app --dev",
      "  computer-linker start C:\\Projects\\my-app --dev --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start C:\\Projects\\my-app --dev --tunnel tailscale",
    ],
  );
}

function printQuickstartHelp(): void {
  printCliHelp(
    [
      "Computer Linker quickstart",
      "",
      "Usage:",
      "  computer-linker quickstart [workspace-path] [--dev]",
      "  computer-linker quickstart [workspace-path] --dev --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker quickstart [workspace-path] --dev --tunnel tailscale",
      "  computer-linker quickstart [workspace-path] --dev --tunnel cloudflare",
      "",
      "What it does:",
      "  Prints the exact commands to test, start, configure, and verify Computer Linker.",
      "  Does not read or write config.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --coding       Alias for --dev: include write and shell permission.",
      "  --full-trust   Include write, shell, Codex, and screen permission.",
      "  --dev          Development preset: include write and shell permission.",
      "  --write        Include write permission in the generated start command.",
      "  --shell        Include shell/package command permission in the generated start command.",
      "  --codex        Include Codex permission in the generated start command.",
      "  --screen       Include screen capture permission in the generated start command.",
      "  --json         Print the quickstart plan as JSON.",
      "",
      "Examples:",
      "  computer-linker quickstart C:\\Projects\\my-app --dev",
      "  computer-linker quickstart C:\\Projects\\my-app --dev --tunnel openai --tunnel-id tunnel_...",
    ],
  );
}

function printProfileHelp(): void {
  printCliHelp(
    [
      "Computer Linker profile",
      "",
      "Usage:",
      "  computer-linker profile [--show-token]",
      "",
      "What it does:",
      "  Prints MCP connection profile JSON for local setup screens and clients.",
      "  Tokens are redacted unless --show-token is passed on a trusted local screen.",
      "",
      "Example:",
      "  computer-linker profile",
    ],
  );
}

function printClientHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic) {
    printClientHelp();
    return;
  }
  if (topic === "setup" && rest.length === 0) {
    printClientSetupHelp();
    return;
  }
  if (topic === "smoke" && rest.length === 0) {
    printClientSmokeHelp();
    return;
  }
  if (topic === "diagnose" && rest.length === 0) {
    printClientDiagnoseHelp();
    return;
  }
  if (topic === "chatgpt" && rest.length === 0) {
    printChatGptHelp();
    return;
  }
  throw new Error(`Unknown client help topic: ${args.join(" ")}`);
}

function printClientHelp(): void {
  printCliHelp(
    [
      "Computer Linker client",
      "",
      "Usage:",
      "  computer-linker client setup [--details] [--show-token] [--json]",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json]",
      "  computer-linker client diagnose [--local|--remote|--url https://.../mcp] [--json]",
      "  computer-linker client chatgpt <subcommand>",
      "",
      "What it does:",
      "  Prints generic MCP client setup details and runs connection smoke tests.",
      "  ChatGPT-specific exports are compatibility helpers; prefer generic setup first.",
      "",
      "More help:",
      "  computer-linker client help setup",
      "  computer-linker client help smoke",
      "  computer-linker client help diagnose",
    ],
  );
}

function printClientSetupHelp(): void {
  printCliHelp(
    [
      "Computer Linker client setup",
      "",
      "Usage:",
      "  computer-linker client setup [--details] [--show-token] [--json]",
      "",
      "What it does:",
      "  Prints a short MCP client connection summary by default.",
      "  Use --details for tool names, first prompt, and copy-pasteable agent instructions.",
      "  Use --show-token only on a trusted local setup screen when the client needs a bearer token.",
      "",
      "Examples:",
      "  computer-linker client setup",
      "  computer-linker client setup --details",
      "  computer-linker client setup --show-token",
    ],
  );
}

function printClientSmokeHelp(): void {
  printCliHelp(
    [
      "Computer Linker client smoke",
      "",
      "Usage:",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Runs a small MCP client smoke test against the configured or provided MCP URL.",
      "  Use --allow-http only for trusted local loopback tests.",
      "",
      "Example:",
      "  computer-linker client smoke --allow-http --url http://127.0.0.1:3939/mcp",
    ],
  );
}

function printClientDiagnoseHelp(): void {
  printCliHelp(
    [
      "Computer Linker client diagnose",
      "",
      "Usage:",
      "  computer-linker client diagnose [--local|--remote|--url https://.../mcp] [--json] [--timeout-ms ms]",
      "  computer-linker diagnose client [--local|--remote|--url https://.../mcp] [--json] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Runs MCP client setup checks, a minimal MCP client smoke test, and redacted connection-history inspection.",
      "  Defaults to local loopback. Use --remote for the configured public URL or --url for one explicit endpoint.",
      "",
      "Examples:",
      "  computer-linker diagnose client",
      "  computer-linker diagnose client --remote",
      "  computer-linker diagnose client --url https://example.com/mcp",
    ],
  );
}

function printDiagnoseHelp(): void {
  printClientDiagnoseHelp();
}

function printSetupHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "mcp-only" || topic === "cloudflare-mcp") {
    if (rest.length > 0) throw new Error(`Unknown setup help topic: ${args.join(" ")}`);
    printSetupHelp();
    return;
  }
  throw new Error(`Unknown setup help topic: ${args.join(" ")}`);
}

function printSetupHelp(): void {
  printCliHelp(
    [
      "Computer Linker setup",
      "",
      "Usage:",
      "  computer-linker setup <workspace-path> [--dev|--coding|--read-only|--full-trust]",
      "  computer-linker setup <workspace-path> --dev --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker setup <workspace-path> --dev --tunnel tailscale",
      "  computer-linker setup <workspace-path> --dev --tunnel cloudflare",
      "",
      "What it does:",
      "  Creates or updates config, owner token, public MCP-only mode, and one workspace entry without starting the server.",
      "  Workspace names default to the folder name.",
      "  For one-command daily use, prefer `computer-linker start <workspace-path>`.",
      "  Use --read-only, --coding, or --full-trust when you want explicit permission presets.",
      "",
      "Example:",
      "  computer-linker setup C:\\Projects\\my-app --dev",
    ],
  );
}

function printExposeHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic) {
    printExposeHelp();
    return;
  }
  if ((topic === "tailscale" || topic === "cloudflare") && rest.length === 0) {
    printExposeProviderHelp(topic);
    return;
  }
  throw new Error(`Unknown expose help topic: ${args.join(" ")}`);
}

function printExposeHelp(): void {
  console.log(
    [
      "Computer Linker expose",
      "",
      "Usage:",
      "  computer-linker expose tailscale [--mode funnel]",
      "  computer-linker expose cloudflare",
      "",
      "What it does:",
      "  Starts an HTTP MCP server and opens a tunnel to it.",
      "  `start <workspace-path> --dev --tunnel ...` is the simpler development path.",
      "",
      "More help:",
      "  computer-linker expose help tailscale",
      "  computer-linker expose help cloudflare",
    ].join("\n"),
  );
}

function printExposeProviderHelp(provider: string): void {
  console.log(
    [
      `Computer Linker expose ${provider}`,
      "",
      "Usage:",
      provider === "tailscale"
        ? "  computer-linker expose tailscale [--mode funnel]"
        : "  computer-linker expose cloudflare",
      "",
      "What it does:",
      provider === "tailscale"
        ? "  Opens a Tailscale Funnel tunnel to the local HTTP MCP server."
        : "  Opens a Cloudflare tunnel to the local HTTP MCP server.",
      "  Public host requests are restricted to the MCP endpoint by Computer Linker.",
    ].join("\n"),
  );
}

function printStatusHelp(): void {
  console.log(
    [
      "Computer Linker status",
      "",
      "Usage:",
      "  computer-linker status [--details] [--json]",
      "",
      "What it does:",
      "  Prints the daily readiness summary: connection mode, local MCP URL, workspace/tunnel counts, and the next few actions.",
      "  Use --details for warnings, workspace rows, running tunnel rows, and all next actions.",
      "",
      "Example:",
      "  computer-linker status",
    ].join("\n"),
  );
}

function printSelfTestHelp(): void {
  console.log(
    [
      "Computer Linker self-test",
      "",
      "Usage:",
      "  computer-linker self-test [--json] [--keep-temp] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Starts a temporary local MCP server, runs a safe client smoke test, then cleans up.",
      "  It does not use your configured workspaces unless --keep-temp leaves the temporary files for inspection.",
      "",
      "Example:",
      "  computer-linker self-test",
    ].join("\n"),
  );
}

function printDoctorHelp(): void {
  console.log(
    [
      "Computer Linker doctor",
      "",
      "Usage:",
      "  computer-linker doctor [--json]",
      "  computer-linker doctor --fix [--dry-run] [--json]",
      "",
      "What it does:",
      "  Checks config, auth, tunnel tools, local tools, startup readiness, and release readiness.",
      "  --fix applies low-risk config repairs, such as removing exact duplicate scopes and filling execution policy defaults.",
      "",
      "Examples:",
      "  computer-linker doctor",
      "  computer-linker doctor --fix --dry-run",
    ].join("\n"),
  );
}

function printHistoryHelp(): void {
  console.log(
    [
      "Computer Linker history",
      "",
      "Usage:",
      "  computer-linker history [--view summary|last|timeline|sessions|connections|failed_replay|debug_bundle] [--workspace id] [--query text] [--limit n] [--json] [--output file]",
      "",
      "What it does:",
      "  Reads redacted local operation history for troubleshooting MCP client behavior.",
      "",
      "Examples:",
      "  computer-linker history --view last",
      "  computer-linker history --view connections",
    ].join("\n"),
  );
}

function printConfigHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "path") {
    if (rest.length > 0) throw new Error(`Unknown config help topic: ${args.join(" ")}`);
    printConfigHelp();
    return;
  }
  if (topic === "show" && rest.length === 0) {
    printConfigShowHelp();
    return;
  }
  if (topic === "validate" && rest.length === 0) {
    printConfigValidateHelp();
    return;
  }
  if (topic === "token" && rest.length === 0) {
    printConfigTokenHelp();
    return;
  }
  if (topic === "policy" && rest.length === 0) {
    printConfigPolicyHelp();
    return;
  }
  if ((topic === "set-public-url" || topic === "set-public-base-url") && rest.length === 0) {
    printConfigPublicUrlHelp();
    return;
  }
  if ((topic === "clear-public-url" || topic === "clear-public-base-url") && rest.length === 0) {
    printConfigClearPublicUrlHelp();
    return;
  }
  throw new Error(`Unknown config help topic: ${args.join(" ")}`);
}

function printConfigHelp(): void {
  console.log(
    [
      "Computer Linker config",
      "",
      "Usage:",
      "  computer-linker config path",
      "  computer-linker config show [--show-token]",
      "  computer-linker config validate [--json]",
      "  computer-linker config token [rotate] [--show-token] [--json]",
      "  computer-linker config policy <workspace-id> [--json] [--allow pattern] [--deny pattern]",
      "  computer-linker config set-public-url <https-url>",
      "  computer-linker config clear-public-url",
      "",
      "What it does:",
      "  Inspects and updates the local Computer Linker config file.",
      "  Tokens are redacted unless --show-token is explicitly passed on a trusted local screen.",
      "",
      "More help:",
      "  computer-linker config help token",
      "  computer-linker config help policy",
    ].join("\n"),
  );
}

function printConfigShowHelp(): void {
  console.log(
    [
      "Computer Linker config show",
      "",
      "Usage:",
      "  computer-linker config show [--show-token]",
      "",
      "What it does:",
      "  Prints the local config as JSON. The owner token is redacted unless --show-token is passed.",
    ].join("\n"),
  );
}

function printConfigValidateHelp(): void {
  console.log(
    [
      "Computer Linker config validate",
      "",
      "Usage:",
      "  computer-linker config validate [--json]",
      "",
      "What it does:",
      "  Checks config and security diagnostics without modifying the config.",
    ].join("\n"),
  );
}

function printConfigTokenHelp(): void {
  console.log(
    [
      "Computer Linker config token",
      "",
      "Usage:",
      "  computer-linker config token [rotate] [--show-token] [--json]",
      "",
      "What it does:",
      "  Shows token status or rotates the owner token.",
      "  Use --show-token only on a trusted local setup screen.",
    ].join("\n"),
  );
}

function printConfigPolicyHelp(): void {
  console.log(
    [
      "Computer Linker config policy",
      "",
      "Usage:",
      "  computer-linker config policy <workspace-id> [--json]",
      "  computer-linker config policy <workspace-id> [--allow pattern] [--deny pattern] [--max-runtime-seconds n] [--max-output-bytes n]",
      "",
      "What it does:",
      "  Reads or updates command policy for shell/Codex-enabled workspaces.",
    ].join("\n"),
  );
}

function printConfigPublicUrlHelp(): void {
  console.log(
    [
      "Computer Linker config set-public-url",
      "",
      "Usage:",
      "  computer-linker config set-public-url <https-url>",
      "",
      "What it does:",
      "  Stores the public HTTPS base URL used by URL-based remote MCP clients.",
    ].join("\n"),
  );
}

function printConfigClearPublicUrlHelp(): void {
  console.log(
    [
      "Computer Linker config clear-public-url",
      "",
      "Usage:",
      "  computer-linker config clear-public-url",
      "",
      "What it does:",
      "  Removes the configured public base URL. This does not stop any running tunnel.",
    ].join("\n"),
  );
}

function printTunnelHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "status") {
    if (rest.length > 0) throw new Error(`Unknown tunnel help topic: ${args.join(" ")}`);
    printTunnelHelp();
    return;
  }
  throw new Error(`Unknown tunnel help topic: ${args.join(" ")}`);
}

function printTunnelHelp(): void {
  console.log(
    [
      "Computer Linker tunnel",
      "",
      "Usage:",
      "  computer-linker tunnel status [--json]",
      "",
      "What it does:",
      "  Shows detected tunnel tools, running tunnel processes, effective public URL, and suggested commands.",
      "  OpenAI Secure MCP Tunnel mode reports a tunnel id, not a public URL.",
      "",
      "Example:",
      "  computer-linker tunnel status",
    ].join("\n"),
  );
}

function printServiceHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "profile") {
    if (rest.length > 0) throw new Error(`Unknown service help topic: ${args.join(" ")}`);
    printServiceHelp();
    return;
  }
  if (topic === "status" && rest.length === 0) {
    printServiceStatusHelp();
    return;
  }
  if ((topic === "install" || topic === "uninstall") && rest.length === 0) {
    printServiceInstallHelp(topic);
    return;
  }
  if ((topic === "start" || topic === "stop") && rest.length === 0) {
    printServiceControlHelp(topic);
    return;
  }
  if (topic === "logs" && rest.length === 0) {
    printServiceLogsHelp();
    return;
  }
  throw new Error(`Unknown service help topic: ${args.join(" ")}`);
}

function printServiceHelp(): void {
  console.log(
    [
      "Computer Linker service",
      "",
      "Usage:",
      "  computer-linker service profile [--platform linux|macos|windows] [--format profile|manifest]",
      "  computer-linker service profile --output-dir ./service-profile [--platform linux|macos|windows]",
      "  computer-linker service status [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --dry-run [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service uninstall --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service start|stop [--platform linux|macos|windows] [--json]",
      "  computer-linker service logs [--lines 100] [--platform linux|macos|windows] [--json]",
      "",
      "What it does:",
      "  Generates service-manager profiles and controls the local background service.",
      "  Install and uninstall require --yes; use --dry-run to preview without changing the OS.",
      "",
      "More help:",
      "  computer-linker service help status",
      "  computer-linker service help install",
      "  computer-linker service help logs",
    ].join("\n"),
  );
}

function printServiceStatusHelp(): void {
  console.log(
    [
      "Computer Linker service status",
      "",
      "Usage:",
      "  computer-linker service status [--platform linux|macos|windows] [--json]",
      "",
      "What it does:",
      "  Prints service-manager status metadata, daily start/stop commands, and log locations.",
    ].join("\n"),
  );
}

function printServiceInstallHelp(action: string): void {
  console.log(
    [
      `Computer Linker service ${action}`,
      "",
      "Usage:",
      `  computer-linker service ${action} --dry-run [--platform linux|macos|windows] [--json]`,
      `  computer-linker service ${action} --yes [--platform linux|macos|windows] [--json]`,
      "",
      "What it does:",
      `  Prints the ${action} plan with --dry-run, or applies it with --yes.`,
    ].join("\n"),
  );
}

function printServiceControlHelp(action: string): void {
  console.log(
    [
      `Computer Linker service ${action}`,
      "",
      "Usage:",
      `  computer-linker service ${action} [--platform linux|macos|windows] [--json]`,
      `  computer-linker service ${action} --dry-run [--platform linux|macos|windows] [--json]`,
      "",
      "What it does:",
      `  ${action === "start" ? "Starts" : "Stops"} the installed service on the current platform.`,
    ].join("\n"),
  );
}

function printServiceLogsHelp(): void {
  console.log(
    [
      "Computer Linker service logs",
      "",
      "Usage:",
      "  computer-linker service logs [--lines 100] [--platform linux|macos|windows] [--json]",
      "",
      "What it does:",
      "  Reads generated service stdout/stderr logs when available and prints the native log command.",
    ].join("\n"),
  );
}

function printWorkspaceHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "list") {
    if (rest.length > 0) throw new Error(`Unknown workspace help topic: ${args.join(" ")}`);
    printWorkspaceHelp();
    return;
  }
  if (topic === "add" && rest.length === 0) {
    printWorkspaceAddHelp();
    return;
  }
  if (topic === "update" && rest.length === 0) {
    printWorkspaceUpdateHelp();
    return;
  }
  if (topic === "remove" && rest.length === 0) {
    printWorkspaceRemoveHelp();
    return;
  }
  throw new Error(`Unknown workspace help topic: ${args.join(" ")}`);
}

function printWorkspaceHelp(): void {
  console.log(
    [
      "Computer Linker workspace",
      "",
      "Usage:",
      "  computer-linker workspace list",
      "  computer-linker workspace add <path> [--id workspace-id] [--name name] [--dev|--coding|--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]",
      "  computer-linker workspace update <id> [--name name] [--path path] [--dev|--coding|--read-only|--full-trust] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen]",
      "  computer-linker workspace remove <id>",
      "",
      "What it does:",
      "  Manages the local list of folders exposed to MCP clients.",
      "  Use --dev for normal development folders where the agent may edit and run project commands.",
      "  New entries are read-only by default; add --write only when the agent should edit files.",
      "  Workspace names default to the folder name when omitted.",
      "  This does not delete the folder on disk when removing a workspace entry.",
      "",
      "Examples:",
      "  computer-linker workspace add C:\\Projects\\my-app --dev",
      "  computer-linker workspace update my-app --dev",
      "  computer-linker workspace remove my-app",
      "",
      "More help:",
      "  computer-linker workspace help add",
      "  computer-linker workspace help update",
      "  computer-linker workspace help remove",
    ].join("\n"),
  );
}

function printWorkspaceAddHelp(): void {
  console.log(
    [
      "Computer Linker workspace add",
      "",
      "Usage:",
      "  computer-linker workspace add <path> [--id workspace-id] [--name name] [--dev|--coding|--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]",
      "",
      "What it does:",
      "  Adds one folder to the local MCP workspace list.",
      "  If --id is omitted, the id is derived from the folder name.",
      "  If --name is omitted, the workspace name is the folder name.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --coding       Alias for --dev: allow writes and local commands.",
      "  --full-trust   Allow writes, local commands, Codex operations, and screen capture.",
      "  --dev          Development preset: allow writes and local commands.",
      "  --write        Allow file edits in this workspace.",
      "  --shell        Allow local commands and package scripts.",
      "  --codex        Allow Codex operations in this workspace.",
      "  --screen       Allow screen capture operations.",
      "",
      "Example:",
      "  computer-linker workspace add C:\\Projects\\my-app --dev",
    ].join("\n"),
  );
}

function printWorkspaceUpdateHelp(): void {
  console.log(
    [
      "Computer Linker workspace update",
      "",
      "Usage:",
      "  computer-linker workspace update <id> [--name name] [--path path] [--dev|--coding|--read-only|--full-trust] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen]",
      "",
      "What it does:",
      "  Updates an existing workspace entry without changing unrelated entries.",
      "",
      "Examples:",
      "  computer-linker workspace update my-app --dev",
      "  computer-linker workspace update my-app --no-shell",
    ].join("\n"),
  );
}

function printWorkspaceRemoveHelp(): void {
  console.log(
    [
      "Computer Linker workspace remove",
      "",
      "Usage:",
      "  computer-linker workspace remove <id>",
      "",
      "What it does:",
      "  Removes one workspace entry from the local MCP workspace list.",
      "  This does not delete the folder on disk.",
      "",
      "Example:",
      "  computer-linker workspace remove my-app",
    ].join("\n"),
  );
}

function printAdvancedHelp(): void {
  printCliHelp(
    [
      "Computer Linker",
      "",
      "Advanced Usage:",
      "  computer-linker init [--show-token]",
      "  computer-linker --version",
      "  computer-linker quickstart [workspace-path] [--tunnel cloudflare|tailscale|openai] [--tunnel-id tunnel_...] [--url https://...] [--dev] [--write] [--shell] [--codex] [--screen] [--read-only|--coding|--full-trust] [--json]",
      "  computer-linker serve      Start the stdio MCP server",
      "  computer-linker serve --transport http",
      "  computer-linker start [workspace-path] [--dev] [--write] [--shell] [--codex] [--screen] [--read-only|--coding|--full-trust]",
      "                           Configure a workspace when provided, then start the HTTP MCP server",
      "  computer-linker start      Start local HTTP MCP server",
      "  computer-linker start --tunnel cloudflare",
      "  computer-linker start --no-tunnel",
      "  computer-linker start --tunnel tailscale",
      "  computer-linker start --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker status [--details] [--json]",
      "  computer-linker self-test [--json] [--keep-temp] [--timeout-ms ms]",
      "  computer-linker process list <workspace-id> [--json]",
      "  computer-linker process read <workspace-id> <process-id> [--json]",
      "  computer-linker process stop <workspace-id> <process-id> [--signal SIGTERM|SIGINT|SIGKILL] [--json]",
      "  computer-linker screen status [--json]",
      "  computer-linker expose cloudflare",
      "  computer-linker expose tailscale --mode funnel",
      "  computer-linker tunnel status [--json]",
      "  computer-linker service profile [--platform linux|macos|windows] [--format profile|manifest]",
      "  computer-linker service profile --output-dir ./service-profile [--platform linux|macos|windows]",
      "  computer-linker service status [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --dry-run [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service uninstall --dry-run [--platform linux|macos|windows] [--json]",
      "  computer-linker service uninstall --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service start|stop [--platform linux|macos|windows] [--json]",
      "  computer-linker service logs [--lines 100] [--platform linux|macos|windows] [--json]",
      "  computer-linker doctor",
      "  computer-linker doctor --json",
      "  computer-linker doctor --fix [--dry-run] [--json]",
      "  computer-linker diagnose client [--local|--remote|--url https://.../mcp] [--json]",
      "  computer-linker profile [--show-token]",
      "  computer-linker client setup [--details] [--show-token] [--json]",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json]",
      "  computer-linker client diagnose [--local|--remote|--url https://.../mcp] [--json]",
      "  computer-linker setup <workspace-path> [--tunnel cloudflare|tailscale|openai] [--tunnel-id tunnel_...] [--id workspace-id] [--name name] [--dev] [--write] [--shell] [--codex] [--screen] [--read-only|--coding|--full-trust] [--show-token] [--json]",
      "  computer-linker history [--view summary|last|timeline|sessions|connections|failed_replay|debug_bundle] [--workspace id] [--query text] [--limit n] [--json] [--output file]",
      "  computer-linker config path",
      "  computer-linker config show [--show-token]",
      "  computer-linker config validate [--json]",
      "  computer-linker config token [rotate] [--show-token] [--json]",
      "  computer-linker config policy <workspace-id> [--json]",
      "  computer-linker config policy <workspace-id> [--allow pattern] [--deny pattern] [--max-runtime-seconds n] [--max-output-bytes n]",
      "  computer-linker config set-public-url <https-url>",
      "  computer-linker config clear-public-url",
      "  computer-linker workspace list",
      "  computer-linker workspace add <path> [--id workspace-id] [--name name] [--dev] [--write] [--shell] [--codex] [--screen] [--read-only|--coding|--full-trust]",
      "  computer-linker workspace update <id> [--name name] [--path path] [--dev] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen] [--read-only|--coding|--full-trust]",
      "  computer-linker workspace remove <id>",
      "  computer-linker help",
      "  computer-linker help chatgpt",
      "",
      "Client-specific helpers are compatibility exports layered over the generic MCP contract.",
      "Compatibility: LOCALPORT_* env vars and x-localport-token still work for existing configs.",
    ],
  );
}

function printChatGptHelp(): void {
  printCliHelp(
    [
      "Computer Linker ChatGPT Compatibility Helpers",
      "",
      "ChatGPT is one MCP client, not the product axis. Prefer the generic setup commands first:",
      "  computer-linker client setup",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http]",
      "",
      "Use these only when ChatGPT asks for connector-specific fields or files:",
      "  computer-linker client chatgpt url [--show-token] [--json]",
      "  computer-linker client chatgpt smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json]",
      "  computer-linker client chatgpt verify [--mode safe|coding|full] [--json]",
      "  computer-linker client chatgpt profile [--mode safe|coding|full] [--url https://...] [--show-token]",
      "  computer-linker client chatgpt manifest [--mode safe|coding|full] [--url https://...]",
      "  computer-linker client chatgpt connector [--mode safe|coding|full] [--url https://...] [--show-token]",
      "  computer-linker client chatgpt files ./chatgpt-config [--mode safe|coding|full] [--url https://...] [--show-token]",
      "",
      "For OpenAI Secure MCP Tunnel, start with:",
      "  computer-linker start <workspace-path> --dev --tunnel openai --tunnel-id tunnel_...",
    ],
  );
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRepeatedOptions(args: string[], name: string, command: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${command} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function readOptionalStringOption(args: string[], name: string, command: string): string | undefined {
  const value = readOption(args, name);
  if (!args.includes(name)) return undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${command} requires a value`);
  }
  return value;
}

function readOptionalIntegerOption(args: string[], name: string, command: string): number | undefined {
  const value = readOption(args, name);
  if (!args.includes(name)) return undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${command} requires a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${command} requires a positive integer`);
  }
  return parsed;
}

function readChatGptModeOption(args: string[], command: string): ReturnType<typeof parseChatGptProfileMode> {
  const value = readOption(args, "--mode");
  if (args.includes("--mode") && (!value || value.startsWith("--"))) {
    throw new Error(`${command} must be one of: safe, coding, full`);
  }
  return parseChatGptProfileMode(value, command);
}

function readPublicUrlOption(args: string[], command: string): string | undefined {
  if (!args.includes("--url")) return undefined;
  return requireHttpsUrl(readOption(args, "--url"), command, `computer-linker ${command} <https-url>`);
}

function booleanFlag(args: string[], name: string, current: boolean): boolean {
  if (args.includes(`--${name}`)) return true;
  if (args.includes(`--no-${name}`)) return false;
  return current;
}

function requireHttpsUrl(value: string | undefined, name: string, usage = "computer-linker config set-public-url <https-url>"): string {
  if (!value) throw new Error(`Usage: ${usage}`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use https://`);
  }
  return parsed.origin;
}

async function waitForShutdown(close: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
