import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertPermission,
  findExposedPath,
  isPathInsideRoot,
  normalizeConfig,
  PermissionDeniedError,
} from "./permissions.js";
import { WorkspaceRegistry } from "./workspaces.js";

const root = await mkdtemp(join(tmpdir(), "localport-test-"));
const outsideRoot = await mkdtemp(join(tmpdir(), "localport-outside-test-"));

try {
  const config = normalizeConfig({
    machineName: "test-machine",
    workspaces: [
      {
        id: "read-only",
        name: "Read only",
        path: root,
        permissions: {
          read: true,
          write: false,
          shell: false,
          codex: false,
        },
      },
      {
        id: "writable",
        name: "Writable",
        path: root,
        permissions: {
          read: true,
          write: true,
          shell: false,
          codex: false,
        },
        policy: {
          maxRuntimeSeconds: 999999,
          maxOutputBytes: 999999999,
          allowedCommands: [" node * ", "node *", ""],
          deniedCommands: [" rm -rf / "],
        },
      },
    ],
  });
  assert.deepEqual(config.workspaces[1].policy, {
    maxRuntimeSeconds: 86400,
    maxOutputBytes: 10 * 1024 * 1024,
    allowedCommands: ["node *"],
    deniedCommands: ["rm -rf /"],
  });

  assert.throws(
    () => normalizeConfig({
      machineName: "test-machine",
      workspaces: [
        {
          id: "same",
          name: "Same",
          path: root,
          permissions: { read: true, write: false, shell: false, codex: false },
        },
        {
          id: "same",
          name: "Same again",
          path: join(root, "nested"),
          permissions: { read: true, write: false, shell: false, codex: false },
        },
      ],
    }),
    /Duplicate workspace id: same/,
  );

  assert.throws(
    () => normalizeConfig({
      machineName: "test-machine",
      workspaces: [
        {
          id: " ",
          name: "Blank",
          path: root,
          permissions: { read: true, write: false, shell: false, codex: false },
        },
      ],
    }),
    /Workspace id is required/,
  );

  const nestedConfig = normalizeConfig({
    machineName: "test-machine",
    workspaces: [
      {
        id: "root",
        name: "Root",
        path: root,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
      {
        id: "project",
        name: "Project",
        path: join(root, "project"),
        permissions: { read: true, write: true, shell: false, codex: false },
      },
    ],
  });
  assert.equal(findExposedPath(nestedConfig, join(root, "project/src/index.ts")).id, "project");

  assert.equal(isPathInsideRoot(join(root, "project"), root), true);
  assert.equal(isPathInsideRoot(resolve(root, ".."), root), false);
  assert.equal(findExposedPath(config, join(root, "project")).id, "read-only");
  assert.throws(() => findExposedPath(config, resolve(root, "..")), PermissionDeniedError);

  const exposedPath = findExposedPath(config, root);
  assert.doesNotThrow(() => assertPermission(exposedPath, "read"));
  assert.throws(() => assertPermission(exposedPath, "write"), PermissionDeniedError);

  const registry = new WorkspaceRegistry(config);
  const candidates = await registry.listWorkspaceCandidates();
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["read-only", "writable"]);

  const workspace = await registry.openWorkspace("read-only");
  assert.equal(workspace.root, await realpath(root));
  await assert.rejects(() => registry.writeFile(workspace.id, "test.txt", "blocked"), PermissionDeniedError);
  await assert.rejects(() => registry.createDirectory(workspace.id, "blocked"), PermissionDeniedError);

  const writable = await registry.openWorkspace("writable");
  await registry.createDirectory(writable.id, "nested");
  await registry.writeFile(writable.id, "nested/file.txt", "content");
  await registry.createDirectory(writable.id, "nested/deep");
  await registry.writeFile(writable.id, "nested/deep/hidden.txt", "hidden");
  await registry.createDirectory(writable.id, "node_modules/pkg");
  await registry.writeFile(writable.id, "node_modules/pkg/index.js", "skip");
  await registry.writeFile(writable.id, "AGENTS.md", "root guidance");
  await registry.writeFile(writable.id, "nested/CLAUDE.md", "nested guidance");
  await writeFile(join(outsideRoot, "secret.txt"), "secret");
  if (await tryCreateSymlink(join(outsideRoot, "secret.txt"), join(root, "secret-link.txt"), "file")) {
    await assert.rejects(() => registry.readFile(writable.id, "secret-link.txt"), /resolves outside workspace/);
    await assert.rejects(() => registry.writeFile(writable.id, "secret-link.txt", "leak"), /resolves outside workspace/);
    await assert.rejects(() => registry.statPath(writable.id, "secret-link.txt"), /resolves outside workspace/);
  }
  if (await tryCreateSymlink(outsideRoot, join(root, "outside-dir-link"), process.platform === "win32" ? "junction" : "dir")) {
    await assert.rejects(() => registry.listDirectoryEntries(writable.id, "outside-dir-link"), /resolves outside workspace/);
  }
  const details = await registry.listDirectoryEntries(writable.id, "nested");
  assert.ok(details.some((entry) => entry.name === "file.txt" && entry.type === "file"));
  const tree = await registry.tree(writable.id, ".", { maxDepth: 2, maxEntries: 20 });
  assert.ok(tree.some((entry) => entry.path === "nested"));
  assert.ok(tree.some((entry) => entry.path === "nested/file.txt"));
  assert.ok(tree.some((entry) => entry.path === "nested/deep"));
  assert.equal(tree.some((entry) => entry.path.startsWith("node_modules")), false);
  const directoryOnlyTree = await registry.tree(writable.id, ".", { maxDepth: 2, includeFiles: false });
  assert.ok(directoryOnlyTree.every((entry) => entry.type === "directory"));
  const instructions = await registry.instructions(writable.id, "nested/deep/hidden.txt", { maxBytes: 8 });
  assert.deepEqual(instructions.map((entry) => entry.path), ["AGENTS.md", "nested/CLAUDE.md"]);
  assert.equal(instructions[0].content, "root gui");
  assert.equal(instructions[0].truncated, true);
  assert.equal(instructions[1].content, "nested g");
  const fileDetails = details.find((entry) => entry.name === "file.txt");
  assert.equal(fileDetails?.type, "file");
  assert.equal((await registry.statPath(writable.id, "nested/file.txt")).size, "content".length);

  await registry.movePath(writable.id, "nested/file.txt", "nested/moved.txt");
  assert.equal(await readFile(join(root, "nested/moved.txt"), "utf8"), "content");
  assert.rejects(() => registry.deletePath(writable.id, ".", true), /workspace root/);
  await registry.deletePath(writable.id, "nested/moved.txt");
  await registry.deletePath(writable.id, "nested", true);
  await writeFile(join(root, "outside-guard.txt"), "guard");
  await assert.rejects(() => registry.movePath(writable.id, "outside-guard.txt", "../outside.txt"), /outside workspace root/);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
}

async function tryCreateSymlink(
  target: string,
  path: string,
  type: "dir" | "file" | "junction",
): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error) {
    if (isSymlinkPrivilegeError(error)) return false;
    throw error;
  }
}

function isSymlinkPrivilegeError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    ["EACCES", "ENOSYS", "EPERM"].includes(String((error as { code?: unknown }).code));
}
