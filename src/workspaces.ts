import { randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, readFile as readFsFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  assertPermission,
  findExposedPath,
  isPathInsideRoot,
  type LocalPortConfig,
  type ResolvedExposedPath,
} from "./permissions.js";
import { operationError } from "./operation-errors.js";
import {
  assertNonSensitiveWorkspacePath,
  assertSensitivePathMetadataAllowed,
  assertSensitivePathMutationAllowed,
  canExposeSensitivePathMetadata,
  isSensitiveWorkspacePath,
} from "./sensitive-files.js";
import { assertConfiguredWorkspaceRootDirectory } from "./workspace-roots.js";

export interface Workspace {
  id: string;
  root: string;
  exposedPath: ResolvedExposedPath;
}

export interface WorkspaceCandidate {
  path: string;
  id: string;
  name: string;
  permissions: ResolvedExposedPath["permissions"];
}

export interface WorkspacePathInfo {
  path: string;
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
}

export interface WorkspaceTreeOptions {
  maxDepth?: number;
  maxEntries?: number;
  includeFiles?: boolean;
}

export interface WorkspaceInstructionFile {
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface WorkspaceInstructionsOptions {
  maxBytes?: number;
}

export interface WorkspaceWriteOptions {
  createParents?: boolean;
}

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(private readonly config: LocalPortConfig) {}

  listDefinedWorkspaces(): ResolvedExposedPath[] {
    return this.config.workspaces.map((entry) => ({
      ...entry,
      path: resolve(entry.path),
    }));
  }

