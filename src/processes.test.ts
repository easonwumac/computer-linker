import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupExitedManagedProcesses,
  listManagedProcesses,
  startManagedProcess,
  stopManagedProcessById,
  type ManagedProcessSnapshot,
} from "./processes.js";

const root = await mkdtemp(join(tmpdir(), "computer-linker-processes-test-"));
const workspace = { workspaceId: "app", workspaceRoot: root };
const runningProcessIds: string[] = [];

try {
  const exited = startManagedProcess({
    kind: "shell",
    ...workspace,
    cwd: root,
    command: process.execPath,
    args: ["-e", ""],
    commandPreview: "node -e empty",
  });
  await waitForProcess(exited.processId, "exited");

  const running = startManagedProcess({
    kind: "shell",
    ...workspace,
    cwd: root,
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 30000);"],
    commandPreview: "node -e wait",
  });
  runningProcessIds.push(running.processId);

  const ageCleanup = cleanupExitedManagedProcesses({
    nowMs: Date.now() + 2 * 60 * 60 * 1000,
    maxExitedAgeMs: 1000,
    maxExitedPerWorkspace: 50,
  });
  assert.ok(ageCleanup.removed >= 1);
  const afterAgeCleanup = listManagedProcesses(workspace);
  assert.ok(afterAgeCleanup.some((process) => process.processId === running.processId && process.status === "running"));
  assert.equal(afterAgeCleanup.some((process) => process.processId === exited.processId), false);

  for (const index of [1, 2, 3]) {
    const process = startManagedProcess({
      kind: "shell",
      ...workspace,
      cwd: root,
      command: processExecPath(),
      args: ["-e", ""],
      commandPreview: `node -e empty ${index}`,
    });
    await waitForProcess(process.processId, "exited");
  }
  const countCleanup = cleanupExitedManagedProcesses({
    nowMs: Date.now(),
    maxExitedAgeMs: Number.MAX_SAFE_INTEGER,
    maxExitedPerWorkspace: 2,
  });
  assert.equal(countCleanup.exitedKept, 2);
  assert.equal(listManagedProcesses(workspace).filter((process) => process.status === "exited").length, 2);
} finally {
  for (const processId of runningProcessIds) {
    await stopManagedProcessById(processId).catch(() => undefined);
  }
  cleanupExitedManagedProcesses({ nowMs: Date.now() + 2 * 60 * 60 * 1000, maxExitedAgeMs: 0, maxExitedPerWorkspace: 0 });
  await rm(root, { recursive: true, force: true });
}

async function waitForProcess(processId: string, status: ManagedProcessSnapshot["status"]): Promise<ManagedProcessSnapshot> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const process = listManagedProcesses(workspace).find((item) => item.processId === processId);
    if (process?.status === status) return process;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${processId} did not reach ${status}`);
}

function processExecPath(): string {
  return process.execPath;
}
