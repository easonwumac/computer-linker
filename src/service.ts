import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { configDir } from "./config.js";
import { securePrivateFile } from "./file-permissions.js";
import { expandHomePath, type LocalPortConfig } from "./permissions.js";
import { fileStatus, readTailText, serviceLogPolicy, tailLinesFromText } from "./retention.js";

export type ServicePlatform = "linux" | "macos" | "windows";
export type ServiceFormat = "profile" | "manifest";

export interface ServiceProfileOptions {
  platform?: ServicePlatform;
  nodePath?: string;
  cliPath?: string;
  serviceName?: string;
  configDirectory?: string;
  outputDir?: string;
}

export interface ServiceFileSet {
  profile: string;
  manifest: string;
  install: string;
  uninstall: string;
}

export interface ServiceProfile {
  kind: "computer-linker-service-profile";
  schemaVersion: 1;
  platform: ServicePlatform;
  serviceName: string;
  label: string;
  command: string[];
  commandDisplay: string;
  configDir: string;
  configPath: string;
  manifestPath: string;
  manifest: string;
  installCommands: string[];
  uninstallCommands: string[];
  statusCommands: string[];
  startCommands: string[];
  stopCommands: string[];
  logCommands: string[];
  logFiles: {
    stdout: string;
    stderr: string;
  };
  notes: string[];
}

export interface WrittenServiceProfile {
  kind: "computer-linker-service-files";
  outputDir: string;
  platform: ServicePlatform;
  files: ServiceFileSet;
}

export interface ServiceStatus {
  kind: "computer-linker-service-status";
  schemaVersion: 1;
  platform: ServicePlatform;
  serviceName: string;
  label: string;
  configDir: string;
  configPath: string;
  manifestPath: string;
  manifestExists: boolean | null;
  commandDisplay: string;
  statusCommands: string[];
  installCommands: string[];
  uninstallCommands: string[];
  startCommands: string[];
  stopCommands: string[];
  logCommands: string[];
  logFiles: {
    stdout: string;
    stderr: string;
  };
  logPolicy: ServiceLogPolicy;
  logFileStatus: {
    stdout: ServiceLogFileStatus;
    stderr: ServiceLogFileStatus;
  };
  notes: string[];
}

export type ServicePlanAction = "install" | "uninstall" | "start" | "stop";

export interface ServiceCommandInvocation {
  command: string;
  args: string[];
  display: string;
}

export interface ServicePlan {
  kind: "computer-linker-service-plan";
  schemaVersion: 1;
  action: ServicePlanAction;
  dryRun: boolean;
  effect: string;
  platform: ServicePlatform;
  serviceName: string;
  label: string;
  requiresElevation: boolean;
  commands: string[];
  recommendedProfileCommand: string;
  notes: string[];
}

export interface ServiceLogReport {
  kind: "computer-linker-service-logs";
  schemaVersion: 1;
  platform: ServicePlatform;
  serviceName: string;
  label: string;
  logFiles: {
    stdout: string;
    stderr: string;
  };
  policy: ServiceLogPolicy;
  stdout: {
    exists: boolean;
    path: string;
    sizeBytes: number;
    readBytes: number;
    truncated: boolean;
    oversized: boolean;
    warnBytes: number;
    tail: string;
  };
  stderr: {
    exists: boolean;
    path: string;
    sizeBytes: number;
    readBytes: number;
    truncated: boolean;
    oversized: boolean;
    warnBytes: number;
    tail: string;
  };
  commands: string[];
  notes: string[];
}

export interface ServiceLogPolicy {
  warnBytes: number;
  tailReadMaxBytes: number;
}

export interface ServiceLogFileStatus {
  exists: boolean;
  path: string;
  sizeBytes: number;
  warnBytes: number;
  oversized: boolean;
}

