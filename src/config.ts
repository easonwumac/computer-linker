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
  const path = configPath();
  if (!existsSync(path)) {
    writeConfig(defaultConfig());
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalPortConfig;
    const normalized = normalizeConfig(withEnvOverrides(parsed));
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
  return path;
}

export function writeConfig(config: LocalPortConfig): string {
  const path = configPath();
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(normalizeConfig(config), null, 2) + "\n", { mode: 0o600 });
  return path;
}

export function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

function withEnvOverrides(config: LocalPortConfig): LocalPortConfig {
  return {
    ...config,
    publicBaseUrl: firstNonBlank(
      process.env.COMPUTER_LINKER_PUBLIC_BASE_URL,
      process.env.WORKSPACE_LINKER_PUBLIC_BASE_URL,
      process.env.LOCALPORT_PUBLIC_BASE_URL,
    ) ?? config.publicBaseUrl,
    ownerToken: firstNonBlank(
      process.env.COMPUTER_LINKER_OWNER_TOKEN,
      process.env.WORKSPACE_LINKER_OWNER_TOKEN,
      process.env.LOCALPORT_OWNER_TOKEN,
    ) ?? config.ownerToken,
  };
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}
