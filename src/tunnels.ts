import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { configDir } from "./config.js";
import { securePrivateFile } from "./file-permissions.js";
import { executableCommand, windowsVerbatimArgumentsOption } from "./platform-shell.js";

export type TunnelProviderName = "cloudflare" | "tailscale" | "openai";
export type TailscaleMode = "serve" | "funnel";
export type TunnelProviderMode = TailscaleMode | "quick-tunnel" | "secure-mcp-tunnel";

export interface TunnelOptions {
  provider: TunnelProviderName;
  localPort: number;
  tailscaleMode?: TailscaleMode;
  openaiTunnelId?: string;
  openaiClientPath?: string;
  ownerToken?: string;
}

export interface TunnelCommand {
  provider: TunnelProviderName;
  mode?: TunnelProviderMode;
  command: string;
  args: string[];
  display: string;
  env?: Record<string, string>;
}

export interface TunnelToolStatus {
  name: "cloudflared" | "tailscale" | "tunnel-client";
  available: boolean;
  version?: string;
  path?: string;
  source?: "managed" | "downloaded" | "override" | "path";
  releaseTag?: string;
  releaseUrl?: string;
  assetName?: string;
  sha256?: string;
  installedAt?: string;
  manifestPath?: string;
  warning?: string;
  status?: string;
  error?: string;
}

export interface TunnelDiagnostics {
  tools: TunnelToolStatus[];
  commands: TunnelCommand[];
  providerContracts: TunnelProviderContract[];
  providers: TunnelProviderStatus[];
  publicBaseUrlConfigured: boolean;
  publicBaseUrl?: string;
  effectivePublicUrl?: string;
  effectivePublicUrlSource?: "configured" | "running-tunnel";
}

export interface TunnelProviderContract {
  provider: TunnelProviderName;
  modes: TunnelProviderMode[];
  commands: TunnelCommand[];
  lifecycle: {
    detect: true;
    status: true;
    expose: true;
    getPublicUrl: true;
    stop: true;
  };
  publicUrlSources: Array<"configured" | "running-tunnel">;
}

export interface TunnelProviderStatus {
  provider: TunnelProviderName;
  available: boolean;
  publicUrl?: string;
  publicUrlSource?: "configured" | "running-tunnel";
  running: boolean;
  runningProcessId?: string;
  runningMode?: TunnelProviderMode;
  status?: string;
  error?: string;
  commands: TunnelCommand[];
}

interface TunnelProviderStatusInput {
  localPort: number;
  publicBaseUrl?: string;
  tunnels?: TunnelProcessSnapshot[];
  openaiTunnelId?: string;
  openaiClientPath?: string;
  ownerToken?: string;
}

export interface TunnelProvider {
  name: TunnelProviderName;
  detect(): TunnelToolStatus;
  status(input: TunnelProviderStatusInput): TunnelProviderStatus;
  command(options: TunnelOptions): TunnelCommand;
  expose(options: TunnelOptions): ChildProcess;
  getPublicUrl(input: TunnelProviderStatusInput): string | undefined;
  stop(process: ChildProcess, signal?: NodeJS.Signals): void;
}

export async function exposeWithTunnel(options: TunnelOptions): Promise<void> {
  const child = getTunnelProvider(options.provider).expose(options);

  child.on("exit", (code, signal) => {
    if (signal) process.exitCode = 0;
    else process.exitCode = code ?? 1;
  });

  await once(child, "exit");
}

export function tunnelCommand(options: TunnelOptions): TunnelCommand {
  return getTunnelProvider(options.provider).command(options);
}

export function tunnelDiagnostics(input: {
  localPort: number;
  publicBaseUrl?: string;
  tunnels?: TunnelProcessSnapshot[];
  openaiTunnelId?: string;
  openaiClientPath?: string;
  ownerToken?: string;
}): TunnelDiagnostics {
  const providers = tunnelProviders.map((provider) => provider.status(input));
  const effectivePublicUrl = providers
    .find((provider) => provider.publicUrlSource === "running-tunnel")?.publicUrl
    ?? input.publicBaseUrl;
  return {
    tools: tunnelProviders.map((provider) => provider.detect()),
    commands: providers.flatMap((provider) => provider.commands),
    providerContracts: tunnelProviderContracts(input.localPort),
    providers,
    publicBaseUrlConfigured: Boolean(input.publicBaseUrl),
    publicBaseUrl: input.publicBaseUrl,
    effectivePublicUrl,
    effectivePublicUrlSource: providers.some((provider) => provider.publicUrlSource === "running-tunnel")
      ? "running-tunnel"
      : input.publicBaseUrl ? "configured" : undefined,
  };
}

export function getTunnelProviders(): TunnelProvider[] {
  return [...tunnelProviders];
}

export function getTunnelProvider(name: TunnelProviderName): TunnelProvider {
  const provider = tunnelProviders.find((item) => item.name === name);
  if (!provider) throw new Error(`Unknown tunnel provider: ${name}`);
  return provider;
}

export function tunnelProviderContracts(localPort: number): TunnelProviderContract[] {
  return tunnelProviders.map((provider) => ({
    provider: provider.name,
    modes: tunnelProviderModes(provider.name),
    commands: tunnelProviderCommands(provider.name, localPort),
    lifecycle: {
      detect: true,
      status: true,
      expose: true,
      getPublicUrl: true,
      stop: true,
    },
    publicUrlSources: provider.name === "openai" ? [] : ["configured", "running-tunnel"],
  }));
}

function tunnelProviderModes(provider: TunnelProviderName): TunnelProviderContract["modes"] {
  if (provider === "cloudflare") return ["quick-tunnel"];
  if (provider === "openai") return ["secure-mcp-tunnel"];
  return ["funnel"];
}

function tunnelProviderCommands(provider: TunnelProviderName, localPort: number): TunnelCommand[] {
  if (provider === "cloudflare") return [getTunnelProvider(provider).command({ provider, localPort })];
  if (provider === "openai") {
    const tunnelId = configuredOpenAiTunnelId();
    return tunnelId ? [getTunnelProvider(provider).command({ provider, localPort, openaiTunnelId: tunnelId })] : [];
  }
  return [
    getTunnelProvider(provider).command({ provider, localPort, tailscaleMode: "funnel" }),
  ];
}

