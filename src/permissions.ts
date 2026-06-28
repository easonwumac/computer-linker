import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { relative, resolve, sep } from "node:path";
import { OperationError, type OperationErrorCode } from "./operation-errors.js";

export interface PathPermissions {
  read: boolean;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen?: boolean;
}

export interface WorkspacePolicy {
  maxRuntimeSeconds?: number;
  maxOutputBytes?: number;
  allowedCommands?: string[];
  deniedCommands?: string[];
  allowShellMetacharacters?: boolean;
  allowSensitivePathMetadata?: boolean;
  allowSensitivePathWrites?: boolean;
}

export interface ExposedPathConfig {
  id: string;
  name: string;
  path: string;
  permissions: PathPermissions;
  policy?: WorkspacePolicy;
}

export interface LocalPortConfig {
  machineId?: string;
  machineName: string;
  host?: string;
  port?: number;
  publicBaseUrl?: string;
  publicMcpOnly?: boolean;
  ownerToken?: string;
  workspaces: ExposedPathConfig[];
}

export interface ResolvedExposedPath extends ExposedPathConfig {
  path: string;
}

export class PermissionDeniedError extends OperationError {
  constructor(
    message: string,
    code: Extract<OperationErrorCode, "permission_denied" | "path_out_of_scope"> = "permission_denied",
  ) {
    super(code, message);
    this.name = "PermissionDeniedError";
  }
}

export function defaultConfig(): LocalPortConfig {
  return {
    machineId: generateMachineId(),
    machineName: hostname().trim() || "local-computer",
    host: "127.0.0.1",
    port: 3939,
    publicBaseUrl: undefined,
    publicMcpOnly: false,
    ownerToken: undefined,
    workspaces: [
      {
        id: "current",
        name: "Current directory",
        path: process.cwd(),
        permissions: {
          read: true,
          write: false,
          shell: false,
          codex: false,
          screen: false,
        },
      },
    ],
  };
}

export function isBootstrapDefaultWorkspace(workspace: ExposedPathConfig): boolean {
  return isSafeBootstrapDefaultWorkspace(workspace) || isLegacyUnsafeBootstrapDefaultWorkspace(workspace);
}

export function isSafeBootstrapDefaultWorkspace(workspace: ExposedPathConfig): boolean {
  return isBootstrapCurrentDirectoryBase(workspace) &&
    workspace.permissions.read === true &&
    workspace.permissions.write === false &&
    workspace.permissions.shell === false &&
    workspace.permissions.codex === false &&
    Boolean(workspace.permissions.screen) === false;
}

export function isLegacyUnsafeBootstrapDefaultWorkspace(workspace: ExposedPathConfig): boolean {
  return isBootstrapCurrentDirectoryBase(workspace) &&
    workspace.permissions.read === true &&
    workspace.permissions.write === true &&
    workspace.permissions.shell === true &&
    workspace.permissions.codex === false &&
    Boolean(workspace.permissions.screen) === false;
}

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

function isBootstrapCurrentDirectoryBase(workspace: ExposedPathConfig): boolean {
  return workspace.id === "current" &&
    workspace.name === "Current directory" &&
    resolve(expandHomePath(workspace.path)) === resolve(process.cwd()) &&
    !workspace.policy;
}

export function normalizeConfig(config: LocalPortConfig): LocalPortConfig {
  const workspaces = config.workspaces.map((entry) => ({
    ...entry,
    id: entry.id.trim(),
    name: entry.name.trim() || entry.id.trim(),
    path: resolve(expandHomePath(entry.path)),
    permissions: {
      read: Boolean(entry.permissions.read),
      write: Boolean(entry.permissions.write),
      shell: Boolean(entry.permissions.shell),
      codex: Boolean(entry.permissions.codex),
      screen: Boolean(entry.permissions.screen),
    },
    policy: normalizeWorkspacePolicy(entry.policy),
  }));
  assertUniqueWorkspaceIds(workspaces);

  return {
    machineId: config.machineId?.trim() || generateMachineId(),
    machineName: config.machineName?.trim() || hostname().trim() || "local-computer",
    host: config.host?.trim() || "127.0.0.1",
    port: normalizePort(config.port),
    publicBaseUrl: config.publicBaseUrl?.trim() || undefined,
    publicMcpOnly: Boolean(config.publicMcpOnly),
    ownerToken: config.ownerToken?.trim() || undefined,
    workspaces,
  };
}

