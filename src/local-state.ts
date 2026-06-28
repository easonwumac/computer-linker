import { join } from "node:path";
import { auditLogPath, codexRunsPath, configDir, configPath, oauthStatePath } from "./config.js";
import { securePrivateFile, type FilePermissionResult } from "./file-permissions.js";

export interface LocalStateFile {
  role: "config" | "audit-log" | "codex-runs" | "oauth-state" | "tunnel-state";
  path: string;
  desiredMode: number;
}

export interface LocalStatePermissionResult extends FilePermissionResult {
  role: LocalStateFile["role"];
}

export interface LocalStatePermissionsReport {
  kind: "computer-linker-local-state-permissions";
  schemaVersion: 1;
  platform: NodeJS.Platform;
  checkedAt: string;
  repaired: boolean;
  files: LocalStatePermissionResult[];
  warnings: string[];
}

export function localStateFiles(): LocalStateFile[] {
  return [
    { role: "config", path: configPath(), desiredMode: 0o600 },
    { role: "audit-log", path: auditLogPath(), desiredMode: 0o600 },
    { role: "codex-runs", path: codexRunsPath(), desiredMode: 0o600 },
    { role: "oauth-state", path: oauthStatePath(), desiredMode: 0o600 },
    { role: "tunnel-state", path: join(configDir(), "tunnels.json"), desiredMode: 0o600 },
  ];
}

export function localStatePermissionsReport(): LocalStatePermissionsReport {
  const files = localStateFiles().map((file) => ({
    role: file.role,
    ...securePrivateFile(file.path, file.desiredMode),
  }));
  return {
    kind: "computer-linker-local-state-permissions",
    schemaVersion: 1,
    platform: process.platform,
    checkedAt: new Date().toISOString(),
    repaired: files.some((file) => file.changed),
    files,
    warnings: localStatePermissionWarnings(files),
  };
}

function localStatePermissionWarnings(files: LocalStatePermissionResult[]): string[] {
  if (process.platform === "win32") {
    return ["POSIX chmod checks are not enforced on Windows; keep the config directory under your user profile."];
  }
  return files.flatMap((file) => (
    file.status === "error"
      ? [`${file.role} permission check failed: ${file.error ?? "unknown error"}`]
      : []
  ));
}