const cloudflareTunnelProvider: TunnelProvider = {
  name: "cloudflare",
  detect: () => commandStatus("cloudflared", ["--version"]),
  status(input) {
    const tool = this.detect();
    const running = runningTunnelForProvider("cloudflare", input);
    return {
      provider: "cloudflare",
      available: tool.available,
      publicUrl: this.getPublicUrl(input),
      publicUrlSource: running?.publicUrl ? "running-tunnel" : input.publicBaseUrl ? "configured" : undefined,
      running: Boolean(running),
      runningProcessId: running?.id,
      runningMode: running?.mode,
      status: tool.version,
      error: tool.error,
      commands: [this.command({ provider: "cloudflare", localPort: input.localPort })],
    };
  },
  command(options) {
    const args = ["tunnel", "--url", `http://127.0.0.1:${options.localPort}`];
    return {
      provider: "cloudflare",
      command: "cloudflared",
      args,
      display: ["cloudflared", ...args].join(" "),
    };
  },
  expose(options) {
    const command = this.command(options);
    return spawnTunnelCommand(command, { stdio: "inherit" });
  },
  getPublicUrl(input) {
    return runningTunnelForProvider("cloudflare", input)?.publicUrl ?? input.publicBaseUrl;
  },
  stop(process, signal = "SIGTERM") {
    process.kill(signal);
  },
};

const tailscaleTunnelProvider: TunnelProvider = {
  name: "tailscale",
  detect: tailscaleStatus,
  status(input) {
    const tool = this.detect();
    const running = runningTunnelForProvider("tailscale", input);
    return {
      provider: "tailscale",
      available: tool.available,
      publicUrl: this.getPublicUrl(input),
      publicUrlSource: running?.publicUrl ? "running-tunnel" : input.publicBaseUrl ? "configured" : undefined,
      running: Boolean(running),
      runningProcessId: running?.id,
      runningMode: running?.mode,
      status: tool.status ?? tool.version,
      error: tool.error,
      commands: [
        this.command({ provider: "tailscale", localPort: input.localPort, tailscaleMode: "funnel" }),
      ],
    };
  },
  command(options) {
    const mode = options.tailscaleMode ?? "funnel";
    const args = mode === "funnel"
      ? ["funnel", "--yes", String(options.localPort)]
      : ["serve", `localhost:${options.localPort}`];

    return {
      provider: "tailscale",
      mode,
      command: "tailscale",
      args,
      display: ["tailscale", ...args].join(" "),
    };
  },
  expose(options) {
    const command = this.command(options);
    return spawnTunnelCommand(command, { stdio: "inherit" });
  },
  getPublicUrl(input) {
    const running = runningTunnelForProvider("tailscale", input);
    return running?.publicUrl ?? (running ? detectTailscalePublicUrl() : undefined) ?? input.publicBaseUrl;
  },
  stop(process, signal = "SIGTERM") {
    process.kill(signal);
  },
};

const openAiTunnelProvider: TunnelProvider = {
  name: "openai",
  detect: openAiTunnelClientStatus,
  status(input) {
    const tool = this.detect();
    const running = runningTunnelForProvider("openai", input);
    return {
      provider: "openai",
      available: tool.available,
      running: Boolean(running),
      runningProcessId: running?.id,
      status: tool.version ?? tool.status,
      error: tool.error,
      commands: (input.openaiTunnelId ?? configuredOpenAiTunnelId())
        ? [this.command({
            provider: "openai",
            localPort: input.localPort,
            openaiTunnelId: input.openaiTunnelId,
            openaiClientPath: input.openaiClientPath,
            ownerToken: input.ownerToken,
          })]
        : [],
    };
  },
  command(options) {
    const tunnelId = openAiTunnelIdFromOptions(options);
    const command = openAiTunnelClientCommand(options.openaiClientPath);
    const localMcpUrl = `http://127.0.0.1:${options.localPort}/mcp`;
    const runtimeDir = openAiTunnelRuntimeDir();
    mkdirSync(runtimeDir, { recursive: true });
    const args = [
      "run",
      "--control-plane.tunnel-id",
      tunnelId,
      "--mcp.server-url",
      `url=${localMcpUrl}`,
      "--mcp.extra-headers",
      "Authorization: env:COMPUTER_LINKER_MCP_AUTHORIZATION",
      "--health.listen-addr",
      "127.0.0.1:0",
      "--health.url-file",
      openAiTunnelHealthUrlFile(tunnelId),
      "--pid.file",
      openAiTunnelPidFile(tunnelId),
    ];
    return {
      provider: "openai",
      command,
      args,
      display: ["tunnel-client", ...args].join(" "),
      env: options.ownerToken ? { COMPUTER_LINKER_MCP_AUTHORIZATION: `Bearer ${options.ownerToken}` } : undefined,
    };
  },
  expose(options) {
    const command = this.command(options);
    return spawnTunnelCommand(command, { stdio: "inherit" });
  },
  getPublicUrl() {
    return undefined;
  },
  stop(process, signal = "SIGTERM") {
    process.kill(signal);
  },
};

const tunnelProviders: TunnelProvider[] = [
  cloudflareTunnelProvider,
  tailscaleTunnelProvider,
  openAiTunnelProvider,
];

