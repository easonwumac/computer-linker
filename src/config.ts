import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  defaultConfig,
  expandHomePath,
  normalizeConfig,
  type LocalPortConfig,
} from "./permissions.js";
import { securePrivateFile } from "./file-permissions.js";

export type ConfigValueSource = "file" | "env" | "absent";

export interface ConfigSourceField {
  configured: boolean;
  source: ConfigValueSource;
  fileConfigured: boolean;
  envName?: string;
  legacyEnvName?: boolean;
  overriddenByEnv: boolean;
}

export interface PublicBaseUrlConfigSource extends ConfigSourceField {
  value: string | null;
  fileValue: string | null;
}

export interface OwnerTokenConfigSource extends ConfigSourceField {
  valueRedacted: "<ownerToken>" | null;
}

export interface RuntimeConfigSources {
  kind: "computer-linker-runtime-config-sources";
  schemaVersion: 1;
  configDir: string;
  configPath: string;
  publicBaseUrl: PublicBaseUrlConfigSource;
  ownerToken: OwnerTokenConfigSource;
}

interface EnvOverride {
  value: string;
  envName: string;
  legacyEnvName: boolean;
}

interface EnvCandidate {
  name: string;
  legacy: boolean;
}

export function configDir(): string {
  return resolve(expandHomePath(
    firstNonBlank(
      process.env.COMPUTER_LINKER_CONFIG_DIR,
      process.env.WORKSPACE_LINKER_CONFIG_DIR,
      process.env.LOCALPORT_CONFIG_DIR,
    ) ?? join(homedir(), ".computer-linker"),
  ));
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function auditLogPath(): string {
  return join(configDir(), "audit.jsonl");
}

export function codexRunsPath(): string {
  return join(configDir(), "codex-runs.jsonl");
}

export function oauthStatePath(): string {
  return join(configDir(), "oauth-state.json");
}

export function loadConfig(): LocalPortConfig {
  return normalizeConfig(withEnvOverrides(loadConfigFile()));
}

export function loadConfigFile(): LocalPortConfig {
  const path = configPath();
  if (!existsSync(path)) {
    writeConfig(defaultConfig());
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalPortConfig;
    const normalized = normalizeConfig(parsed);
    if (!parsed.machineId?.trim()) {
      writeConfig({
        ...parsed,
        machineId: normalized.machineId,
      });
    }
    return normalized;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${path}: ${reason}`);
  }
}

export function writeDefaultConfig(): string {
  const path = configPath();
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(path, JSON.stringify({
    ...defaultConfig(),
    ownerToken: generateOwnerToken(),
  }, null, 2) + "\n", { mode: 0o600 });
  securePrivateFile(path, 0o600);
  return path;
}

export function writeConfig(config: LocalPortConfig): string {
  const path = configPath();
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(normalizeConfig(config), null, 2) + "\n", { mode: 0o600 });
  securePrivateFile(path, 0o600);
  return path;
}

export function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function runtimeConfigSources(fileConfig: LocalPortConfig = loadConfigFile()): RuntimeConfigSources {
  const normalizedFileConfig = normalizeConfig(fileConfig);
  const publicBaseUrlOverride = envOverride(PUBLIC_BASE_URL_ENV);
  const ownerTokenOverride = envOverride(OWNER_TOKEN_ENV);
  const publicBaseUrl = publicBaseUrlOverride?.value ?? normalizedFileConfig.publicBaseUrl;
  const ownerToken = ownerTokenOverride?.value ?? normalizedFileConfig.ownerToken;

  return {
    kind: "computer-linker-runtime-config-sources",
    schemaVersion: 1,
    configDir: configDir(),
    configPath: configPath(),
    publicBaseUrl: {
      configured: Boolean(publicBaseUrl),
      source: publicBaseUrlOverride ? "env" : normalizedFileConfig.publicBaseUrl ? "file" : "absent",
      value: publicBaseUrl ?? null,
      fileValue: normalizedFileConfig.publicBaseUrl ?? null,
      fileConfigured: Boolean(normalizedFileConfig.publicBaseUrl),
      envName: publicBaseUrlOverride?.envName,
      legacyEnvName: publicBaseUrlOverride?.legacyEnvName,
      overriddenByEnv: Boolean(publicBaseUrlOverride),
    },
    ownerToken: {
      configured: Boolean(ownerToken),
      source: ownerTokenOverride ? "env" : normalizedFileConfig.ownerToken ? "file" : "absent",
      valueRedacted: ownerToken ? "<ownerToken>" : null,
      fileConfigured: Boolean(normalizedFileConfig.ownerToken),
      envName: ownerTokenOverride?.envName,
      legacyEnvName: ownerTokenOverride?.legacyEnvName,
      overriddenByEnv: Boolean(ownerTokenOverride),
    },
  };
}

function withEnvOverrides(config: LocalPortConfig): LocalPortConfig {
  const publicBaseUrlOverride = envOverride(PUBLIC_BASE_URL_ENV);
  const ownerTokenOverride = envOverride(OWNER_TOKEN_ENV);
  return {
    ...config,
    publicBaseUrl: publicBaseUrlOverride?.value ?? config.publicBaseUrl,
    ownerToken: ownerTokenOverride?.value ?? config.ownerToken,
  };
}

function envOverride(candidates: EnvCandidate[]): EnvOverride | undefined {
  for (const candidate of candidates) {
    const value = process.env[candidate.name];
    if (value === undefined || value.trim().length === 0) continue;
    return {
      value,
      envName: candidate.name,
      legacyEnvName: candidate.legacy,
    };
  }
  return undefined;
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

const PUBLIC_BASE_URL_ENV: EnvCandidate[] = [
  { name: "COMPUTER_LINKER_PUBLIC_BASE_URL", legacy: false },
  { name: "WORKSPACE_LINKER_PUBLIC_BASE_URL", legacy: true },
  { name: "LOCALPORT_PUBLIC_BASE_URL", legacy: true },
];

const OWNER_TOKEN_ENV: EnvCandidate[] = [
  { name: "COMPUTER_LINKER_OWNER_TOKEN", legacy: false },
  { name: "WORKSPACE_LINKER_OWNER_TOKEN", legacy: true },
  { name: "LOCALPORT_OWNER_TOKEN", legacy: true },
];
