import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { executableCommand, shellCommand } from "./platform-shell.js";
import { managedProcessRetentionPolicy } from "./retention.js";

const defaultMaxOutputBytes = 128 * 1024;

export interface ManagedProcessSnapshot {
  processId: string;
  kind: "shell" | "codex";
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  commandPreview: string;
  pid?: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "exited";
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface ManagedProcess extends ManagedProcessSnapshot {
  child: ChildProcess;
  timer?: NodeJS.Timeout;
  maxOutputBytes: number;
}

const processes = new Map<string, ManagedProcess>();

export interface ManagedProcessRetentionOptions {
  nowMs?: number;
  maxExitedAgeMs?: number;
  maxExitedPerWorkspace?: number;
}

export interface ManagedProcessRetentionReport {
  scanned: number;
  removed: number;
  runningKept: number;
  exitedKept: number;
  maxExitedAgeMs: number;
  maxExitedPerWorkspace: number;
}

export function startManagedProcess(input: {
  kind: ManagedProcessSnapshot["kind"];
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  command: string;
  args?: string[];
  commandPreview: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string;
}): ManagedProcessSnapshot {
  cleanupExitedManagedProcesses();
  const processId = `proc_${randomUUID()}`;
  const detached = process.platform !== "win32";
  const command = input.args
    ? executableCommand(input.command, input.args)
    : shellCommand(input.command);
  const child = spawn(command.command, command.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached,
    windowsVerbatimArguments: command.windowsVerbatimArguments,
  });
  const managed: ManagedProcess = {
    child,
    processId,
    kind: input.kind,
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    cwd: input.cwd,
    commandPreview: input.commandPreview,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    maxOutputBytes: input.maxOutputBytes ?? defaultMaxOutputBytes,
  };
  processes.set(processId, managed);
  child.stdin.end(input.stdin ?? "");

  child.stdout.on("data", (chunk: Buffer) => {
    managed.stdout = appendBounded(managed.stdout, chunk.toString("utf8"), managed.maxOutputBytes);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    managed.stderr = appendBounded(managed.stderr, chunk.toString("utf8"), managed.maxOutputBytes);
  });
  child.stdin.on("error", (error) => {
    if (managed.status !== "running") return;
    managed.stderr = appendBounded(managed.stderr, `stdin error: ${error.message}\n`, managed.maxOutputBytes);
  });
  child.on("error", (error) => {
    if (managed.timer) clearTimeout(managed.timer);
    managed.status = "exited";
    managed.exitCode = null;
    managed.signal = undefined;
    managed.endedAt = new Date().toISOString();
    managed.stderr = appendBounded(managed.stderr, `${processStartErrorMessage(error)}\n`, managed.maxOutputBytes);
  });
  child.on("exit", (code, signal) => {
    if (managed.timer) clearTimeout(managed.timer);
    managed.status = "exited";
    managed.exitCode = code;
    managed.signal = signal ?? undefined;
    managed.endedAt = new Date().toISOString();
  });

  if (input.timeoutMs && input.timeoutMs > 0) {
    managed.timer = setTimeout(() => {
      if (managed.status !== "running") return;
      managed.timedOut = true;
      void stopProcess(managed, "SIGTERM");
    }, input.timeoutMs);
    managed.timer.unref();
  }

  return snapshot(managed);
}