function spawnTunnelCommand(command: TunnelCommand, options: { stdio: "inherit" }): ChildProcess {
  const invocation = executableCommand(command.command, command.args);
  return spawn(invocation.command, invocation.args, {
    stdio: options.stdio,
    env: command.env ? { ...process.env, ...command.env } : process.env,
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

function commandStatus(name: "cloudflared" | "tailscale" | "tunnel-client", args: string[], commandName: string = name): TunnelToolStatus {
  try {
    const command = executableCommand(commandName, args);
    const output = execFileSync(command.command, command.args, {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "pipe"],
      ...windowsVerbatimArgumentsOption(command),
    }).trim();
    return {
      name,
      available: true,
      version: firstLine(output),
    };
  } catch (error) {
    return {
      name,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface OpenAiTunnelClientInstallInfo {
  path: string;
  source: "managed" | "downloaded" | "override";
  version?: string;
  releaseTag?: string;
  releaseUrl?: string;
  assetName?: string;
  sha256?: string;
  installedAt?: string;
  manifestPath?: string;
  warning?: string;
}

interface OpenAiTunnelClientManifest {
  schemaVersion?: number;
  provider?: string;
  repository?: string;
  tag?: string;
  releaseTag?: string;
  releaseUrl?: string;
  assetName?: string;
  sha256?: string;
  installedAt?: string;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url?: string;
  assets: GitHubReleaseAsset[];
}

const openAiTunnelClientRepositoryApi = "https://api.github.com/repos/openai/tunnel-client/releases/latest";
const openAiTunnelClientOverrideEnv = "COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT";
const openAiTunnelIdEnv = "COMPUTER_LINKER_OPENAI_TUNNEL_ID";
const legacyOpenAiTunnelClientOverrideEnv = "WORKSPACE_LINKER_OPENAI_TUNNEL_CLIENT";
const legacyOpenAiTunnelIdEnv = "WORKSPACE_LINKER_OPENAI_TUNNEL_ID";

export async function ensureOpenAiTunnelClientInstalled(options: { clientPath?: string; refresh?: boolean } = {}): Promise<OpenAiTunnelClientInstallInfo> {
  const override = normalizeOptionalPath(options.clientPath)
    ?? normalizeOptionalPath(process.env[openAiTunnelClientOverrideEnv])
    ?? normalizeOptionalPath(process.env[legacyOpenAiTunnelClientOverrideEnv]);
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`OpenAI tunnel-client override does not exist: ${override}`);
    }
    return {
      path: override,
      source: "override",
      version: readTunnelClientVersion(override),
    };
  }

  const managedPath = openAiTunnelClientManagedPath();
  if (existsSync(managedPath) && !options.refresh) {
    return managedOpenAiTunnelClientInstallInfo();
  }

  try {
    const release = await fetchOpenAiTunnelClientLatestRelease();
    const target = openAiTunnelClientTarget();
    const assetSuffix = `${target.os}-${target.arch}.zip`;
    const asset = release.assets.find((item) => item.name.endsWith(assetSuffix) && item.name.startsWith("tunnel-client-"));
    const sumsAsset = release.assets.find((item) => item.name === "SHA256SUMS.txt");
    if (!asset) {
      throw new Error(`OpenAI tunnel-client release ${release.tag_name} does not include an asset for ${assetSuffix}`);
    }
    if (!sumsAsset) {
      throw new Error(`OpenAI tunnel-client release ${release.tag_name} does not include SHA256SUMS.txt`);
    }

    const [archive, sha256Sums] = await Promise.all([
      fetchBinary(asset.browser_download_url),
      fetchText(sumsAsset.browser_download_url),
    ]);
    const expectedSha256 = sha256FromSums(sha256Sums, asset.name);
    if (!expectedSha256) {
      throw new Error(`SHA256SUMS.txt does not include ${asset.name}`);
    }
    const actualSha256 = createHash("sha256").update(archive).digest("hex");
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(`OpenAI tunnel-client checksum mismatch for ${asset.name}`);
    }

    const toolsDir = openAiTunnelClientToolsDir();
    const downloadDir = join(toolsDir, "downloads");
    const extractDir = join(toolsDir, "extract");
    mkdirSync(downloadDir, { recursive: true });
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });

    const archivePath = join(downloadDir, asset.name);
    writeFileSync(archivePath, archive, { mode: 0o600 });
    extractZipArchive(archivePath, extractDir);

    const extractedBinary = findOpenAiTunnelClientBinary(extractDir);
    if (!extractedBinary) {
      throw new Error(`OpenAI tunnel-client archive did not contain ${openAiTunnelClientBinaryName()}`);
    }

    mkdirSync(toolsDir, { recursive: true });
    copyFileSync(extractedBinary, managedPath);
    if (process.platform !== "win32") chmodSync(managedPath, 0o755);
    writeOpenAiTunnelClientManifest({
      schemaVersion: 1,
      provider: "openai",
      repository: "openai/tunnel-client",
      releaseTag: release.tag_name,
      releaseUrl: release.html_url,
      assetName: asset.name,
      sha256: actualSha256,
      installedAt: new Date().toISOString(),
    });
    rmSync(extractDir, { recursive: true, force: true });

    return {
      path: managedPath,
      source: "downloaded",
      version: readTunnelClientVersion(managedPath),
      releaseTag: release.tag_name,
      releaseUrl: release.html_url,
      assetName: asset.name,
      sha256: actualSha256,
      installedAt: readOpenAiTunnelClientManifest()?.installedAt,
      manifestPath: openAiTunnelClientManifestPath(),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (existsSync(managedPath)) {
      return {
        ...managedOpenAiTunnelClientInstallInfo(),
        warning: `OpenAI tunnel-client ${options.refresh ? "refresh" : "download"} failed; using cached managed binary. ${detail}`,
      };
    }
    throw new Error(`OpenAI tunnel-client first-use download failed. ${detail} Provide a pinned binary with --tunnel-client or set ${openAiTunnelClientOverrideEnv}.`);
  }
}

export function openAiTunnelClientManagedPath(): string {
  return join(openAiTunnelClientToolsDir(), openAiTunnelClientBinaryName());
}

export function configuredOpenAiTunnelId(): string | undefined {
  const value = process.env[openAiTunnelIdEnv]?.trim()
    || process.env[legacyOpenAiTunnelIdEnv]?.trim();
  return value || undefined;
}

export function openAiTunnelHealthUrlFile(tunnelId: string): string {
  return join(openAiTunnelRuntimeDir(), `${safeFilename(tunnelId)}.health.url`);
}

function openAiTunnelPidFile(tunnelId: string): string {
  return join(openAiTunnelRuntimeDir(), `${safeFilename(tunnelId)}.pid`);
}

function openAiTunnelClientStatus(): TunnelToolStatus {
  const override = normalizeOptionalPath(process.env[openAiTunnelClientOverrideEnv])
    ?? normalizeOptionalPath(process.env[legacyOpenAiTunnelClientOverrideEnv]);
  if (override) {
    return {
      ...commandStatus("tunnel-client", ["--version"], override),
      path: override,
      source: "override",
    };
  }

  const managedPath = openAiTunnelClientManagedPath();
  if (existsSync(managedPath)) {
    return {
      ...commandStatus("tunnel-client", ["--version"], managedPath),
      ...managedOpenAiTunnelClientManifestFields(),
      path: managedPath,
      source: "managed",
    };
  }

  const candidates = ["tunnel-client"];
  let lastError: string | undefined;
  for (const candidate of candidates) {
    const status = commandStatus("tunnel-client", ["--version"], candidate);
    if (status.available) return { ...status, source: "path" };
    lastError = status.error;
  }
  return {
    name: "tunnel-client",
    available: false,
    error: lastError ?? "OpenAI tunnel-client is not installed; `computer-linker start --tunnel openai` can download the official release.",
  };
}