  async listWorkspaceCandidates(): Promise<WorkspaceCandidate[]> {
    return this.listDefinedWorkspaces()
      .filter((workspace) => workspace.permissions.read)
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        permissions: workspace.permissions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async openWorkspace(workspaceRef: string): Promise<Workspace> {
    const exposedPath = this.findWorkspaceByRef(workspaceRef);
    assertPermission(exposedPath, "read");

    await assertConfiguredWorkspaceRootDirectory(exposedPath.path);
    const realRoot = await realpath(exposedPath.path);

    const workspace: Workspace = {
      id: `ws_${randomUUID()}`,
      root: realRoot,
      exposedPath: {
        ...exposedPath,
        path: realRoot,
      },
    };
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  private findWorkspaceByRef(workspaceRef: string): ResolvedExposedPath {
    const resolvedRef = resolve(workspaceRef);
    const workspace = this.listDefinedWorkspaces().find(
      (entry) =>
        entry.id === workspaceRef ||
        entry.name === workspaceRef ||
        entry.path === resolvedRef,
    );
    if (!workspace) {
      throw operationError("unknown_scope", `Unknown configured workspace: ${workspaceRef}`);
    }
    return workspace;
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw operationError("unknown_scope", `Unknown workspaceId: ${workspaceId}`);
    return workspace;
  }

  resolvePath(workspace: Workspace, inputPath: string): string {
    const absolutePath = resolve(workspace.root, inputPath);
    if (!isPathInsideRoot(absolutePath, workspace.root)) {
      throw operationError("path_out_of_scope", `Path is outside workspace root: ${inputPath}`);
    }
    if (!isPathInsideRoot(absolutePath, workspace.exposedPath.path)) {
      throw operationError("path_out_of_scope", `Path is outside exposed path: ${inputPath}`);
    }
    return absolutePath;
  }

  async resolveExistingPath(workspace: Workspace, inputPath: string): Promise<string> {
    const absolutePath = this.resolvePath(workspace, inputPath);
    await assertRealPathInside(workspace, absolutePath, inputPath);
    return absolutePath;
  }

  async resolveWritablePath(workspace: Workspace, inputPath: string, options: WorkspaceWriteOptions = {}): Promise<string> {
    const absolutePath = this.resolvePath(workspace, inputPath);
    try {
      await assertRealPathInside(workspace, absolutePath, inputPath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      if (await pathExists(absolutePath)) throw error;
      const parentPath = dirname(absolutePath);
      if (options.createParents) {
        await assertRealPathInside(workspace, await nearestExistingParent(parentPath), inputPath);
      } else {
        try {
          await assertRealPathInside(workspace, parentPath, dirname(inputPath));
        } catch (parentError) {
          if (isNotFoundError(parentError)) {
            throw operationError(
              "invalid_request",
              `Parent directory does not exist: ${dirname(inputPath)}. Use createParents=true to create missing parents intentionally.`,
              { cause: parentError },
            );
          }
          throw parentError;
        }
      }
    }
    return absolutePath;
  }

  async readFile(workspaceId: string, path: string): Promise<string> {
    return decodeUtf8Bytes(await this.readFileBytes(workspaceId, path), path);
  }

  async readFileBytes(workspaceId: string, path: string): Promise<Buffer> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "read");
    const absolutePath = await this.resolveExistingPath(workspace, path);
    assertNonSensitiveWorkspacePath(formatWorkspacePath(absolutePath, workspace), "read");
    return readFsFile(absolutePath);
  }

  async writeFile(workspaceId: string, path: string, content: string, options: WorkspaceWriteOptions = {}): Promise<void> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const absolutePath = await this.resolveWritablePath(workspace, path, options);
    assertSensitivePathMutationAllowed(formatWorkspacePath(absolutePath, workspace), workspace.exposedPath.policy, "write");
    if (options.createParents) await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  async createFile(workspaceId: string, path: string, content: string, options: WorkspaceWriteOptions = {}): Promise<void> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const absolutePath = await this.resolveWritablePath(workspace, path, options);
    assertSensitivePathMutationAllowed(formatWorkspacePath(absolutePath, workspace), workspace.exposedPath.policy, "create");
    if (options.createParents) await mkdir(dirname(absolutePath), { recursive: true });
    try {
      await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "EEXIST") {
        throw new Error(`File already exists: ${path}`);
      }
      throw error;
    }
  }

  async readFileForMutationCheck(workspaceId: string, path: string): Promise<string> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const absolutePath = await this.resolveExistingPath(workspace, path);
    assertSensitivePathMutationAllowed(formatWorkspacePath(absolutePath, workspace), workspace.exposedPath.policy, "write");
    return decodeUtf8Bytes(await readFsFile(absolutePath), path);
  }

  async editFile(workspaceId: string, path: string, oldText: string, newText: string): Promise<number> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const current = await this.readFileForMutationCheck(workspaceId, path);
    const matches = current.split(oldText).length - 1;
    if (matches !== 1) {
      throw new Error(`edit_file expected exactly one match, found ${matches}`);
    }

    await this.writeFile(workspaceId, path, current.replace(oldText, newText));
    return matches;
  }

  async listDirectory(workspaceId: string, path: string): Promise<string[]> {
    return (await this.listDirectoryEntries(workspaceId, path))
      .map((entry) => `${entry.name}${entry.type === "directory" ? "/" : ""}`);
  }

  async listDirectoryEntries(workspaceId: string, path: string): Promise<WorkspacePathInfo[]> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "read");
    const directory = await this.resolveExistingPath(workspace, path);
    assertSensitivePathMetadataAllowed(formatWorkspacePath(directory, workspace), workspace.exposedPath.policy, "list");
    const entries = await opendir(directory);
    const results: WorkspacePathInfo[] = [];
    for await (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const workspacePath = formatWorkspacePath(entryPath, workspace);
      if (!canExposeSensitivePathMetadata(workspacePath, workspace.exposedPath.policy)) continue;
      results.push(await pathInfo(entryPath, workspace));
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async tree(workspaceId: string, path: string, options: WorkspaceTreeOptions = {}): Promise<WorkspacePathInfo[]> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "read");
    const root = await this.resolveExistingPath(workspace, path);
    assertSensitivePathMetadataAllowed(formatWorkspacePath(root, workspace), workspace.exposedPath.policy, "tree");
    const maxDepth = normalizePositiveInteger(options.maxDepth, 2, 1000);
    const maxEntries = normalizePositiveInteger(options.maxEntries, 200, 1000);
    const includeFiles = options.includeFiles ?? true;
    const results: WorkspacePathInfo[] = [];

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (results.length >= maxEntries) return;
      let entries;
      try {
        entries = await opendir(directory);
      } catch {
        return;
      }

      const paths: string[] = [];
      for await (const entry of entries) {
        if (entry.isDirectory() && SKIPPED_TREE_DIRECTORIES.has(entry.name)) continue;
        paths.push(join(directory, entry.name));
      }
      paths.sort((a, b) => basename(a).localeCompare(basename(b)));

      for (const entryPath of paths) {
        if (results.length >= maxEntries) return;
        const workspacePath = formatWorkspacePath(entryPath, workspace);
        if (!canExposeSensitivePathMetadata(workspacePath, workspace.exposedPath.policy)) continue;
        const info = await pathInfo(entryPath, workspace);
        if (includeFiles || info.type === "directory") results.push(info);
        if (info.type === "directory" && depth < maxDepth) {
          await walk(entryPath, depth + 1);
        }
      }
    };

    await walk(root, 1);
    return results;
  }

  async instructions(
    workspaceId: string,
    path: string,
    options: WorkspaceInstructionsOptions = {},
  ): Promise<WorkspaceInstructionFile[]> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "read");
    const target = await this.resolveInstructionTarget(workspace, path);
    const directory = await instructionSearchDirectory(target);
    const maxBytes = normalizePositiveInteger(options.maxBytes, 64 * 1024, 256 * 1024);
    const files: WorkspaceInstructionFile[] = [];

    for (const directoryPath of ancestorDirectories(workspace.root, directory)) {
      for (const name of INSTRUCTION_FILE_NAMES) {
        const instructionPath = join(directoryPath, name);
        try {
          const info = await lstat(instructionPath);
          if (!info.isFile()) continue;
          const content = await readFsFile(instructionPath, "utf8");
          files.push({
            path: formatWorkspacePath(instructionPath, workspace),
            name,
            content: content.slice(0, maxBytes),
            size: info.size,
            truncated: info.size > maxBytes,
          });
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          // Missing instruction files are expected in most directories.
        }
      }
    }

    return files;
  }

  async statPath(workspaceId: string, path: string): Promise<WorkspacePathInfo> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "read");
    const absolutePath = this.resolvePath(workspace, path);
    await assertRealPathInside(workspace, absolutePath, path);
    assertSensitivePathMetadataAllowed(formatWorkspacePath(absolutePath, workspace), workspace.exposedPath.policy, "stat");
    return pathInfo(absolutePath, workspace);
  }

  private async resolveInstructionTarget(workspace: Workspace, inputPath: string): Promise<string> {
    const absolutePath = this.resolvePath(workspace, inputPath);
    try {
      await assertRealPathInside(workspace, absolutePath, inputPath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      if (await pathExists(absolutePath)) throw error;
      await assertRealPathInside(workspace, await nearestExistingParent(absolutePath), inputPath);
    }
    return absolutePath;
  }

  async createDirectory(workspaceId: string, path: string): Promise<void> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const absolutePath = this.resolvePath(workspace, path);
    await assertRealPathInside(workspace, await nearestExistingParent(absolutePath), path);
    assertSensitivePathMutationAllowed(formatWorkspacePath(absolutePath, workspace), workspace.exposedPath.policy, "mkdir");
    await mkdir(absolutePath, { recursive: true });
  }

  async deletePath(workspaceId: string, path: string, recursive = false): Promise<void> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const absolutePath = this.resolvePath(workspace, path);
    await assertRealPathInside(workspace, absolutePath, path);
    assertNotWorkspaceRoot(workspace, absolutePath, "delete");
    await assertSensitivePathTreeMutationAllowed(workspace, absolutePath, "delete");
    await rm(absolutePath, { recursive, force: false });
  }

  async movePath(workspaceId: string, fromPath: string, toPath: string): Promise<void> {
    const workspace = this.getWorkspace(workspaceId);
    assertPermission(workspace.exposedPath, "write");
    const absoluteFromPath = this.resolvePath(workspace, fromPath);
    const absoluteToPath = await this.resolveWritablePath(workspace, toPath);
    await assertRealPathInside(workspace, absoluteFromPath, fromPath);
    assertNotWorkspaceRoot(workspace, absoluteFromPath, "move");
    await assertSensitivePathTreeMutationAllowed(workspace, absoluteFromPath, "move");
    assertSensitivePathMutationAllowed(formatWorkspacePath(absoluteToPath, workspace), workspace.exposedPath.policy, "move");
    await mkdir(dirname(absoluteToPath), { recursive: true });
    await rename(absoluteFromPath, absoluteToPath);
  }
}