function normalizeWorkspacePolicy(policy: WorkspacePolicy | undefined): WorkspacePolicy | undefined {
  if (!policy) return undefined;
  const normalized: WorkspacePolicy = {};
  const maxRuntimeSeconds = normalizePositiveInteger(policy.maxRuntimeSeconds, 24 * 60 * 60);
  const maxOutputBytes = normalizePositiveInteger(policy.maxOutputBytes, 10 * 1024 * 1024);
  const allowedCommands = normalizeStringList(policy.allowedCommands);
  const deniedCommands = normalizeStringList(policy.deniedCommands);

  if (maxRuntimeSeconds !== undefined) normalized.maxRuntimeSeconds = maxRuntimeSeconds;
  if (maxOutputBytes !== undefined) normalized.maxOutputBytes = maxOutputBytes;
  if (allowedCommands.length > 0) normalized.allowedCommands = allowedCommands;
  if (deniedCommands.length > 0) normalized.deniedCommands = deniedCommands;
  if (typeof policy.allowShellMetacharacters === "boolean") {
    normalized.allowShellMetacharacters = policy.allowShellMetacharacters;
  }
  if (typeof policy.allowSensitivePathMetadata === "boolean") {
    normalized.allowSensitivePathMetadata = policy.allowSensitivePathMetadata;
  }
  if (typeof policy.allowSensitivePathWrites === "boolean") {
    normalized.allowSensitivePathWrites = policy.allowSensitivePathWrites;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizePositiveInteger(value: number | undefined, max: number): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0 ? Math.min(value, max) : undefined;
}

function normalizeStringList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item.trim().replace(/\s+/g, " ") : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized.slice(0, 100);
}

export function generateMachineId(): string {
  return `machine_${randomUUID()}`;
}

function assertUniqueWorkspaceIds(workspaces: ExposedPathConfig[]): void {
  const seen = new Set<string>();
  for (const workspace of workspaces) {
    if (!workspace.id) throw new Error("Workspace id is required");
    if (seen.has(workspace.id)) throw new Error(`Duplicate workspace id: ${workspace.id}`);
    seen.add(workspace.id);
  }
}

function normalizePort(port: number | undefined): number {
  if (port === undefined) return 3939;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return port;
}

export function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(expandHomePath(path));
  const resolvedRoot = resolve(expandHomePath(root));
  const relationship = relative(resolvedRoot, resolvedPath);

  return (
    relationship === "" ||
    (!relationship.startsWith("..") && relationship !== ".." && !relationship.includes(`..${sep}`))
  );
}

export function findExposedPath(config: LocalPortConfig, path: string): ResolvedExposedPath {
  const resolvedPath = resolve(expandHomePath(path));
  const match = config.workspaces
    .filter((entry) => isPathInsideRoot(resolvedPath, entry.path))
    .sort((a, b) => resolve(expandHomePath(b.path)).length - resolve(expandHomePath(a.path)).length)[0];
  if (!match) {
    throw new PermissionDeniedError(`Path is outside exposed paths: ${path}`, "path_out_of_scope");
  }

  return {
    ...match,
    path: resolve(expandHomePath(match.path)),
  };
}

export function assertPermission(
  exposedPath: ResolvedExposedPath,
  permission: keyof PathPermissions,
): void {
  if (exposedPath.permissions[permission]) return;
  throw new PermissionDeniedError(
    `${permission} permission is disabled for exposed path ${exposedPath.id} (${exposedPath.path})`,
  );
}
