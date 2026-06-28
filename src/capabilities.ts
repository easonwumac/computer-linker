import { execFileSync } from "node:child_process";
import { arch, cpus, platform, release, totalmem, type } from "node:os";
import { basename } from "node:path";
import { legacyNetworkCapabilitySemantics, workspaceCapabilityPolicy } from "./capability-policy.js";
import { computerOperationContract, publicComputerOperationRegistry } from "./computer-operation-registry.js";
import { configDiagnostics, type ConfigDiagnostic } from "./config-diagnostics.js";
import { auditLogPath, codexRunsPath, loadConfig } from "./config.js";
import { workspaceLinkerVersion } from "./package-metadata.js";
import type { LocalPortConfig } from "./permissions.js";
import { executableCommand, findExecutableCommand, windowsVerbatimArgumentsOption } from "./platform-shell.js";
import { connectionProfile } from "./profile.js";
import { screenshotArtifactStatus, screenshotCapability } from "./screenshot.js";
import { securityDiagnostics } from "./security.js";
import { serviceStatus, type ServiceStatus } from "./service.js";
import { auditRetentionPolicy, codexRunRetentionPolicy, fileStatus, managedProcessRetentionPolicy } from "./retention.js";
import { listTunnelProcesses, tunnelDiagnostics } from "./tunnels.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { exposedMcpTools, mcpToolSurface } from "./mcp-surface.js";
import { compatibilityJsonApiActions, compatibilityJsonApiEndpoints, computerLinkerDiscovery, primaryJsonApiActions, primaryJsonApiEndpoints } from "./discovery-contract.js";
import { allowedWorkspaceOperations, publicWorkspaceOperationRegistry, unavailableWorkspaceOperations, workspaceOperationCatalog, workspaceOperationContract, workspaceOperationNames, workspaceOperationSafety } from "./workspace-operations.js";

export interface CommandCapability {
  name: string;
  category: "agent" | "search" | "runtime" | "package-manager" | "vcs" | "shell" | "container";
  importance: "required" | "recommended" | "optional";
  available: boolean;
  path?: string;
  version?: string;
  usedFor: string[];
  install?: ToolInstallHint;
  error?: string;
}

export interface ToolInstallHint {
  macos?: string;
  linux?: string;
  windows?: string;
  docs?: string;
}

export interface ToolReadiness {
  kind: "computer-linker-tool-readiness";
  schemaVersion: 1;
  ready: boolean;
  requiredMissing: string[];
  recommendedMissing: string[];
  availableRecommended: string[];
  installHints: Array<{
    name: string;
    importance: CommandCapability["importance"];
    usedFor: string[];
    install?: ToolInstallHint;
  }>;
}

export interface StartupReadinessCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
}

export interface StartupReadinessMode {
  id: "here" | "start" | "tunnel-cloudflare" | "tunnel-tailscale" | "tunnel-openai" | "stdio" | "service";
  title: string;
  command: string;
  persistent: boolean;
  useWhen: string;
}

export interface StartupReadiness {
  kind: "computer-linker-startup-readiness";
  schemaVersion: 1;
  ready: boolean;
  platform: string;
  recommendedMode: StartupReadinessMode["id"];
  localMcpUrl: string;
  localApiUrl: string;
  modes: StartupReadinessMode[];
  service: {
    platform: string;
    serviceName: string;
    label: string;
    command: string;
    manifestPath: string;
    manifestExists: boolean | null;
    statusCommands: string[];
    profileCommand: string;
    profileBundleCommand: string;
    installDryRunCommand: string;
    uninstallDryRunCommand: string;
  };
  checks: StartupReadinessCheck[];
  nextActions: string[];
}

export interface ReleaseReadinessCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
}

export interface ReleaseReadiness {
  kind: "computer-linker-release-readiness";
  schemaVersion: 1;
  ready: boolean;
  status: "ready" | "needs_attention" | "blocked";
  checks: ReleaseReadinessCheck[];
  blockingReasons: string[];
  warnings: string[];
  recommendedGate: string;
}