function openAiTunnelClientCommand(clientPath?: string): string {
  const override = normalizeOptionalPath(clientPath)
    ?? normalizeOptionalPath(process.env[openAiTunnelClientOverrideEnv])
    ?? normalizeOptionalPath(process.env[legacyOpenAiTunnelClientOverrideEnv]);
  if (override) return override;
  const managedPath = openAiTunnelClientManagedPath();
  return existsSync(managedPath) ? managedPath : "tunnel-client";
}

function openAiTunnelIdFromOptions(options: TunnelOptions): string {
  const tunnelId = options.openaiTunnelId ?? configuredOpenAiTunnelId();
  if (!tunnelId) {
    throw new Error(`OpenAI tunnel id is required. Pass --tunnel-id tunnel_... or set ${openAiTunnelIdEnv}.`);
  }
  return tunnelId;
}

function openAiTunnelClientToolsDir(): string {
  return join(configDir(), "tools", "openai-tunnel-client");
}

function openAiTunnelClientManifestPath(): string {
  return join(openAiTunnelClientToolsDir(), "release.json");
}

function managedOpenAiTunnelClientInstallInfo(): OpenAiTunnelClientInstallInfo {
  return {
    path: openAiTunnelClientManagedPath(),
    source: "managed",
    version: readTunnelClientVersion(openAiTunnelClientManagedPath()),
    ...managedOpenAiTunnelClientManifestFields(),
  };
}

function managedOpenAiTunnelClientManifestFields(): Pick<OpenAiTunnelClientInstallInfo, "releaseTag" | "releaseUrl" | "assetName" | "sha256" | "installedAt" | "manifestPath"> {
  const manifest = readOpenAiTunnelClientManifest();
  return {
    releaseTag: manifest?.releaseTag ?? manifest?.tag,
    releaseUrl: manifest?.releaseUrl,
    assetName: manifest?.assetName,
    sha256: manifest?.sha256,
    installedAt: manifest?.installedAt,
    manifestPath: openAiTunnelClientManifestPath(),
  };
}

function readOpenAiTunnelClientManifest(): OpenAiTunnelClientManifest | undefined {
  const manifestPath = openAiTunnelClientManifestPath();
  if (!existsSync(manifestPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<OpenAiTunnelClientManifest>;
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeOpenAiTunnelClientManifest(manifest: OpenAiTunnelClientManifest): void {
  const manifestPath = openAiTunnelClientManifestPath();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  securePrivateFile(manifestPath, 0o600);
}

function openAiTunnelRuntimeDir(): string {
  return join(configDir(), "openai-tunnel");
}

function openAiTunnelClientBinaryName(): string {
  return process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
}

function openAiTunnelClientTarget(): { os: string; arch: string } {
  const os = process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "darwin"
      : process.platform === "linux"
        ? "linux"
        : undefined;
  const arch = process.arch === "x64"
    ? "amd64"
    : process.arch === "arm64"
      ? "arm64"
      : undefined;
  if (!os || !arch) {
    throw new Error(`OpenAI tunnel-client auto-download is not supported on ${process.platform}/${process.arch}`);
  }
  return { os, arch };
}

async function fetchOpenAiTunnelClientLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(openAiTunnelClientRepositoryApi, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "computer-linker",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to query OpenAI tunnel-client latest release: HTTP ${response.status}`);
  }
  const release = await response.json() as Partial<GitHubRelease>;
  if (!release.tag_name || !Array.isArray(release.assets)) {
    throw new Error("OpenAI tunnel-client latest release response is missing expected fields");
  }
  return {
    tag_name: release.tag_name,
    html_url: typeof release.html_url === "string" ? release.html_url : undefined,
    assets: release.assets.flatMap((asset) => (
      asset && typeof asset === "object" && typeof asset.name === "string" && typeof asset.browser_download_url === "string"
        ? [{ name: asset.name, browser_download_url: asset.browser_download_url }]
        : []
    )),
  };
}

async function fetchBinary(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/octet-stream",
      "User-Agent": "computer-linker",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/plain",
      "User-Agent": "computer-linker",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function sha256FromSums(text: string, assetName: string): string | undefined {
  const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^([a-f0-9]{64})\\s+\\*?${escapedName}$`, "im");
  return text.match(pattern)?.[1];
}

function extractZipArchive(archivePath: string, extractDir: string): void {
  const tar = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (tar.status === 0) return;

  const unzip = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (unzip.status === 0) return;

  if (process.platform === "win32") {
    const powershell = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archivePath,
      extractDir,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (powershell.status === 0) return;
  }

  throw new Error(`Failed to extract ${basename(archivePath)}. tar: ${tar.stderr || tar.stdout} unzip: ${unzip.stderr || unzip.stdout}`);
}

function findOpenAiTunnelClientBinary(directory: string): string | undefined {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const nested = findOpenAiTunnelClientBinary(path);
      if (nested) return nested;
      continue;
    }
    if (entry === openAiTunnelClientBinaryName()) return path;
  }
  return undefined;
}

function readTunnelClientVersion(commandName: string): string | undefined {
  const status = commandStatus("tunnel-client", ["--version"], commandName);
  return status.version;
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "tunnel";
}