export function serviceProfile(config: LocalPortConfig, options: ServiceProfileOptions = {}): ServiceProfile {
  const platform = options.platform ?? currentServicePlatform();
  const serviceName = sanitizeServiceName(options.serviceName ?? "computer-linker");
  const label = platform === "macos" ? `com.computer-linker.${serviceName}` : serviceName;
  const nodePath = resolve(options.nodePath ?? process.execPath);
  const cliPath = resolve(options.cliPath ?? process.argv[1] ?? "dist/cli.js");
  const serviceConfigDir = resolve(expandHomePath(options.configDirectory ?? configDir()));
  const command = [nodePath, cliPath, "serve", "--transport", "http"];
  const manifestPath = defaultManifestPath(platform, label, serviceName);
  const logFiles = serviceLogFiles(serviceConfigDir);
  const manifest = serviceManifest(platform, {
    label,
    serviceName,
    command,
    configDirectory: serviceConfigDir,
  });

  return {
    kind: "computer-linker-service-profile",
    schemaVersion: 1,
    platform,
    serviceName,
    label,
    command,
    commandDisplay: command.map(shellQuote).join(" "),
    configDir: serviceConfigDir,
    configPath: join(serviceConfigDir, "config.json"),
    manifestPath,
    manifest,
    installCommands: installCommands(platform, manifestPath, label, serviceName),
    uninstallCommands: uninstallCommands(platform, manifestPath, label, serviceName),
    statusCommands: statusCommands(platform, label, serviceName),
    startCommands: startCommands(platform, label, serviceName),
    stopCommands: stopCommands(platform, label, serviceName),
    logCommands: logCommands(platform, label, serviceName, logFiles),
    logFiles,
    notes: serviceNotes(platform),
  };
}

export function serviceProfileOutput(config: LocalPortConfig, options: ServiceProfileOptions & {
  format?: ServiceFormat;
} = {}): string {
  const profile = serviceProfile(config, options);
  return options.format === "manifest"
    ? profile.manifest
    : `${JSON.stringify(profile, null, 2)}\n`;
}