export function formatWorkspacePath(path: string, workspace: Workspace): string {
  const relationship = relative(workspace.root, path);
  return relationship ? relationship.split(sep).join("/") : ".";
}

async function pathInfo(path: string, workspace: Workspace): Promise<WorkspacePathInfo> {
  const info = await lstat(path);
  return {
    path: formatWorkspacePath(path, workspace),
    name: basename(path) || ".",
    type: info.isDirectory() ? "directory" : info.isFile() ? "file" : info.isSymbolicLink() ? "symlink" : "other",
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
  };
}

function assertNotWorkspaceRoot(workspace: Workspace, path: string, action: string): void {
  if (resolve(path) !== resolve(workspace.root)) return;
  throw operationError("permission_denied", `Refusing to ${action} the workspace root`);
}

async function assertRealPathInside(workspace: Workspace, path: string, inputPath: string): Promise<void> {
  const realPath = await realpath(path);
  if (!isPathInsideRoot(realPath, workspace.root) || !isPathInsideRoot(realPath, workspace.exposedPath.path)) {
    throw operationError("path_out_of_scope", `Path resolves outside workspace: ${inputPath}`);
  }
}

async function assertSensitivePathTreeMutationAllowed(workspace: Workspace, path: string, operation: string): Promise<void> {
  const workspacePath = formatWorkspacePath(path, workspace);
  assertSensitivePathMutationAllowed(workspacePath, workspace.exposedPath.policy, operation);
  if (workspace.exposedPath.policy?.allowSensitivePathWrites === true) return;
  let info;
  try {
    info = await lstat(path);
  } catch {
    return;
  }
  if (!info.isDirectory()) return;
  const sensitiveDescendants = await sensitiveDescendantPaths(path, workspace);
  if (sensitiveDescendants.length === 0) return;
  throw operationError(
    "permission_denied",
    `Sensitive path ${operation} is blocked by default: ${workspacePath} contains ${sensitiveDescendants.join(", ")}. ` +
      "Set workspace policy allowSensitivePathWrites=true to mutate sensitive paths.",
  );
}