function tailscaleStatus(): TunnelToolStatus {
  const status = commandStatus("tailscale", ["version"]);
  if (!status.available) return status;

  try {
    const command = executableCommand("tailscale", ["serve", "status"]);
    const output = execFileSync(command.command, command.args, {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "pipe"],
      ...windowsVerbatimArgumentsOption(command),
    }).trim();
    return {
      ...status,
      status: output || "No Tailscale status reported.",
    };
  } catch (error) {
    return {
      ...status,
      status: "Tailscale status unavailable.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? value;
}

function runningTunnelForProvider(provider: TunnelProviderName, input: TunnelProviderStatusInput): TunnelProcessSnapshot | undefined {
  return input.tunnels?.find((tp) => tp.status === "running" && tp.provider === provider);
}

// --- Tunnel process tracking (CLI/API managed start/stop) ---

export interface TunnelProcessSnapshot {
  id: string;
  provider: TunnelProviderName;
  mode?: TunnelProviderMode;
  localPort: number;
  command: string;
  args: string[];
  display: string;
  pid?: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "exited";
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  publicUrl?: string;
  events?: TunnelRuntimeEvent[];
  lastError?: string;
  lastRecoveryAt?: string;
}

export type TunnelRuntimeEventKind =
  | "process_started"
  | "process_exited"
  | "dispatcher_forwarded"
  | "dispatcher_acknowledged"
  | "mcp_upstream_error"
  | "controlplane_poll_failed"
  | "controlplane_recovered";

export interface TunnelRuntimeEvent {
  timestamp: string;
  provider: TunnelProviderName;
  tunnelId: string;
  localPort?: number;
  pid?: number;
  severity: "info" | "warn" | "error";
  kind: TunnelRuntimeEventKind;
  message: string;
  detail?: string;
  statusCode?: number;
  status?: string;
  rpcMethod?: string;
  requestId?: string;
  cmdRequestId?: string;
  rpcRequestId?: string;
  sessionId?: string;
  tunnelRequestId?: string;
}

interface TunnelProcess extends TunnelProcessSnapshot {
  child: ChildProcess;
}

const tunnelProcesses = new Map<string, TunnelProcess>();
const maxOutputBytes = 32 * 1024;
const maxPersistedTunnelEvents = 200;
const maxPersistedTunnelSnapshots = 50;

export function startTunnelProcess(options: TunnelOptions): TunnelProcessSnapshot {
  const provider = getTunnelProvider(options.provider);
  const cmd = provider.command(options);
  const existing = findRunningTunnel(options);
  if (existing) return snapshotTunnel(existing);

  const spawnCommand = executableCommand(cmd.command, cmd.args);
  const child = spawn(spawnCommand.command, spawnCommand.args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
    windowsHide: true,
    windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
  });
  const id = `tunnel_${randomUUID()}`;
  const tunnelProcess: TunnelProcess = {
    child,
    id,
    provider: cmd.provider,
    mode: cmd.mode,
    localPort: options.localPort,
    command: cmd.command,
    args: cmd.args,
    display: cmd.display,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
    events: [{
      timestamp: new Date().toISOString(),
      provider: cmd.provider,
      tunnelId: id,
      localPort: options.localPort,
      pid: child.pid,
      severity: "info",
      kind: "process_started",
      message: "tunnel process started",
    }],
  };
  tunnelProcesses.set(id, tunnelProcess);
  persistTunnelProcesses();

  child.stdout?.on("data", (chunk: Buffer) => {
    tunnelProcess.stdout = appendBounded(tunnelProcess.stdout, chunk.toString("utf8"));
    const url = extractPublicUrl(tunnelProcess.stdout, cmd.provider);
    if (url) tunnelProcess.publicUrl = url;
    persistTunnelProcesses();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    tunnelProcess.stderr = appendBounded(tunnelProcess.stderr, chunk.toString("utf8"));
    const url = extractPublicUrl(tunnelProcess.stderr, cmd.provider);
    if (url) tunnelProcess.publicUrl = url;
    persistTunnelProcesses();
  });
  child.on("exit", (code, signal) => {
    tunnelProcess.status = "exited";
    tunnelProcess.exitCode = code;
    tunnelProcess.signal = signal ?? undefined;
    tunnelProcess.endedAt = new Date().toISOString();
    persistTunnelProcesses();
  });
  child.on("error", (error) => {
    tunnelProcess.status = "exited";
    tunnelProcess.exitCode = null;
    tunnelProcess.stderr = appendBounded(tunnelProcess.stderr, error.message);
    tunnelProcess.endedAt = new Date().toISOString();
    persistTunnelProcesses();
  });

  return snapshotTunnel(tunnelProcess);
}

export async function stopTunnelProcess(id: string, signal: string = "SIGTERM"): Promise<TunnelProcessSnapshot> {
  const tp = tunnelProcesses.get(id);
  if (!tp) throw new Error(`Unknown tunnel process: ${id}`);
  if (tp.status !== "running") return snapshotTunnel(tp);

  const normalizedSignal = signal === "SIGKILL" || signal === "SIGINT" || signal === "SIGTERM" ? signal : "SIGTERM";
  terminateTunnelGroup(tp, normalizedSignal as NodeJS.Signals);
  await waitForTunnelExit(tp, 500);
  if (normalizedSignal !== "SIGKILL" && tp.status === "running") {
    terminateTunnelGroup(tp, "SIGKILL");
    await waitForTunnelExit(tp, 500);
  }
  persistTunnelProcesses();
  return snapshotTunnel(tp);
}

