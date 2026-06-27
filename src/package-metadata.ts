import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageMetadata {
  name: string;
  version: string;
}

let cachedPackageMetadata: PackageMetadata | undefined;

export function packageMetadata(): PackageMetadata {
  if (cachedPackageMetadata) return cachedPackageMetadata;
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    const value = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    cachedPackageMetadata = {
      name: typeof value.name === "string" && value.name.trim() ? value.name : "@easonwumac/computer-linker",
      version: typeof value.version === "string" && value.version.trim() ? value.version : "unknown",
    };
  } catch {
    cachedPackageMetadata = { name: "@easonwumac/computer-linker", version: "unknown" };
  }
  return cachedPackageMetadata;
}

export function computerLinkerVersion(): string {
  return packageMetadata().version;
}

export const workspaceLinkerVersion = computerLinkerVersion;