export function listManagedProcesses(input: {
  workspaceId: string;
  workspaceRoot: string;
  kinds?: ManagedProcessSnapshot["kind"][];
}): ManagedProcessSnapshot[] {
  cleanupExitedManagedProcesses();
  return [...processes.values()]
    .filter((process) => process.workspaceId === input.workspaceId && process.workspaceRoot === input.workspaceRoot)
    .filter((process) => !input.kinds || input.kinds.includes(process.kind))
    .map(snapshot)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function listAllManagedProcesses(): ManagedProcessSnapshot[] {
  cleanupExitedManagedProcesses();
  return [...processes.values()]
    .map(snapshot)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function readManagedProcess(input: {
  processId: string;
  workspaceId: string;
  workspaceRoot: string;
  kinds?: ManagedProcessSnapshot["kind"][];
}): ManagedProcessSnapshot {
  cleanupExitedManagedProcesses();
  return snapshot(getProcessForWorkspace(input));
}

export async function stopManagedProcess(input: {
  processId: string;
  workspaceId: string;
  workspaceRoot: string;
  signal?: string;
  kinds?: ManagedProcessSnapshot["kind"][];
}): Promise<ManagedProcessSnapshot> {
  const process = getProcessForWorkspace(input);
  return stopProcess(process, normalizeSignal(input.signal));
}

export async function stopManagedProcessById(processId: string, signal?: string): Promise<ManagedProcessSnapshot> {
  const process = processes.get(processId);
  if (!process) throw new Error(`Unknown process: ${processId}`);
  return stopProcess(process, normalizeSignal(signal));
}

export async function stopAllManagedProcesses(signal = "SIGTERM"): Promise<ManagedProcessSnapshot[]> {
  const normalizedSignal = normalizeSignal(signal);
  return Promise.all([...processes.values()].map((process) => stopProcess(process, normalizedSignal)));
}

export function cleanupExitedManagedProcesses(options: ManagedProcessRetentionOptions = {}): ManagedProcessRetentionReport {
  const nowMs = options.nowMs ?? Date.now();
  const maxExitedAgeMs = options.maxExitedAgeMs ?? managedProcessRetentionPolicy.maxExitedAgeMs;
  const maxExitedPerWorkspace = options.maxExitedPerWorkspace ?? managedProcessRetentionPolicy.maxExitedPerWorkspace;
  const remove = new Set<string>();
  const exitedByWorkspace = new Map<string, ManagedProcess[]>();
  let runningKept = 0;

  for (const process of processes.values()) {
    if (process.status === "running") {
      runningKept += 1;
      continue;
    }
    const endedAtMs = Date.parse(process.endedAt ?? process.startedAt);
    if (Number.isFinite(endedAtMs) && nowMs - endedAtMs > maxExitedAgeMs) {
      remove.add(process.processId);
    }
    const key = `${process.workspaceId}\0${process.workspaceRoot}`;
    const group = exitedByWorkspace.get(key) ?? [];
    group.push(process);
    exitedByWorkspace.set(key, group);
  }

  for (const group of exitedByWorkspace.values()) {
    const newestFirst = [...group].sort((a, b) => processSortTime(b) - processSortTime(a));
    for (const [index, process] of newestFirst.entries()) {
      if (index >= maxExitedPerWorkspace) remove.add(process.processId);
    }
  }

  for (const processId of remove) {
    const process = processes.get(processId);
    if (!process || process.status === "running") continue;
    if (process.timer) clearTimeout(process.timer);
    processes.delete(processId);
  }

  const exitedKept = [...processes.values()].filter((process) => process.status === "exited").length;
  return {
    scanned: processes.size + remove.size,
    removed: remove.size,
    runningKept,
    exitedKept,
    maxExitedAgeMs,
    maxExitedPerWorkspace,
  };
}

function getProcessForWorkspace(input: {
  processId: string;
  workspaceId: string;
  workspaceRoot: string;
  kinds?: ManagedProcessSnapshot["kind"][];
}): ManagedProcess {
  const process = processes.get(input.processId);
  if (
    !process ||
    process.workspaceId !== input.workspaceId ||
    process.workspaceRoot !== input.workspaceRoot ||
    (input.kinds && !input.kinds.includes(process.kind))
  ) {
    throw new Error(`Unknown process for workspace: ${input.processId}`);
  }
  return process;
}

async function stopProcess(process: ManagedProcess, signal: NodeJS.Signals): Promise<ManagedProcessSnapshot> {
  if (process.status !== "running") return snapshot(process);
  terminateProcessGroup(process, signal);
  await waitForExit(process, 500);
  if (signal !== "SIGKILL" && (process.status === "running" || isUnixProcessGroup(process))) {
    terminateProcessGroup(process, "SIGKILL");
    await waitForExit(process, 500);
  }
  return snapshot(process);
}

function snapshot(process: ManagedProcess): ManagedProcessSnapshot {
  return {
    processId: process.processId,
    kind: process.kind,
    workspaceId: process.workspaceId,
    workspaceRoot: process.workspaceRoot,
    cwd: process.cwd,
    commandPreview: process.commandPreview,
    pid: process.pid,
    startedAt: process.startedAt,
    endedAt: process.endedAt,
    status: process.status,
    exitCode: process.exitCode,
    signal: process.signal,
    timedOut: process.timedOut,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

function appendBounded(current: string, next: string, maxOutputBytes: number): string {
  let output = current + next;
  while (Buffer.byteLength(output, "utf8") > maxOutputBytes) {
    output = output.slice(Math.max(1, output.length - maxOutputBytes));
  }
  return output;
}

function processSortTime(process: ManagedProcess): number {
  return Date.parse(process.endedAt ?? process.startedAt) || 0;
}

function processStartErrorMessage(error: Error & { code?: unknown }): string {
  const code = typeof error.code === "string" && error.code ? ` (${error.code})` : "";
  return `process failed to start${code}: ${error.message}`;
}

function normalizeSignal(signal: string | undefined): NodeJS.Signals {
  if (signal === "SIGKILL" || signal === "SIGINT" || signal === "SIGTERM") return signal;
  return "SIGTERM";
}

function terminateProcessGroup(process: ManagedProcess, signal: NodeJS.Signals): void {
  if (globalThis.process.platform === "win32" && process.pid) {
    const result = spawnSync("taskkill", ["/pid", String(process.pid), "/t", "/f"], { stdio: "ignore" });
    if (result.status === 0) return;
  }
  if (isUnixProcessGroup(process)) {
    try {
      globalThis.process.kill(-process.pid, signal);
      return;
    } catch {
      // Fall back to killing the shell process below.
    }
  }
  process.child.kill(signal);
}

function isUnixProcessGroup(process: ManagedProcess): process is ManagedProcess & { pid: number } {
  return Boolean(process.pid && process.child.spawnargs.length && globalThis.process.platform !== "win32");
}

async function waitForExit(process: ManagedProcess, timeoutMs: number): Promise<boolean> {
  if (process.status !== "running") return true;
  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      process.child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    process.child.once("exit", onExit);
    timeout.unref();
  });
}
