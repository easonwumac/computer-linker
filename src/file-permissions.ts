import { chmodSync, existsSync, statSync } from "node:fs";

export type FilePermissionStatus = "missing" | "ok" | "repaired" | "not_applicable" | "error";

export interface FilePermissionResult {
  path: string;
  exists: boolean;
  platform: NodeJS.Platform;
  desiredMode: string;
  mode: string | null;
  status: FilePermissionStatus;
  changed: boolean;
  error?: string;
}

export function securePrivateFile(path: string, desiredMode = 0o600): FilePermissionResult {
  const desired = desiredMode & 0o777;
  const desiredText = formatMode(desired);
  const platform = process.platform;
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      platform,
      desiredMode: desiredText,
      mode: null,
      status: "missing",
      changed: false,
    };
  }

  let currentMode: number | undefined;
  try {
    const stats = statSync(path);
    currentMode = stats.mode & 0o777;
    if (!stats.isFile()) {
      return {
        path,
        exists: true,
        platform,
        desiredMode: desiredText,
        mode: formatMode(currentMode),
        status: "error",
        changed: false,
        error: "path is not a file",
      };
    }
  } catch (error) {
    return {
      path,
      exists: true,
      platform,
      desiredMode: desiredText,
      mode: null,
      status: "error",
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (platform === "win32") {
    return {
      path,
      exists: true,
      platform,
      desiredMode: desiredText,
      mode: formatMode(currentMode),
      status: "not_applicable",
      changed: false,
    };
  }

  if (currentMode === desired) {
    return {
      path,
      exists: true,
      platform,
      desiredMode: desiredText,
      mode: formatMode(currentMode),
      status: "ok",
      changed: false,
    };
  }

  try {
    chmodSync(path, desired);
    return {
      path,
      exists: true,
      platform,
      desiredMode: desiredText,
      mode: formatMode(desired),
      status: "repaired",
      changed: true,
    };
  } catch (error) {
    return {
      path,
      exists: true,
      platform,
      desiredMode: desiredText,
      mode: formatMode(currentMode),
      status: "error",
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatMode(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}