export function getLocalPortCapabilities(): unknown {
  const config = loadConfig();
  const registry = new WorkspaceRegistry(config);
  const localTools = localToolCapabilities();
  const toolReadiness = localToolReadiness(localTools);
  const configFindings = configDiagnostics(config);
  const rawSecurityFindings = securityDiagnostics(config);
  const tunnel = tunnelDiagnostics({
    localPort: config.port ?? 3939,
    publicBaseUrl: config.publicBaseUrl,
    tunnels: listTunnelProcesses(),
  });
  const securityFindings = securityFindingsForTunnelMode(rawSecurityFindings, tunnel);
  const exposure = exposureReadiness(config, tunnel, securityFindings);
  const service = serviceStatus(config);
  const startup = startupReadiness(config, service);
  const maintenance = maintenanceDiagnostics(service);
  const releaseStatus = releaseReadiness(config, {
    toolReadiness,
    startup,
    configFindings,
    securityFindings,
  });
  const activeMcpToolSurface = mcpToolSurface();

  return {
    name: "computer-linker",
    version: workspaceLinkerVersion(),
    machineId: config.machineId,
    machineName: config.machineName,
    auth: {
      ownerTokenConfigured: Boolean(config.ownerToken),
      httpModeWithoutOwnerToken: config.ownerToken ? "owner-token-or-oauth" : "loopback-only",
    },
    machine: {
      id: config.machineId,
      hostname: config.machineName,
      os: type(),
      platform: platform(),
      arch: arch(),
      release: release(),
      nodeVersion: process.version,
      shell: process.env.SHELL ? basename(process.env.SHELL) : undefined,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    connectionProfile: connectionProfile(config, false),
    workspaces: registry.listDefinedWorkspaces().map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      permissions: workspace.permissions,
      policy: workspace.policy ?? {},
      capabilityPolicy: workspaceCapabilityPolicy(workspace.permissions),
      allowedOperations: allowedWorkspaceOperations(workspace.permissions),
      unavailableOperations: unavailableWorkspaceOperations(workspace.permissions),
    })),
    mcpToolSurface: {
      active: activeMcpToolSurface,
      default: "generic",
      compatibilityOptIn: "COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility",
    },
    mcpTools: exposedMcpTools(activeMcpToolSurface),
    jsonApi: {
      basePath: "/api/v1",
      unifiedEndpoint: "POST /control",
      actions: [...primaryJsonApiActions, ...compatibilityJsonApiActions],
      primaryActions: [...primaryJsonApiActions],
      compatibilityActions: [...compatibilityJsonApiActions],
      endpoints: [...new Set([...primaryJsonApiEndpoints, ...compatibilityJsonApiEndpoints])],
      primaryEndpoints: [...primaryJsonApiEndpoints],
      compatibilityEndpoints: [...compatibilityJsonApiEndpoints],
    },
    discovery: computerLinkerDiscovery(),
    clientGuidance: {
      recommendedFlow: ["get_computer_info", "client_setup", "computer_operation", "get_operation_history"],
      preferredControlShape: {
        action: "computer_operation",
        scope: "app",
        op: "file.read",
        target: "README.md",
        input: {},
        options: { maxBytes: 65536 },
      },
      preferredWorkspaceOperationShape: {
        op: "read",
        target: "README.md",
        input: {},
        options: { maxBytes: 65536 },
      },
      examples: [
        { purpose: "Check MCP client setup", control: { action: "client_setup" } },
        { purpose: "Start code orientation", operation: { op: "code.context", target: ".", options: { maxDepth: 2, maxEntries: 100 } } },
        { purpose: "Review recent agent activity", operation: { op: "history.last", options: { maxResults: 50 } } },
        { purpose: "Search code text", operation: { op: "file.search", target: ".", input: { query: "TODO", glob: "*.ts" }, options: { maxResults: 20 } } },
        { purpose: "Read a bounded file", operation: { op: "file.read", target: "README.md", options: { maxBytes: 65536 } } },
        { purpose: "Review current diff", operation: { op: "git.diff", target: ".", options: { maxBytes: 65536 } } },
        { purpose: "Ask Codex for a local review", operation: { op: "codex.run", target: ".", input: { prompt: "Review the current diff and summarize concrete risks." }, options: { timeoutSeconds: 1800 } } },
      ],
      safety: "Use allowedOperations and computerOperationRegistry before selecting write, shell, process, or codex operations. Use operation_registry with contract=workspace only for compatibility clients.",
    },
    toolReadiness,
    configDiagnostics: configDiagnosticsSummary(configFindings),
    releaseReadiness: releaseStatus,
    screenshot: screenshotCapability(),
    exposure,
    startup,
    maintenance,
    workspaceOperations: workspaceOperationNames,
    computerOperationContract,
    computerOperationRegistry: publicComputerOperationRegistry(),
    operationContract: workspaceOperationContract,
    operationCatalog: workspaceOperationCatalog,
    operationSafety: workspaceOperationSafety,
    operationRegistry: publicWorkspaceOperationRegistry(),
    capabilityPolicy: {
      version: 1,
      source: "derived-from-workspace-permissions",
      supportedCapabilities: [
        "fs:read",
        "fs:write",
        "search:read",
        "history:read",
        "git:read",
        "git:write",
        "package:run",
        "process:manage",
        "shell:run",
        "codex:readOnly",
        "codex:write",
        "screen:capture",
        "network:false",
      ],
      networkSemantics: legacyNetworkCapabilitySemantics(),
      guidance: "Use workspace.capabilityPolicy and computerOperationRegistry[].capabilities before selecting package, process, Git write, shell, screen, or Codex operations.",
    },
    codingCapabilities: {
      workspaceBoundary: true,
      fileOperations: true,
      fastSearch: toolAvailable(localTools, "rg"),
      agentSkills: true,
      shellExecution: config.workspaces.some((workspace) => workspace.permissions.shell),
      codexExecution: config.workspaces.some((workspace) => workspace.permissions.codex) && toolAvailable(localTools, "codex"),
      gitWorktrees: config.workspaces.some((workspace) => workspace.permissions.write) && toolAvailable(localTools, "git"),
      tunnelExposure: tunnel.tools.some((tool) => tool.available),
      durableHistory: true,
    },
    localTools,
    security: {
      boundaryModel: {
        workspacePathEnforced: "Computer Linker validates file, search, patch, git, and workspace metadata paths before executing those operations.",
        workspaceCwdOnly: "Shell, long-running process, and Codex operations start in the workspace but are not OS filesystem sandboxes.",
        durableAudit: "Operations are recorded without file contents, write payloads, or token values.",
      },
      findings: securityFindings,
    },
    tunnels: tunnel,
  };
}