export function listTunnelProcesses(): TunnelProcessSnapshot[] {
  return mergedTunnelSnapshots()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function refreshTunnelPublicUrl(id: string): TunnelProcessSnapshot | undefined {
  const tp = tunnelProcesses.get(id);
  if (!tp) return undefined;
  const publicUrl = tp.publicUrl ?? detectTunnelPublicUrl(tp.provider);
  if (publicUrl) {
    tp.publicUrl = publicUrl;
    persistTunnelProcesses();
  }
  return snapshotTunnel(tp);
}

export function stopAllTunnelProcesses(signal: string = "SIGTERM"): Promise<TunnelProcessSnapshot[]> {
  const normalizedSignal = signal === "SIGKILL" || signal === "SIGINT" || signal === "SIGTERM" ? signal : "SIGTERM";
  return Promise.all(
    [...tunnelProcesses.values()]
      .filter((tp) => tp.status === "running")
      .map((tp) => stopTunnelProcess(tp.id, normalizedSignal)),
  );
}

function findRunningTunnel(options: TunnelOptions): TunnelProcess | undefined {
  const expectedMode = options.provider === "tailscale" ? options.tailscaleMode ?? "funnel" : undefined;
  return [...tunnelProcesses.values()].find(
    (tp) =>
      tp.status === "running" &&
      tp.provider === options.provider &&
      tp.localPort === options.localPort &&
      tp.mode === expectedMode,
  );
}

function snapshotTunnel(tp: TunnelProcess): TunnelProcessSnapshot {
  const events = tunnelRuntimeEventsForSnapshot(tp, { includeInfo: true, limit: maxPersistedTunnelEvents });
  const lastError = events.find((event) => event.severity !== "info");
  const lastRecovery = events.find((event) => event.kind === "controlplane_recovered");
  return {
    id: tp.id,
    provider: tp.provider,
    mode: tp.mode,
    localPort: tp.localPort,
    command: tp.command,
    args: tp.args,
    display: tp.display,
    pid: tp.pid,
    startedAt: tp.startedAt,
    endedAt: tp.endedAt,
    status: tp.status,
    exitCode: tp.exitCode,
    signal: tp.signal,
    stdout: tp.stdout,
    stderr: tp.stderr,
    publicUrl: tp.publicUrl,
    events,
    lastError: lastError?.detail ?? lastError?.message,
    lastRecoveryAt: lastRecovery?.timestamp,
  };
}

function mergedTunnelSnapshots(): TunnelProcessSnapshot[] {
  const byId = new Map<string, TunnelProcessSnapshot>();
  for (const snapshot of readPersistedTunnelSnapshots()) {
    byId.set(snapshot.id, snapshot);
  }
  for (const process of tunnelProcesses.values()) {
    byId.set(process.id, snapshotTunnel(process));
  }
  if (byId.size === 0) return [];
  return refreshPersistedTunnelSnapshots([...byId.values()]);
}

function tunnelStatePath(): string {
  return join(configDir(), "tunnels.json");
}

function readPersistedTunnelSnapshots(): TunnelProcessSnapshot[] {
  try {
    if (!existsSync(tunnelStatePath())) return [];
    const parsed = JSON.parse(readFileSync(tunnelStatePath(), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => parseTunnelSnapshot(item));
  } catch {
    return [];
  }
}

function persistTunnelProcesses(): void {
  const byId = new Map<string, TunnelProcessSnapshot>();
  for (const snapshot of readPersistedTunnelSnapshots()) {
    byId.set(snapshot.id, snapshot);
  }
  for (const process of tunnelProcesses.values()) {
    byId.set(process.id, snapshotTunnel(process));
  }
  writePersistedTunnelSnapshots([...byId.values()]);
}

function refreshPersistedTunnelSnapshots(snapshots: TunnelProcessSnapshot[]): TunnelProcessSnapshot[] {
  const refreshed = snapshots.map((snapshot) => (
    snapshot.status === "running" && snapshot.pid && !isProcessAlive(snapshot.pid)
      ? {
          ...snapshot,
          status: "exited" as const,
          exitCode: snapshot.exitCode,
          endedAt: snapshot.endedAt ?? new Date().toISOString(),
        }
      : snapshot
  ));
  writePersistedTunnelSnapshots(refreshed);
  return refreshed;
}

function writePersistedTunnelSnapshots(snapshots: TunnelProcessSnapshot[]): void {
  try {
    mkdirSync(configDir(), { recursive: true });
    const sorted = snapshots
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, maxPersistedTunnelSnapshots)
      .map(compactTunnelSnapshotForPersistence);
    const path = tunnelStatePath();
    writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, { mode: 0o600 });
    securePrivateFile(path, 0o600);
  } catch {
    // Tunnel snapshots are best-effort diagnostics; tunnel operation should continue without them.
  }
}

function parseTunnelSnapshot(value: unknown): TunnelProcessSnapshot[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Partial<TunnelProcessSnapshot>;
  if (
    typeof item.id !== "string" ||
    (item.provider !== "cloudflare" && item.provider !== "tailscale" && item.provider !== "openai") ||
    typeof item.localPort !== "number" ||
    typeof item.command !== "string" ||
    !Array.isArray(item.args) ||
    typeof item.display !== "string" ||
    typeof item.startedAt !== "string" ||
    (item.status !== "running" && item.status !== "exited")
  ) {
    return [];
  }
  return [{
    id: item.id,
    provider: item.provider,
    mode: item.mode === "serve" || item.mode === "funnel" ? item.mode : undefined,
    localPort: item.localPort,
    command: item.command,
    args: item.args.filter((arg): arg is string => typeof arg === "string"),
    display: item.display,
    pid: typeof item.pid === "number" ? item.pid : undefined,
    startedAt: item.startedAt,
    endedAt: typeof item.endedAt === "string" ? item.endedAt : undefined,
    status: item.status,
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
    signal: typeof item.signal === "string" ? item.signal : undefined,
    stdout: typeof item.stdout === "string" ? item.stdout : "",
    stderr: typeof item.stderr === "string" ? item.stderr : "",
    publicUrl: typeof item.publicUrl === "string" ? item.publicUrl : undefined,
    events: parseTunnelRuntimeEvents(item.events),
    lastError: typeof item.lastError === "string" ? item.lastError : undefined,
    lastRecoveryAt: typeof item.lastRecoveryAt === "string" ? item.lastRecoveryAt : undefined,
  }];
}

function compactTunnelSnapshotForPersistence(snapshot: TunnelProcessSnapshot): TunnelProcessSnapshot {
  const events = tunnelRuntimeEventsForSnapshot(snapshot, { includeInfo: true, limit: maxPersistedTunnelEvents });
  const lastError = events.find((event) => event.severity !== "info");
  const lastRecovery = events.find((event) => event.kind === "controlplane_recovered");
  return {
    ...snapshot,
    stdout: appendBounded("", snapshot.stdout),
    stderr: appendBounded("", snapshot.stderr),
    events,
    lastError: lastError?.detail ?? lastError?.message ?? snapshot.lastError,
    lastRecoveryAt: lastRecovery?.timestamp ?? snapshot.lastRecoveryAt,
  };
}