async function sensitiveDescendantPaths(root: string, workspace: Workspace): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    if (found.length >= 10) return;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      return;
    }
    for await (const entry of entries) {
      if (found.length >= 10) return;
      const entryPath = join(directory, entry.name);
      const workspacePath = formatWorkspacePath(entryPath, workspace);
      if (isSensitiveWorkspacePath(workspacePath)) {
        found.push(workspacePath);
        continue;
      }
      if (entry.isDirectory()) await walk(entryPath);
    }
  };
  await walk(root);
  return found;
}

async function nearestExistingParent(path: string): Promise<string> {
  let current = path;
  while (!(await pathExists(current))) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function decodeUtf8Bytes(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw operationError(
      "invalid_request",
      `File is not valid UTF-8 text: ${path}. Use encoding=base64 for binary reads.`,
      { cause: error },
    );
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? Math.min(value, max) : fallback;
}

async function instructionSearchDirectory(path: string): Promise<string> {
  try {
    const info = await lstat(path);
    return info.isDirectory() ? path : dirname(path);
  } catch {
    return dirname(path);
  }
}

function ancestorDirectories(root: string, directory: string): string[] {
  const resolvedRoot = resolve(root);
  let current = resolve(directory);
  const directories: string[] = [];

  while (isPathInsideRoot(current, resolvedRoot)) {
    directories.push(current);
    if (current === resolvedRoot) break;
    current = dirname(current);
  }

  return directories.reverse();
}

const SKIPPED_TREE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
]);

const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