export function writeServiceProfileFiles(config: LocalPortConfig, options: ServiceProfileOptions = {}): WrittenServiceProfile {
  if (!options.outputDir || options.outputDir.startsWith("--")) {
    throw new Error("service profile --output-dir requires a directory path");
  }
  const outputDir = resolve(expandHomePath(options.outputDir));
  const profile = serviceProfile(config, options);
  const extension = profile.platform === "macos" ? "plist" : profile.platform === "linux" ? "service" : "ps1";
  const files: ServiceFileSet = {
    profile: join(outputDir, "service-profile.json"),
    manifest: join(outputDir, `${profile.serviceName}.${extension}`),
    install: join(outputDir, installScriptName(profile.platform)),
    uninstall: join(outputDir, uninstallScriptName(profile.platform)),
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(files.profile, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(files.manifest, profile.manifest, { mode: 0o600 });
  writeFileSync(files.install, installScriptBody(profile, files), { mode: 0o700 });
  writeFileSync(files.uninstall, uninstallScriptBody(profile), { mode: 0o700 });
  securePrivateFile(files.profile, 0o600);
  securePrivateFile(files.manifest, 0o600);
  securePrivateFile(files.install, 0o700);
  securePrivateFile(files.uninstall, 0o700);

  return {
    kind: "computer-linker-service-files",
    outputDir,
    platform: profile.platform,
    files,
  };
}

export function serviceStatus(config: LocalPortConfig, options: ServiceProfileOptions = {}): ServiceStatus {
  const profile = serviceProfile(config, options);
  const logFileStatus = serviceLogFileStatus(profile.logFiles);
  return {
    kind: "computer-linker-service-status",
    schemaVersion: 1,
    platform: profile.platform,
    serviceName: profile.serviceName,
    label: profile.label,
    configDir: profile.configDir,
    configPath: profile.configPath,
    manifestPath: profile.manifestPath,
    manifestExists: profile.platform === "windows" ? null : existsSync(profile.manifestPath),
    commandDisplay: profile.commandDisplay,
    statusCommands: profile.statusCommands,
    installCommands: profile.installCommands,
    uninstallCommands: profile.uninstallCommands,
    startCommands: profile.startCommands,
    stopCommands: profile.stopCommands,
    logCommands: profile.logCommands,
    logFiles: profile.logFiles,
    logPolicy: currentServiceLogPolicy(),
    logFileStatus,
    notes: profile.notes,
  };
}

export function servicePlan(
  config: LocalPortConfig,
  action: ServicePlanAction,
  options: ServiceProfileOptions & { dryRun?: boolean } = {},
): ServicePlan {
  const profile = serviceProfile(config, options);
  const commands = action === "install"
    ? profile.installCommands
    : action === "uninstall"
      ? profile.uninstallCommands
      : action === "start"
        ? profile.startCommands
        : profile.stopCommands;
  return {
    kind: "computer-linker-service-plan",
    schemaVersion: 1,
    action,
    dryRun: options.dryRun ?? true,
    effect: servicePlanEffect(profile.platform, action),
    platform: profile.platform,
    serviceName: profile.serviceName,
    label: profile.label,
    requiresElevation: serviceActionRequiresElevation(profile.platform, action),
    commands,
    recommendedProfileCommand: `computer-linker service profile --platform ${profile.platform} --output-dir ${shellQuote(defaultServiceOutputDir(options))}`,
    notes: [
      options.dryRun === false
        ? "This action may change the OS service manager."
        : "Dry run only. No service files were written and no OS service was changed.",
      ...profile.notes,
    ],
  };
}

export function defaultServiceOutputDir(options: ServiceProfileOptions = {}): string {
  const serviceConfigDir = resolve(expandHomePath(options.configDirectory ?? configDir()));
  return resolve(expandHomePath(options.outputDir ?? join(serviceConfigDir, "service-profile")));
}

export function serviceLogs(
  config: LocalPortConfig,
  options: ServiceProfileOptions & { lines?: number } = {},
): ServiceLogReport {
  const profile = serviceProfile(config, options);
  const lines = normalizeLogLines(options.lines);
  return {
    kind: "computer-linker-service-logs",
    schemaVersion: 1,
    platform: profile.platform,
    serviceName: profile.serviceName,
    label: profile.label,
    logFiles: profile.logFiles,
    policy: currentServiceLogPolicy(),
    stdout: readLogTail(profile.logFiles.stdout, lines),
    stderr: readLogTail(profile.logFiles.stderr, lines),
    commands: profile.logCommands,
    notes: serviceLogNotes(profile.platform),
  };
}

export function formatServiceStatus(status: ServiceStatus): string {
  const manifest = status.manifestExists === null
    ? "service-manager"
    : status.manifestExists ? "present" : "missing";
  return [
    `Computer Linker service status (${status.platform})`,
    `serviceName: ${status.serviceName}`,
    `label: ${status.label}`,
    `configPath: ${status.configPath}`,
    `manifestPath: ${status.manifestPath}`,
    `manifest: ${manifest}`,
    `command: ${status.commandDisplay}`,
    `logs: stdout ${formatLogFileStatus(status.logFileStatus.stdout)}, stderr ${formatLogFileStatus(status.logFileStatus.stderr)}`,
    "status commands:",
    ...status.statusCommands.map((command) => `  ${command}`),
    "daily commands:",
    ...status.startCommands.map((command) => `  start: ${command}`),
    ...status.stopCommands.map((command) => `  stop: ${command}`),
    ...status.logCommands.map((command) => `  logs: ${command}`),
    "notes:",
    ...status.notes.map((note) => `  - ${note}`),
  ].join("\n") + "\n";
}

export function formatServicePlan(plan: ServicePlan): string {
  return [
    `Computer Linker service ${plan.action}${plan.dryRun ? " dry run" : ""} (${plan.platform})`,
    `serviceName: ${plan.serviceName}`,
    `effect: ${plan.effect}`,
    `requiresElevation: ${plan.requiresElevation ? "yes" : "no"}`,
    `profileCommand: ${plan.recommendedProfileCommand}`,
    "commands:",
    ...plan.commands.map((command) => `  ${command}`),
    "notes:",
    ...plan.notes.map((note) => `  - ${note}`),
  ].join("\n") + "\n";
}

export function formatServiceLogs(report: ServiceLogReport): string {
  const lines = [
    `Computer Linker service logs (${report.platform})`,
    `serviceName: ${report.serviceName}`,
    `stdout: ${report.stdout.path} (${report.stdout.exists ? "present" : "missing"})`,
    `stdout size: ${report.stdout.sizeBytes} bytes${report.stdout.oversized ? ` (over ${report.stdout.warnBytes} byte warning threshold)` : ""}${report.stdout.truncated ? `; showing tail from last ${report.stdout.readBytes} bytes` : ""}`,
    report.stdout.tail ? report.stdout.tail : "  (no stdout log content)",
    `stderr: ${report.stderr.path} (${report.stderr.exists ? "present" : "missing"})`,
    `stderr size: ${report.stderr.sizeBytes} bytes${report.stderr.oversized ? ` (over ${report.stderr.warnBytes} byte warning threshold)` : ""}${report.stderr.truncated ? `; showing tail from last ${report.stderr.readBytes} bytes` : ""}`,
    report.stderr.tail ? report.stderr.tail : "  (no stderr log content)",
    "commands:",
    ...report.commands.map((command) => `  ${command}`),
    "notes:",
    ...report.notes.map((note) => `  - ${note}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseServicePlatform(value: string | undefined): ServicePlatform {
  if (!value) return currentServicePlatform();
  if (value === "linux" || value === "macos" || value === "windows") return value;
  throw new Error("service --platform must be one of: linux, macos, windows");
}

export function parseServiceFormat(value: string | undefined): ServiceFormat {
  if (!value) return "profile";
  if (value === "profile" || value === "manifest") return value;
  throw new Error("service --format must be one of: profile, manifest");
}

function currentServicePlatform(): ServicePlatform {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function defaultManifestPath(platform: ServicePlatform, label: string, serviceName: string): string {
  if (platform === "macos") return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  if (platform === "windows") return `${serviceName} Windows Service`;
  return `/etc/systemd/system/${serviceName}.service`;
}

function serviceManifest(platform: ServicePlatform, input: {
  label: string;
  serviceName: string;
  command: string[];
  configDirectory: string;
}): string {
  if (platform === "macos") return launchdPlist(input);
  if (platform === "windows") return windowsServiceScript(input);
  return systemdUnit(input);
}

function systemdUnit(input: {
  serviceName: string;
  command: string[];
  configDirectory: string;
}): string {
  return `[Unit]
Description=Computer Linker HTTP MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${input.command.map(systemdEscapeArg).join(" ")}
Restart=on-failure
RestartSec=3
Environment=COMPUTER_LINKER_CONFIG_DIR=${systemdEscapeArg(input.configDirectory)}

[Install]
WantedBy=multi-user.target
`;
}

function launchdPlist(input: {
  label: string;
  command: string[];
  configDirectory: string;
}): string {
  const args = input.command.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COMPUTER_LINKER_CONFIG_DIR</key>
    <string>${xmlEscape(input.configDirectory)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(input.configDirectory, "service.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(input.configDirectory, "service.err.log"))}</string>
</dict>
</plist>
`;
}

function windowsServiceScript(input: {
  serviceName: string;
  command: string[];
  configDirectory: string;
}): string {
  const logFiles = serviceLogFiles(input.configDirectory);
  const command = [
    `if not exist ${windowsQuote(input.configDirectory)} mkdir ${windowsQuote(input.configDirectory)}`,
    `set "COMPUTER_LINKER_CONFIG_DIR=${input.configDirectory}"`,
    `${input.command.map(windowsQuote).join(" ")} >> ${windowsQuote(logFiles.stdout)} 2>> ${windowsQuote(logFiles.stderr)}`,
  ].join(" && ");
  const binPath = `${windowsQuote(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")} /d /s /c ${windowsQuote(command)}`;
  return `$ErrorActionPreference = "Stop"
$serviceName = ${powershellQuote(input.serviceName)}
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne "Stopped") {
    sc.exe stop $serviceName | Out-Host
    Start-Sleep -Seconds 1
  }
  sc.exe delete $serviceName | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "sc.exe delete failed for $serviceName" }
  Start-Sleep -Seconds 1
}
sc.exe create $serviceName binPath= ${powershellQuote(binPath)} start= auto DisplayName= "Computer Linker"
if ($LASTEXITCODE -ne 0) { throw "sc.exe create failed for $serviceName" }
sc.exe description $serviceName "Computer Linker HTTP MCP server"
if ($LASTEXITCODE -ne 0) { throw "sc.exe description failed for $serviceName" }
sc.exe start $serviceName
if ($LASTEXITCODE -ne 0) { throw "sc.exe start failed for $serviceName" }
`;
}

function installCommands(platform: ServicePlatform, manifestPath: string, label: string, serviceName: string): string[] {
  if (platform === "macos") {
    return [
      `launchctl bootout gui/$(id -u)/${shellQuote(label)} 2>/dev/null || true`,
      `mkdir -p ${shellQuote(dirnamePath(manifestPath))}`,
      `cp ./service-profile/${basename(manifestPath)} ${shellQuote(manifestPath)}`,
      `launchctl bootstrap gui/$(id -u) ${shellQuote(manifestPath)}`,
      `launchctl enable gui/$(id -u)/${shellQuote(label)}`,
    ];
  }
  if (platform === "windows") {
    return [
      "Run install-service.ps1 from an elevated PowerShell prompt.",
      `Get-Service ${serviceName}`,
    ];
  }
  return [
    `sudo cp ./service-profile/${basename(manifestPath)} ${shellQuote(manifestPath)}`,
    "sudo systemctl daemon-reload",
    `sudo systemctl enable ${shellQuote(serviceName)}`,
    `sudo systemctl restart ${shellQuote(serviceName)}`,
  ];
}

function uninstallCommands(platform: ServicePlatform, manifestPath: string, label: string, serviceName: string): string[] {
  if (platform === "macos") {
    return [
      `launchctl bootout gui/$(id -u)/${shellQuote(label)} || true`,
      `rm -f ${shellQuote(manifestPath)}`,
    ];
  }
  if (platform === "windows") {
    return [
      `$serviceName = ${powershellQuote(serviceName)}`,
      "$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue",
      "if ($existing) {",
      "  if ($existing.Status -ne \"Stopped\") {",
      "    sc.exe stop $serviceName | Out-Host",
      "    Start-Sleep -Seconds 1",
      "  }",
      "  sc.exe delete $serviceName | Out-Host",
      "  if ($LASTEXITCODE -ne 0) { throw \"sc.exe delete failed for $serviceName\" }",
      "} else {",
      "  Write-Host \"Service $serviceName is not installed; nothing to remove.\"",
      "}",
    ];
  }
  return [
    `sudo systemctl disable --now ${shellQuote(serviceName)} || true`,
    `sudo rm -f ${shellQuote(manifestPath)}`,
    "sudo systemctl daemon-reload",
    `sudo systemctl reset-failed ${shellQuote(serviceName)} || true`,
  ];
}

function statusCommands(platform: ServicePlatform, label: string, serviceName: string): string[] {
  if (platform === "macos") return [`launchctl print gui/$(id -u)/${label}`];
  if (platform === "windows") return [`Get-Service ${serviceName}`, `sc.exe query ${serviceName}`];
  return [`systemctl status ${serviceName}`, `journalctl -u ${serviceName} -n 100 --no-pager`];
}

function startCommands(platform: ServicePlatform, label: string, serviceName: string): string[] {
  if (platform === "macos") return [`launchctl kickstart -k gui/$(id -u)/${label}`];
  if (platform === "windows") return [`sc.exe start ${powershellQuote(serviceName)}`];
  return [serviceControlExecutionCommand(platform, "start", serviceName, label).display];
}

function stopCommands(platform: ServicePlatform, label: string, serviceName: string): string[] {
  if (platform === "macos") return [`launchctl bootout gui/$(id -u)/${shellQuote(label)}`];
  if (platform === "windows") return [`sc.exe stop ${powershellQuote(serviceName)}`];
  return [serviceControlExecutionCommand(platform, "stop", serviceName, label).display];
}

export function serviceControlExecutionCommand(
  platform: ServicePlatform,
  action: "start" | "stop",
  serviceName: string,
  label: string,
): ServiceCommandInvocation {
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
  const args = ["systemctl", action, serviceName];
  return { command: "sudo", args, display: commandDisplay("sudo", args) };
}

function logCommands(
  platform: ServicePlatform,
  label: string,
  serviceName: string,
  logFiles: { stdout: string; stderr: string },
): string[] {
  if (platform === "linux") return [`journalctl -u ${serviceName} -n 100 --no-pager`];
  if (platform === "windows") {
    return [
      `Get-Content -Tail 100 ${powershellQuote(logFiles.stdout)}`,
      `Get-Content -Tail 100 ${powershellQuote(logFiles.stderr)}`,
    ];
  }
  return [
    `tail -n 100 ${shellQuote(logFiles.stdout)}`,
    `tail -n 100 ${shellQuote(logFiles.stderr)}`,
    `launchctl print gui/$(id -u)/${label}`,
  ];
}

function serviceNotes(platform: ServicePlatform): string[] {
  const common = [
    "Run `computer-linker init` before installing so ownerToken is configured.",
    "The service starts HTTP mode on the configured host and port.",
    "Use Tailscale Serve, Cloudflare Access, or equivalent controls before exposing it beyond loopback.",
  ];
  if (platform === "windows") {
    return [...common, "Windows Service creation requires an elevated PowerShell prompt."];
  }
  if (platform === "linux") {
    return [...common, "systemd install commands require sudo."];
  }
  return [...common, "launchd runs this as the current user through ~/Library/LaunchAgents."];
}

function serviceLogNotes(platform: ServicePlatform): string[] {
  if (platform === "linux") {
    return ["Linux systemd services usually log to journald; use the printed journalctl command when local log files are empty."];
  }
  return [
    "Logs are written by the generated service profile after the service starts.",
    `service logs reads only the last ${serviceLogPolicy.tailReadMaxBytes} bytes and warns when a generated log exceeds ${serviceLogPolicy.warnBytes} bytes.`,
    "Stop the service, archive or remove service.out.log/service.err.log, then start it again if the generated logs grow too large.",
  ];
}

function serviceLogFiles(serviceConfigDir: string): { stdout: string; stderr: string } {
  return {
    stdout: join(serviceConfigDir, "service.out.log"),
    stderr: join(serviceConfigDir, "service.err.log"),
  };
}

function readLogTail(path: string, lines: number): ServiceLogReport["stdout"] {
  const tail = readTailText(path, serviceLogPolicy.tailReadMaxBytes);
  return {
    exists: tail.exists,
    path,
    sizeBytes: tail.sizeBytes,
    readBytes: tail.readBytes,
    truncated: tail.truncated,
    oversized: tail.sizeBytes > serviceLogPolicy.warnBytes,
    warnBytes: serviceLogPolicy.warnBytes,
    tail: tailLinesFromText(tail.text, lines),
  };
}

function serviceLogFileStatus(logFiles: { stdout: string; stderr: string }): ServiceStatus["logFileStatus"] {
  return {
    stdout: fileStatus(logFiles.stdout, serviceLogPolicy.warnBytes),
    stderr: fileStatus(logFiles.stderr, serviceLogPolicy.warnBytes),
  };
}

function currentServiceLogPolicy(): ServiceLogPolicy {
  return {
    warnBytes: serviceLogPolicy.warnBytes,
    tailReadMaxBytes: serviceLogPolicy.tailReadMaxBytes,
  };
}

function formatLogFileStatus(status: ServiceLogFileStatus): string {
  if (!status.exists) return "missing";
  return `${status.sizeBytes} bytes${status.oversized ? " oversized" : ""}`;
}

function normalizeLogLines(value: number | undefined): number {
  if (!Number.isFinite(value ?? 100)) return 100;
  return Math.max(1, Math.min(1000, Math.floor(value ?? 100)));
}

function serviceActionRequiresElevation(platform: ServicePlatform, action: ServicePlanAction): boolean {
  if (platform === "macos") return false;
  if (platform === "windows") return action === "install" || action === "uninstall";
  return true;
}

function servicePlanEffect(platform: ServicePlatform, action: ServicePlanAction): string {
  if (action === "uninstall") return "remove if present; tolerate an already missing service";
  if (action === "start") return "start the installed service";
  if (action === "stop") return "stop the installed service";
  if (platform === "macos") return "replace an existing launchd agent or create it";
  if (platform === "windows") return "replace an existing Windows service or create it";
  return "install or update the systemd unit, enable it, and restart it";
}

function sanitizeServiceName(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "computer-linker";
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandDisplay(command: string, args: string[]): string {
  return [command, ...args].map((value) => /[\s"]/g.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value).join(" ");
}

function systemdEscapeArg(value: string): string {
  return value.replace(/([\\s\\\\\"'`$])/g, "\\$1");
}

function windowsQuote(value: string): string {
  if (!/[\s"]/g.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function scriptBody(platform: ServicePlatform, commands: string[]): string {
  if (platform === "windows") {
    return `$ErrorActionPreference = "Stop"\n${commands.join("\n")}\n`;
  }
  return `#!/usr/bin/env sh\nset -eu\n${commands.join("\n")}\n`;
}

function installScriptBody(profile: ServiceProfile, files: ServiceFileSet): string {
  if (profile.platform === "windows") return profile.manifest;
  const scriptDir = "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)";
  if (profile.platform === "macos") {
    return scriptBody("macos", [
      scriptDir,
      `launchctl bootout gui/$(id -u)/${shellQuote(profile.label)} 2>/dev/null || true`,
      `mkdir -p ${shellQuote(dirnamePath(profile.manifestPath))}`,
      `cp "$SCRIPT_DIR/${basename(files.manifest)}" ${shellQuote(profile.manifestPath)}`,
      `launchctl bootstrap gui/$(id -u) ${shellQuote(profile.manifestPath)}`,
      `launchctl enable gui/$(id -u)/${shellQuote(profile.label)}`,
    ]);
  }
  return scriptBody("linux", [
    scriptDir,
    `sudo cp "$SCRIPT_DIR/${basename(files.manifest)}" ${shellQuote(profile.manifestPath)}`,
    "sudo systemctl daemon-reload",
    `sudo systemctl enable ${shellQuote(profile.serviceName)}`,
    `sudo systemctl restart ${shellQuote(profile.serviceName)}`,
  ]);
}

function uninstallScriptBody(profile: ServiceProfile): string {
  return scriptBody(profile.platform, profile.uninstallCommands);
}

function installScriptName(platform: ServicePlatform): string {
  return platform === "windows" ? "install-service.ps1" : "install-service.sh";
}

function uninstallScriptName(platform: ServicePlatform): string {
  return platform === "windows" ? "uninstall-service.ps1" : "uninstall-service.sh";
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}