export function tunnelRuntimeEvents(
  snapshots: TunnelProcessSnapshot[] = listTunnelProcesses(),
  options: { limit?: number; includeInfo?: boolean } = {},
): TunnelRuntimeEvent[] {
  const limit = normalizeTunnelEventLimit(options.limit);
  const includeInfo = options.includeInfo ?? false;
  const events = snapshots.flatMap((snapshot) => tunnelRuntimeEventsForSnapshot(snapshot, { includeInfo }));
  return events
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

function tunnelRuntimeEventsForSnapshot(
  snapshot: TunnelProcessSnapshot,
  options: { limit?: number; includeInfo?: boolean } = {},
): TunnelRuntimeEvent[] {
  const includeInfo = options.includeInfo ?? false;
  const byKey = new Map<string, TunnelRuntimeEvent>();

  for (const event of parseTunnelRuntimeEvents(snapshot.events)) {
    if (shouldIncludeTunnelEvent(event, includeInfo)) byKey.set(tunnelEventKey(event), event);
  }

  const parsed = [
    ...parseTunnelLogOutput(snapshot.stdout, snapshot, "stdout"),
    ...parseTunnelLogOutput(snapshot.stderr, snapshot, "stderr"),
  ];
  for (const event of parsed) {
    if (shouldIncludeTunnelEvent(event, includeInfo)) byKey.set(tunnelEventKey(event), event);
  }

  if (includeInfo) {
    byKey.set(`started:${snapshot.id}`, {
      timestamp: snapshot.startedAt,
      provider: snapshot.provider,
      tunnelId: snapshot.id,
      localPort: snapshot.localPort,
      pid: snapshot.pid,
      severity: "info",
      kind: "process_started",
      message: "tunnel process started",
    });
  }

  if (snapshot.endedAt) {
    const exited: TunnelRuntimeEvent = {
      timestamp: snapshot.endedAt,
      provider: snapshot.provider,
      tunnelId: snapshot.id,
      localPort: snapshot.localPort,
      pid: snapshot.pid,
      severity: snapshot.exitCode === 0 ? "info" : "warn",
      kind: "process_exited",
      message: "tunnel process exited",
      detail: `exitCode=${snapshot.exitCode ?? snapshot.signal ?? "unknown"}`,
    };
    if (shouldIncludeTunnelEvent(exited, includeInfo)) byKey.set(`exited:${snapshot.id}`, exited);
  }

  return [...byKey.values()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, normalizeTunnelEventLimit(options.limit));
}

function parseTunnelRuntimeEvents(value: unknown): TunnelRuntimeEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TunnelRuntimeEvent[] => {
    if (!item || typeof item !== "object") return [];
    const event = item as Partial<TunnelRuntimeEvent>;
    if (
      typeof event.timestamp !== "string" ||
      (event.provider !== "cloudflare" && event.provider !== "tailscale" && event.provider !== "openai") ||
      typeof event.tunnelId !== "string" ||
      !isTunnelRuntimeEventKind(event.kind) ||
      (event.severity !== "info" && event.severity !== "warn" && event.severity !== "error") ||
      typeof event.message !== "string"
    ) {
      return [];
    }
    return [{
      timestamp: event.timestamp,
      provider: event.provider,
      tunnelId: event.tunnelId,
      localPort: typeof event.localPort === "number" ? event.localPort : undefined,
      pid: typeof event.pid === "number" ? event.pid : undefined,
      severity: event.severity,
      kind: event.kind,
      message: event.message,
      detail: typeof event.detail === "string" ? event.detail : undefined,
      statusCode: typeof event.statusCode === "number" ? event.statusCode : undefined,
      status: typeof event.status === "string" ? event.status : undefined,
      rpcMethod: typeof event.rpcMethod === "string" ? event.rpcMethod : undefined,
      requestId: typeof event.requestId === "string" ? event.requestId : undefined,
      cmdRequestId: typeof event.cmdRequestId === "string" ? event.cmdRequestId : undefined,
      rpcRequestId: typeof event.rpcRequestId === "string" ? event.rpcRequestId : undefined,
      sessionId: typeof event.sessionId === "string" ? event.sessionId : undefined,
      tunnelRequestId: typeof event.tunnelRequestId === "string" ? event.tunnelRequestId : undefined,
    }];
  });
}

function isTunnelRuntimeEventKind(value: unknown): value is TunnelRuntimeEventKind {
  return value === "process_started" ||
    value === "process_exited" ||
    value === "dispatcher_forwarded" ||
    value === "dispatcher_acknowledged" ||
    value === "mcp_upstream_error" ||
    value === "controlplane_poll_failed" ||
    value === "controlplane_recovered";
}

function parseTunnelLogOutput(output: string, snapshot: TunnelProcessSnapshot, source: "stdout" | "stderr"): TunnelRuntimeEvent[] {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .flatMap((line) => parseTunnelLogLine(line, snapshot, source));
}

function parseTunnelLogLine(line: string, snapshot: TunnelProcessSnapshot, source: "stdout" | "stderr"): TunnelRuntimeEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([A-Z]+)\s+(.+)$/.exec(trimmed);
  if (!match) return [];

  const attrs = parseTunnelLogAttributes(match[8] ?? "");
  const attrStart = (match[8] ?? "").search(/\s+[A-Za-z_][A-Za-z0-9_]*=/);
  const message = attrStart >= 0 ? (match[8] ?? "").slice(0, attrStart).trim() : (match[8] ?? "").trim();
  const kind = tunnelRuntimeEventKindFromMessage(message);
  if (!kind) return [];

  const timestamp = tunnelLogTimestampToIso(match);
  const statusCode = parseOptionalInteger(attrs.status_code);
  const detail = attrs.error ?? attrs.status ?? attrs.body ?? attrs.err ?? undefined;
  const event: TunnelRuntimeEvent = {
    timestamp,
    provider: snapshot.provider,
    tunnelId: snapshot.id,
    localPort: snapshot.localPort,
    pid: snapshot.pid,
    severity: tunnelEventSeverity(match[7] ?? "INFO", kind),
    kind,
    message: message || `${source} tunnel event`,
    detail,
    statusCode,
    status: attrs.status,
    rpcMethod: attrs.rpc_method ?? attrs.method,
    requestId: attrs.request_id,
    cmdRequestId: attrs.cmd_request_id,
    rpcRequestId: attrs.rpc_request_id,
    sessionId: attrs.session_id,
    tunnelRequestId: attrs.tunnel_request_id,
  };
  return [event];
}

