import { existsSync, mkdirSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export function ensureWorkspaceRootDirectory(path: string): string {
  const resolvedPath = resolve(path);
  if (existsSync(resolvedPath) && !directoryExistsSync(resolvedPath)) {
    throw new Error(`Workspace root must be a directory: ${resolvedPath}`);
  }
  mkdirSync(resolvedPath, { recursive: true });
  return resolvedPath;
}

export async function assertConfiguredWorkspaceRootDirectory(path: string): Promise<void> {
  if (await directoryExists(path)) return;
  throw new Error(`Configured workspace root does not exist or is not a directory: ${path}`);
}

function directoryExistsSync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
