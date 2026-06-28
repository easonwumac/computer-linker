import { basename, dirname } from "node:path";
import { operationError } from "./operation-errors.js";
import type { WorkspacePolicy } from "./permissions.js";

const SENSITIVE_DIRECTORY_NAMES = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".gcloud",
  ".gnupg",
  ".ssh",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
  "service-account.json",
]);

const ALLOWED_EXAMPLE_FILE_NAMES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

export const ALLOWED_SENSITIVE_EXAMPLE_FILE_NAMES = [...ALLOWED_EXAMPLE_FILE_NAMES].sort();

const SENSITIVE_EXTENSIONS = [
  ".key",
  ".kdbx",
  ".p12",
  ".pem",
  ".pfx",
];

export const SENSITIVE_FILE_RG_GLOBS = [
  "!**/.aws/**",
  "!**/.azure/**",
  "!**/.docker/config.json",
  "!**/.env",
  "!**/.env.*",
  "!**/.gcloud/**",
  "!**/.gnupg/**",
  "!**/.netrc",
  "!**/.npmrc",
  "!**/.pypirc",
  "!**/.ssh/**",
  "!**/*credentials*.json",
  "!**/*secret*.json",
  "!**/*.kdbx",
  "!**/*.key",
  "!**/*.p12",
  "!**/*.pem",
  "!**/*.pfx",
  "!**/id_dsa",
  "!**/id_ecdsa",
  "!**/id_ed25519",
  "!**/id_rsa",
  "!**/service-account*.json",
];

export function sensitiveFileRgGlobArgs(): string[] {
  return SENSITIVE_FILE_RG_GLOBS.flatMap((glob) => ["--glob", glob]);
}

export function isSensitiveWorkspacePath(path: string): boolean {
  const portablePath = path.replaceAll("\\", "/");
  const parts = portablePath.split("/").filter(Boolean);
  if (parts.length === 0) return false;

  if (parts.some((part) => SENSITIVE_DIRECTORY_NAMES.has(part.toLowerCase()))) {
    const base = parts.at(-1)?.toLowerCase() ?? "";
    if (base === "known_hosts" || base.endsWith(".pub")) return false;
    return true;
  }

  const name = basename(portablePath).toLowerCase();
  if (ALLOWED_EXAMPLE_FILE_NAMES.has(name)) return false;
  if (SENSITIVE_FILE_NAMES.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  if (SENSITIVE_EXTENSIONS.some((extension) => name.endsWith(extension))) return true;
  if (/(^|[-_.])(secret|secrets|credential|credentials)([-_.]|$)/i.test(name)) return true;
  if (/^service-account[-_.].*\.json$/i.test(name)) return true;

  const parent = basename(dirname(portablePath)).toLowerCase();
  return parent === ".docker" && name === "config.json";
}

export function assertNonSensitiveWorkspacePath(path: string, operation = "read"): void {
  if (!isSensitiveWorkspacePath(path)) return;
  throw operationError("permission_denied",
    `Sensitive file ${operation} is blocked by default: ${path}. ` +
      "Move secrets outside the workspace before exposing it to an MCP client.",
  );
}

export interface SensitivePathPolicySummary {
  contentReads: "blocked";
  textSearch: "excluded";
  metadata: "hidden" | "visible";
  writes: "blocked" | "allowed";
  allowedExampleFiles: string[];
  policyFlags: {
    allowSensitivePathMetadata: boolean;
    allowSensitivePathWrites: boolean;
  };
}

export function sensitivePathPolicySummary(policy: WorkspacePolicy | undefined): SensitivePathPolicySummary {
  return {
    contentReads: "blocked",
    textSearch: "excluded",
    metadata: policy?.allowSensitivePathMetadata ? "visible" : "hidden",
    writes: policy?.allowSensitivePathWrites ? "allowed" : "blocked",
    allowedExampleFiles: ALLOWED_SENSITIVE_EXAMPLE_FILE_NAMES,
    policyFlags: {
      allowSensitivePathMetadata: policy?.allowSensitivePathMetadata === true,
      allowSensitivePathWrites: policy?.allowSensitivePathWrites === true,
    },
  };
}

export function canExposeSensitivePathMetadata(path: string, policy: WorkspacePolicy | undefined): boolean {
  return !isSensitiveWorkspacePath(path) || policy?.allowSensitivePathMetadata === true;
}

export function canMutateSensitivePath(path: string, policy: WorkspacePolicy | undefined): boolean {
  return !isSensitiveWorkspacePath(path) || policy?.allowSensitivePathWrites === true;
}

export function assertSensitivePathMetadataAllowed(
  path: string,
  policy: WorkspacePolicy | undefined,
  operation = "metadata",
): void {
  if (canExposeSensitivePathMetadata(path, policy)) return;
  throw operationError(
    "permission_denied",
    `Sensitive path ${operation} metadata is hidden by default: ${path}. ` +
      "Set workspace policy allowSensitivePathMetadata=true to expose sensitive path names, sizes, and timestamps.",
  );
}

export function assertSensitivePathMutationAllowed(
  path: string,
  policy: WorkspacePolicy | undefined,
  operation = "write",
): void {
  if (canMutateSensitivePath(path, policy)) return;
  throw operationError(
    "permission_denied",
    `Sensitive path ${operation} is blocked by default: ${path}. ` +
      "Set workspace policy allowSensitivePathWrites=true to mutate sensitive paths.",
  );
}