export function getLocalPortDoctor(): unknown {
  const config = loadConfig();
  const localTools = localToolCapabilities();
  const toolReadiness = localToolReadiness(localTools);
  const configFindings = configDiagnostics(config);
  const rawSecurityFindings = securityDiagnostics(config);
  const tunnel = tunnelDiagnostics({
    localPort: config.port ?? 3939,
    publicBaseUrl: config.publicBaseUrl,
    tunnels: listTunnelProcesses(),
  });
  const securityFindings = securityFindingsForTunnelMode(rawSecurityFindings, tunnel);
  const exposure = exposureReadiness(config, tunnel, securityFindings);
  const criticalFindings = securityFindings.filter((finding) => finding.severity === "critical");
  const warningFindings = securityFindings.filter((finding) => finding.severity === "warning");
  const service = serviceStatus(config);
  const startup = startupReadiness(config, service);
  const maintenance = maintenanceDiagnostics(service);
  const releaseStatus = releaseReadiness(config, {
    toolReadiness,
    startup,
    configFindings,
    securityFindings,
  });

  return {
    machineId: config.machineId,
    machineName: config.machineName,
    machine: {
      id: config.machineId,
      hostname: config.machineName,
      os: type(),
      platform: platform(),
      arch: arch(),
      release: release(),
      nodeVersion: process.version,
      shell: process.env.SHELL ? basename(process.env.SHELL) : undefined,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    runtime: {
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 3939,
      localMcpUrl: `http://${config.host ?? "127.0.0.1"}:${config.port ?? 3939}/mcp`,
      localApiUrl: `http://${config.host ?? "127.0.0.1"}:${config.port ?? 3939}/api/v1`,
      startCommands: {
        start: "computer-linker start",
        serveHttp: "computer-linker start",
        serveStdio: "computer-linker serve --transport stdio",
      },
    },
    startup,
    readyForTunnel: exposure.readyForTunnel,
    auth: {
      ownerTokenConfigured: Boolean(config.ownerToken),
      mode: exposure.authMode,
      localOnly: exposure.localOnly,
    },
    exposure: {
      publicMcpUrl: config.publicBaseUrl ? new URL("/mcp", config.publicBaseUrl).href : undefined,
      publicBaseUrl: config.publicBaseUrl,
      publicBaseUrlConfigured: exposure.publicBaseUrlConfigured,
      tunnelToolsAvailable: exposure.tunnelToolsAvailable,
      blockingReasons: exposure.blockingReasons,
      warnings: exposure.warnings,
    },
    workspaces: {
      total: config.workspaces.length,
      writable: config.workspaces.filter((workspace) => workspace.permissions.write).length,
      shellEnabled: config.workspaces.filter((workspace) => workspace.permissions.shell).length,
      codexEnabled: config.workspaces.filter((workspace) => workspace.permissions.codex).length,
    },
    security: {
      criticalCount: criticalFindings.length,
      warningCount: warningFindings.length,
      findings: securityFindings,
    },
    configDiagnostics: configDiagnosticsSummary(configFindings),
    releaseReadiness: releaseStatus,
    tunnels: {
      tools: tunnel.tools,
      commands: tunnel.commands,
    },
    service: {
      platform: service.platform,
      serviceName: service.serviceName,
      label: service.label,
      manifestPath: service.manifestPath,
      manifestExists: service.manifestExists,
      command: service.commandDisplay,
      statusCommands: service.statusCommands,
      profileCommand: `computer-linker service profile --platform ${service.platform}`,
      profileBundleCommand: `computer-linker service profile --platform ${service.platform} --output-dir ./service-profile`,
      installDryRunCommand: `computer-linker service install --dry-run --platform ${service.platform}`,
      uninstallDryRunCommand: `computer-linker service uninstall --dry-run --platform ${service.platform}`,
      notes: service.notes,
    },
    maintenance,
    localTools,
    toolReadiness,
    nextActions: uniqueStrings([
      ...doctorNextActions(exposure.blockingReasons, securityFindings, releaseStatus),
      ...maintenanceNextActions(maintenance),
    ]),
  };
}

function maintenanceDiagnostics(service: ServiceStatus): {
  kind: "computer-linker-maintenance";
  schemaVersion: 1;
  audit: ReturnType<typeof fileStatus> & { maxBytes: number; tailReadMaxBytes: number };
  codexRuns: ReturnType<typeof fileStatus> & { maxBytes: number; maxRecords: number; tailReadMaxBytes: number };
  screenshots: ReturnType<typeof screenshotArtifactStatus>;
  serviceLogs: ServiceStatus["logFileStatus"] & { policy: ServiceStatus["logPolicy"] };
  managedProcesses: {
    maxExitedAgeMs: number;
    maxExitedPerWorkspace: number;
  };
} {
  return {
    kind: "computer-linker-maintenance",
    schemaVersion: 1,
    audit: {
      ...fileStatus(auditLogPath(), auditRetentionPolicy.maxBytes),
      maxBytes: auditRetentionPolicy.maxBytes,
      tailReadMaxBytes: auditRetentionPolicy.tailReadMaxBytes,
    },
    codexRuns: {
      ...fileStatus(codexRunsPath(), codexRunRetentionPolicy.maxBytes),
      maxBytes: codexRunRetentionPolicy.maxBytes,
      maxRecords: codexRunRetentionPolicy.maxRecords,
      tailReadMaxBytes: codexRunRetentionPolicy.tailReadMaxBytes,
    },
    screenshots: screenshotArtifactStatus(),
    serviceLogs: {
      ...service.logFileStatus,
      policy: service.logPolicy,
    },
    managedProcesses: {
      maxExitedAgeMs: managedProcessRetentionPolicy.maxExitedAgeMs,
      maxExitedPerWorkspace: managedProcessRetentionPolicy.maxExitedPerWorkspace,
    },
  };
}

function maintenanceNextActions(maintenance: ReturnType<typeof maintenanceDiagnostics>): string[] {
  const actions: string[] = [];
  if (maintenance.audit.oversized) {
    actions.push("Audit history is over the retention threshold; new audit writes compact it automatically, or archive/remove audit.jsonl during maintenance.");
  }
  if (maintenance.codexRuns.oversized) {
    actions.push("Codex run history is over the retention threshold; new Codex workflow writes compact codex-runs.jsonl automatically.");
  }
  if (maintenance.screenshots.staleCount > 0) {
    actions.push("Stale screenshot fileRef artifacts exist; the next screenshot capture will clean them up.");
  }
  if (maintenance.serviceLogs.stdout.oversized || maintenance.serviceLogs.stderr.oversized) {
    actions.push("Generated service logs are oversized; run `computer-linker service logs`, then stop the service and archive or remove service.out.log/service.err.log.");
  }
  return actions;
}

export function startupReadiness(config: LocalPortConfig, service: ServiceStatus = serviceStatus(config)): StartupReadiness {
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 3939;
  const localMcpUrl = `http://${host}:${port}/mcp`;
  const localApiUrl = `http://${host}:${port}/api/v1`;
  const profileCommand = `computer-linker service profile --platform ${service.platform}`;
  const profileBundleCommand = `computer-linker service profile --platform ${service.platform} --output-dir ./service-profile`;
  const installDryRunCommand = `computer-linker service install --dry-run --platform ${service.platform}`;
  const uninstallDryRunCommand = `computer-linker service uninstall --dry-run --platform ${service.platform}`;
  const modes: StartupReadinessMode[] = [
    {
      id: "here",
      title: "Current-folder MCP server",
      command: "computer-linker here",
      persistent: false,
      useWhen: "Daily foreground setup from inside the folder to expose. Creates or updates the workspace, then starts the local MCP/API server.",
    },
    {
      id: "start",
      title: "Local HTTP MCP server",
      command: "computer-linker start",
      persistent: false,
      useWhen: "Foreground local MCP/API server. This does not expose the server to the public internet.",
    },
    {
      id: "tunnel-cloudflare",
      title: "Cloudflare tunnel",
      command: "computer-linker start <workspace-path> --tunnel cloudflare",
      persistent: false,
      useWhen: "First public setup for one folder through cloudflared when a cloud MCP client must connect.",
    },
    {
      id: "tunnel-tailscale",
      title: "Tailscale Funnel",
      command: "computer-linker start <workspace-path> --tunnel tailscale",
      persistent: false,
      useWhen: "First public setup for one folder with a Funnel URL and automatic publicBaseUrl detection.",
    },
    {
      id: "tunnel-openai",
      title: "OpenAI Secure MCP Tunnel",
      command: "computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_...",
      persistent: false,
      useWhen: "First public setup for one folder through OpenAI Tunnel mode. ChatGPT uses the tunnel id instead of a public MCP URL.",
    },
    {
      id: "stdio",
      title: "stdio MCP server",
      command: "computer-linker serve --transport stdio",
      persistent: false,
      useWhen: "Local MCP clients that launch Computer Linker as a child process.",
    },
    {
      id: "service",
      title: "OS service",
      command: service.commandDisplay,
      persistent: true,
      useWhen: "Persistent startup on macOS, Linux, or Windows after reviewing the generated service profile.",
    },
  ];
  const checks: StartupReadinessCheck[] = [
    {
      id: "node-runtime",
      status: process.version ? "pass" : "fail",
      message: process.version ? "Node runtime is available." : "Node runtime was not detected.",
      detail: process.version,
    },
    {
      id: "local-http",
      status: "pass",
      message: "Local HTTP MCP and API URLs can be derived from config.",
      detail: localMcpUrl,
    },
    {
      id: "service-profile",
      status: "pass",
      message: "A cross-platform service profile can be generated.",
      detail: profileBundleCommand,
    },
    {
      id: "service-installed",
      status: service.manifestExists ? "pass" : "warn",
      message: service.manifestExists
        ? "The service manifest appears to be installed."
        : service.manifestExists === null
          ? "Windows service installation must be checked with the status commands."
          : "No service manifest was found at the expected path.",
      detail: service.manifestPath,
    },
  ];
  const nextActions = [
    "Run `computer-linker here` inside a project folder for one-command coding setup and startup.",
    "Run `computer-linker start <workspace-path>` from another folder when you need to expose an explicit path.",
    "Use `computer-linker here --read-only` when the client should inspect without editing or running project commands.",
    "Run `computer-linker doctor --fix` to apply safe local config repairs.",
    `Run \`${profileBundleCommand}\` to generate persistent startup files for ${service.platform}.`,
    `Run \`${installDryRunCommand}\` before applying any OS service changes.`,
  ];

  return {
    kind: "computer-linker-startup-readiness",
    schemaVersion: 1,
    ready: checks.every((check) => check.status !== "fail"),
    platform: service.platform,
    recommendedMode: service.manifestExists ? "service" : "start",
    localMcpUrl,
    localApiUrl,
    modes,
    service: {
      platform: service.platform,
      serviceName: service.serviceName,
      label: service.label,
      command: service.commandDisplay,
      manifestPath: service.manifestPath,
      manifestExists: service.manifestExists,
      statusCommands: service.statusCommands,
      profileCommand,
      profileBundleCommand,
      installDryRunCommand,
      uninstallDryRunCommand,
    },
    checks,
    nextActions,
  };
}

export function releaseReadiness(config: LocalPortConfig, input: {
  toolReadiness: ToolReadiness;
  startup: StartupReadiness;
  configFindings: ConfigDiagnostic[];
  securityFindings: ReturnType<typeof securityDiagnostics>;
}): ReleaseReadiness {
  const criticalConfig = input.configFindings.filter((finding) => finding.severity === "critical");
  const warningConfig = input.configFindings.filter((finding) => finding.severity === "warning");
  const criticalSecurity = input.securityFindings.filter((finding) => finding.severity === "critical");
  const warningSecurity = input.securityFindings.filter((finding) => finding.severity === "warning");
  const executionScopesWithoutAllowlist = config.workspaces.filter((workspace) => (
    (workspace.permissions.shell || workspace.permissions.codex) &&
    !workspace.policy?.allowedCommands?.length
  ));
  const checks: ReleaseReadinessCheck[] = [
    {
      id: "node-runtime",
      status: nodeVersionAtLeast(process.version, 20, 12) ? "pass" : "fail",
      message: nodeVersionAtLeast(process.version, 20, 12)
        ? "Node runtime satisfies the supported engine range."
        : "Node 20.12 or newer is required.",
      detail: process.version,
    },
    {
      id: "config",
      status: criticalConfig.length > 0 ? "fail" : warningConfig.length > 0 ? "warn" : "pass",
      message: criticalConfig.length > 0
        ? "Configuration has blocking issues."
        : warningConfig.length > 0
          ? "Configuration has warnings to review."
          : "Configuration baseline is valid.",
      detail: summarizeFindingIds(criticalConfig.length > 0 ? criticalConfig : warningConfig),
    },
    {
      id: "security",
      status: criticalSecurity.length > 0 ? "fail" : warningSecurity.length > 0 ? "warn" : "pass",
      message: criticalSecurity.length > 0
        ? "Security diagnostics have critical findings."
        : warningSecurity.length > 0
          ? "Security diagnostics have warnings to review."
          : "Security baseline is ready.",
      detail: summarizeFindingIds(criticalSecurity.length > 0 ? criticalSecurity : warningSecurity),
    },
    {
      id: "tool-readiness",
      status: input.toolReadiness.ready ? "pass" : "fail",
      message: input.toolReadiness.ready
        ? "Required local tools are available."
        : "Required local tools are missing.",
      detail: input.toolReadiness.requiredMissing.join(", ") || undefined,
    },
    {
      id: "startup",
      status: input.startup.ready ? "pass" : "fail",
      message: input.startup.ready
        ? "Startup modes can be derived for this machine."
        : "Startup readiness has failing checks.",
      detail: input.startup.checks.filter((check) => check.status === "fail").map((check) => check.id).join(", ") || undefined,
    },
    {
      id: "workspace-scopes",
      status: config.workspaces.length > 0 ? "pass" : "fail",
      message: config.workspaces.length > 0
        ? `${config.workspaces.length} workspace scope(s) configured.`
        : "At least one workspace scope must be configured.",
    },
    {
      id: "command-policy",
      status: executionScopesWithoutAllowlist.length > 0 ? "warn" : "pass",
      message: executionScopesWithoutAllowlist.length > 0
        ? "Some execution-enabled scopes do not have an allowedCommands policy."
        : "Execution-enabled scopes have command allowlists or no local execution is enabled.",
      detail: executionScopesWithoutAllowlist.map((workspace) => workspace.id).join(", ") || undefined,
    },
  ];
  const blockingReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.message}${check.detail ? ` (${check.detail})` : ""}`);
  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => `${check.id}: ${check.message}${check.detail ? ` (${check.detail})` : ""}`);
  const status: ReleaseReadiness["status"] = blockingReasons.length > 0
    ? "blocked"
    : warnings.length > 0
      ? "needs_attention"
      : "ready";

  return {
    kind: "computer-linker-release-readiness",
    schemaVersion: 1,
    ready: blockingReasons.length === 0,
    status,
    checks,
    blockingReasons,
    warnings,
    recommendedGate: "npm run product:check",
  };
}

function summarizeFindingIds(findings: Array<{ id: string }>): string | undefined {
  return findings.length ? findings.map((finding) => finding.id).join(", ") : undefined;
}

function configDiagnosticsSummary(findings: ConfigDiagnostic[]): {
  criticalCount: number;
  warningCount: number;
  findings: ConfigDiagnostic[];
} {
  return {
    criticalCount: findings.filter((finding) => finding.severity === "critical").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    findings,
  };
}

function securityFindingsForTunnelMode(
  findings: ReturnType<typeof securityDiagnostics>,
  tunnel: ReturnType<typeof tunnelDiagnostics>,
): ReturnType<typeof securityDiagnostics> {
  if (!openAiSecureTunnelActive(tunnel)) return findings;
  return findings.filter((finding) => finding.id !== "public-base-url-missing");
}

function openAiSecureTunnelActive(tunnel: ReturnType<typeof tunnelDiagnostics>): boolean {
  return tunnel.providers.some((provider) => provider.provider === "openai" && provider.running);
}

function nodeVersionAtLeast(version: string, major: number, minor: number): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const actualMajor = Number.parseInt(match[1], 10);
  const actualMinor = Number.parseInt(match[2], 10);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

function doctorNextActions(
  blockingReasons: string[],
  securityFindings: ReturnType<typeof securityDiagnostics>,
  release?: ReleaseReadiness,
): string[] {
  const actions = new Set<string>();
  if (blockingReasons.some((reason) => reason.includes("ownerToken"))) {
    actions.add("Generate or configure an owner token before exposing this machine.");
  }
  if (blockingReasons.some((reason) => reason.includes("tunnel provider"))) {
    actions.add("Install cloudflared or tailscale, configure a trusted reverse proxy, or use `computer-linker here --tunnel openai --tunnel-id tunnel_...` with CONTROL_PLANE_API_KEY.");
  }
  if (securityFindings.some((finding) => finding.id === "public-base-url-missing")) {
    actions.add("Set publicBaseUrl to the stable tunnel origin before OAuth client setup.");
  }
  if (securityFindings.some((finding) => finding.id === "public-base-url-not-https")) {
    actions.add("Use an HTTPS publicBaseUrl before connecting cloud-hosted MCP clients.");
  }
  if (securityFindings.some((finding) => finding.id === "shell-broad-access" || finding.id === "codex-broad-access")) {
    actions.add("Review workspaces with shell or codex permission; these are cwd-bound local execution, not filesystem sandboxes.");
  }
  if (release?.status === "blocked") {
    actions.add("Resolve releaseReadiness.blockingReasons before packaging or exposing Computer Linker.");
  }
  if (release?.status === "needs_attention") {
    actions.add("Review releaseReadiness.warnings before tagging an alpha release.");
  }
  if (actions.size === 0) {
    actions.add("No immediate action required.");
  }
  return [...actions];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function exposureReadiness(
  config: ReturnType<typeof loadConfig>,
  tunnel: ReturnType<typeof tunnelDiagnostics>,
  securityFindings: ReturnType<typeof securityDiagnostics>,
): {
  localOnly: boolean;
  readyForTunnel: boolean;
  authMode: "loopback-only" | "owner-token-or-oauth";
  publicBaseUrlConfigured: boolean;
  tunnelToolsAvailable: string[];
  blockingReasons: string[];
  warnings: string[];
} {
  const host = config.host ?? "127.0.0.1";
  const ownerTokenConfigured = Boolean(config.ownerToken);
  const publicBaseUrlConfigured = Boolean(config.publicBaseUrl);
  const tunnelToolsAvailable = tunnel.tools.filter((tool) => tool.available).map((tool) => tool.name);
  const openAiActive = openAiSecureTunnelActive(tunnel);
  const blockingReasons: string[] = [];

  if (!ownerTokenConfigured) {
    blockingReasons.push("ownerToken is required before exposing Computer Linker beyond loopback");
  }
  if (tunnelToolsAvailable.length === 0 && !process.env.CONTROL_PLANE_API_KEY && !process.env.OPENAI_API_KEY) {
    blockingReasons.push("install a tunnel provider or configure OpenAI Secure MCP Tunnel credentials");
  }
  if (securityFindings.some((finding) => finding.severity === "critical")) {
    blockingReasons.push("resolve critical security findings before exposure");
  }

  const warnings = securityFindings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => finding.id);

  if (ownerTokenConfigured && !publicBaseUrlConfigured && !openAiActive) {
    warnings.push("publicBaseUrl should be configured to the tunnel origin for OAuth clients");
  }

  return {
    localOnly: isLoopbackHost(host) && !ownerTokenConfigured,
    readyForTunnel: blockingReasons.length === 0,
    authMode: ownerTokenConfigured ? "owner-token-or-oauth" : "loopback-only",
    publicBaseUrlConfigured,
    tunnelToolsAvailable,
    blockingReasons,
    warnings: [...new Set(warnings)],
  };
}

function localToolCapabilities(): CommandCapability[] {
  return [
    commandCapability(toolDefinition("codex", ["--version"], "agent", "recommended", ["Codex-assisted plan, review, fix, test, and continuation workflows"], {
      macos: "Install the Codex CLI, then confirm `codex --version` works in the same shell.",
      linux: "Install the Codex CLI, then confirm `codex --version` works in the same shell.",
      windows: "Install the Codex CLI, then confirm `codex --version` works in PowerShell.",
      docs: "https://developers.openai.com/codex",
    })),
    commandCapability(toolDefinition("rg", ["--version"], "search", "recommended", ["Fast universal text search inside exposed workspaces"], {
      macos: "brew install ripgrep",
      linux: "sudo apt-get install ripgrep",
      windows: "winget install BurntSushi.ripgrep.MSVC",
      docs: "https://github.com/BurntSushi/ripgrep",
    })),
    commandCapability(toolDefinition("git", ["--version"], "vcs", "recommended", ["Repository status, diffs, logs, commits, and worktrees"], {
      macos: "brew install git",
      linux: "sudo apt-get install git",
      windows: "winget install Git.Git",
      docs: "https://git-scm.com/downloads",
    })),
    commandCapability(toolDefinition("node", ["--version"], "runtime", "required", ["Computer Linker runtime"], {
      macos: "Install Node.js 20.12+ from nodejs.org, nvm, fnm, or Homebrew.",
      linux: "Install Node.js 20.12+ from nodejs.org, nvm, fnm, or your distribution package manager.",
      windows: "Install Node.js 20.12+ from nodejs.org or winget.",
      docs: "https://nodejs.org/",
    })),
    commandCapability(toolDefinition("npm", ["--version"], "package-manager", "recommended", ["Install and run Node package scripts"], {
      macos: "Install Node.js; npm is bundled with standard Node installers.",
      linux: "Install Node.js; npm is bundled with standard Node installers.",
      windows: "Install Node.js; npm is bundled with standard Node installers.",
      docs: "https://nodejs.org/",
    })),
    commandCapability(toolDefinition("pnpm", ["--version"], "package-manager", "optional", ["Run pnpm-based package workflows"], {
      macos: "corepack enable pnpm",
      linux: "corepack enable pnpm",
      windows: "corepack enable pnpm",
      docs: "https://pnpm.io/installation",
    })),
    commandCapability(toolDefinition("bun", ["--version"], "runtime", "optional", ["Run Bun-based workspaces when configured"], {
      macos: "Install Bun from bun.sh.",
      linux: "Install Bun from bun.sh.",
      windows: "Install Bun from bun.sh.",
      docs: "https://bun.sh/",
    })),
    commandCapability(toolDefinition("python3", ["--version"], "runtime", "optional", ["Run Python project tooling from workspace commands"], {
      macos: "Install Python 3 from python.org or Homebrew.",
      linux: "Install python3 with your distribution package manager.",
      windows: "Install Python 3 from python.org or Microsoft Store.",
      docs: "https://www.python.org/downloads/",
    })),
    commandCapability(toolDefinition("bash", ["--version"], "shell", "optional", ["POSIX-style shell commands on macOS/Linux and Git Bash environments"], {
      linux: "Install bash with your distribution package manager.",
      windows: "Install Git for Windows if Bash compatibility is needed.",
    })),
    commandCapability(toolDefinition("zsh", ["--version"], "shell", "optional", ["zsh shell commands on macOS/Linux"], {
      macos: "zsh is bundled with modern macOS.",
      linux: "Install zsh with your distribution package manager.",
    })),
    commandCapability(toolDefinition("cmd", ["/c", "ver"], "shell", "optional", ["Windows cmd.exe shell command support"], {
      windows: "cmd.exe is bundled with Windows.",
    })),
    commandCapability(toolDefinition("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], "shell", "optional", ["Windows PowerShell command support"], {
      windows: "Windows PowerShell is bundled with Windows.",
    })),
    commandCapability(toolDefinition("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], "shell", "optional", ["PowerShell 7 command support"], {
      macos: "brew install --cask powershell",
      linux: "Install PowerShell from Microsoft packages for your distribution.",
      windows: "winget install Microsoft.PowerShell",
      docs: "https://learn.microsoft.com/powershell/",
    })),
    commandCapability(toolDefinition("docker", ["--version"], "container", "optional", ["Containerized project tooling when invoked by workspace commands"], {
      macos: "Install Docker Desktop.",
      linux: "Install Docker Engine or Docker Desktop.",
      windows: "Install Docker Desktop.",
      docs: "https://docs.docker.com/get-docker/",
    })),
  ];
}

function localToolReadiness(tools: CommandCapability[]): ToolReadiness {
  const requiredMissing = tools
    .filter((tool) => tool.importance === "required" && !tool.available)
    .map((tool) => tool.name);
  const recommendedMissing = tools
    .filter((tool) => tool.importance === "recommended" && !tool.available)
    .map((tool) => tool.name);

  return {
    kind: "computer-linker-tool-readiness",
    schemaVersion: 1,
    ready: requiredMissing.length === 0,
    requiredMissing,
    recommendedMissing,
    availableRecommended: tools
      .filter((tool) => tool.importance === "recommended" && tool.available)
      .map((tool) => tool.name),
    installHints: tools
      .filter((tool) => !tool.available && tool.importance !== "optional")
      .map((tool) => ({
        name: tool.name,
        importance: tool.importance,
        usedFor: tool.usedFor,
        install: tool.install,
      })),
  };
}

function toolDefinition(
  name: string,
  args: string[],
  category: CommandCapability["category"],
  importance: CommandCapability["importance"],
  usedFor: string[],
  install?: ToolInstallHint,
): Omit<CommandCapability, "available" | "version" | "error" | "path"> & { args: string[] } {
  return { name, args, category, importance, usedFor, install };
}

function commandCapability(
  definition: Omit<CommandCapability, "available" | "version" | "error" | "path"> & { args: string[] },
): CommandCapability {
  const path = findExecutableCommand(definition.name);
  const base = {
    name: definition.name,
    category: definition.category,
    importance: definition.importance,
    path,
    usedFor: definition.usedFor,
    install: definition.install,
  };
  if (!path) {
    return {
      ...base,
      available: false,
      error: "Not found on PATH.",
    };
  }
  if (definition.importance === "optional") {
    return {
      ...base,
      available: true,
    };
  }

  const command = executableCommand(definition.name, definition.args);
  try {
    const output = execFileSync(command.command, command.args, {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "pipe"],
      ...windowsVerbatimArgumentsOption(command),
    }).trim();
    return {
      ...base,
      available: true,
      version: firstLine(output),
    };
  } catch (error) {
    return {
      ...base,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function toolAvailable(tools: CommandCapability[], name: string): boolean {
  return tools.some((tool) => tool.name === name && tool.available);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? value;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