function tunnelLogTimestampToIso(match: RegExpExecArray): string {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if ([year, month, day, hour, minute, second].some((value) => !Number.isFinite(value))) {
    return new Date().toISOString();
  }
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function parseTunnelLogAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)=(?:"((?:\\.|[^"\\])*)"|(\S+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1];
    if (!key) continue;
    attrs[key] = unescapeTunnelLogValue(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function unescapeTunnelLogValue(value: string): string {
  return value.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function tunnelRuntimeEventKindFromMessage(message: string): TunnelRuntimeEventKind | undefined {
  if (message.startsWith("dispatcher forwarded command to MCP server")) return "dispatcher_forwarded";
  if (message.startsWith("dispatcher acknowledged notification")) return "dispatcher_acknowledged";
  if (message.startsWith("dispatcher received MCP upstream error")) return "mcp_upstream_error";
  if (message.startsWith("poll failed")) return "controlplane_poll_failed";
  if (message.startsWith("poller recovered")) return "controlplane_recovered";
  return undefined;
}

function tunnelEventSeverity(level: string, kind: TunnelRuntimeEventKind): TunnelRuntimeEvent["severity"] {
  if (kind === "mcp_upstream_error") return "error";
  if (kind === "controlplane_poll_failed") return "warn";
  if (level === "ERROR" || level === "ERR") return "error";
  if (level === "WARN" || level === "WARNING") return "warn";
  return "info";
}

function shouldIncludeTunnelEvent(event: TunnelRuntimeEvent, includeInfo: boolean): boolean {
  if (includeInfo) return true;
  return event.severity !== "info" || event.kind === "controlplane_recovered";
}

function tunnelEventKey(event: TunnelRuntimeEvent): string {
  return [
    event.timestamp,
    event.provider,
    event.tunnelId,
    event.kind,
    event.requestId ?? "",
    event.cmdRequestId ?? "",
    event.rpcRequestId ?? "",
    event.sessionId ?? "",
    event.tunnelRequestId ?? "",
    event.detail ?? "",
  ].join("|");
}

function normalizeTunnelEventLimit(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 1000) : 200;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function appendBounded(current: string, next: string): string {
  let output = current + next;
  while (Buffer.byteLength(output, "utf8") > maxOutputBytes) {
    output = output.slice(Math.max(1, output.length - maxOutputBytes));
  }
  return output;
}

function extractPublicUrl(output: string, provider: TunnelProviderName): string | undefined {
  const patterns = provider === "cloudflare"
    ? [/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i]
    : provider === "tailscale"
      ? [/https:\/\/[a-z0-9.-]+\.ts\.net/i]
      : [];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[0]) return match[0];
  }
  return undefined;
}

function detectTunnelPublicUrl(provider: TunnelProviderName): string | undefined {
  if (provider !== "tailscale") return undefined;
  return detectTailscalePublicUrl();
}

export function detectTailscalePublicUrl(): string | undefined {
  const funnelOutputs = [
    readTailscaleCommand(["funnel", "status", "--json"]),
    readTailscaleCommand(["funnel", "status"]),
  ].filter((output): output is string => Boolean(output));

  let funnelConfirmed = false;
  for (const output of funnelOutputs) {
    const publicUrl = tailscalePublicUrlFromFunnelStatus(output);
    if (publicUrl) return publicUrl;
    funnelConfirmed ||= tailscaleFunnelStatusIsPublic(output);
  }

  if (funnelConfirmed) {
    const statusOutput = readTailscaleCommand(["status", "--json"]);
    return statusOutput ? tailscalePublicUrlFromStatusJson(statusOutput) : undefined;
  }
  return undefined;
}

function readTailscaleCommand(args: string[]): string | undefined {
  try {
    const command = executableCommand("tailscale", args);
    return execFileSync(command.command, command.args, {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
      ...windowsVerbatimArgumentsOption(command),
    });
  } catch {
    return undefined;
  }
}

export function tailscalePublicUrlFromFunnelStatus(output: string): string | undefined {
  if (!tailscaleFunnelStatusIsPublic(output)) return undefined;
  return tailscalePublicUrlFromStatusJson(output);
}

export function tailscalePublicUrlFromStatusJson(output: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return extractPublicUrl(output, "tailscale");
  }

  const embeddedUrl = findTailscaleUrl(parsed);
  if (embeddedUrl) return embeddedUrl;

  if (parsed && typeof parsed === "object") {
    const status = parsed as {
      CertDomains?: unknown;
      Self?: { DNSName?: unknown };
    };
    const certDomain = Array.isArray(status.CertDomains)
      ? status.CertDomains.find((item): item is string => typeof item === "string")
      : undefined;
    return normalizeTailscaleHostname(certDomain)
      ?? normalizeTailscaleHostname(typeof status.Self?.DNSName === "string" ? status.Self.DNSName : undefined);
  }
  return undefined;
}

function tailscaleFunnelStatusIsPublic(output: string): boolean {
  if (/\b(funnel on|available on the internet)\b/i.test(output)) return true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return false;
  }
  return containsEnabledFunnelMarker(parsed);
}

function containsEnabledFunnelMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return /\b(funnel on|available on the internet)\b/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsEnabledFunnelMarker(item));
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key.toLowerCase().includes("funnel") && item === true) return true;
      if (containsEnabledFunnelMarker(item)) return true;
    }
  }
  return false;
}

function findTailscaleUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeTailscaleHostname(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTailscaleUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const keyUrl = normalizeTailscaleHostname(key);
      if (keyUrl) return keyUrl;
      const found = findTailscaleUrl(item);
      if (found) return found;
    }
  }
  return undefined;
}

function normalizeTailscaleHostname(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".ts.net")) {
      return parsed.origin;
    }
  } catch {
    // Fall through to DNS-name normalization.
  }
  const hostname = trimmed.replace(/\.$/, "").toLowerCase();
  if (!/^[a-z0-9.-]+\.ts\.net$/i.test(hostname)) return undefined;
  return `https://${hostname}`;
}

function terminateTunnelGroup(tp: TunnelProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32" && tp.pid) {
    spawnSync("taskkill", ["/pid", String(tp.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  if (tp.pid && process.platform !== "win32") {
    try {
      process.kill(-tp.pid, signal);
      return;
    } catch {
      // Fall back to killing the child directly.
    }
  }
  getTunnelProvider(tp.provider).stop(tp.child, signal);
}

async function waitForTunnelExit(tp: TunnelProcess, timeoutMs: number): Promise<boolean> {
  if (tp.status !== "running") return true;
  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      tp.child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    tp.child.once("exit", onExit);
    timeout.unref();
  });
}
