import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "./config.js";
import { serveHttp } from "./server.js";

const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "localport-server-process-test-"));
const configRoot = join(root, "config");
const workspaceRoot = join(root, "workspace");
const baseUrl = "http://127.0.0.1:3961";
const readyFile = join(workspaceRoot, "child-ready.txt");
const pidFile = join(workspaceRoot, "child-pid.txt");
const signalFile = join(workspaceRoot, "child-signal.txt");

try {
  process.env.LOCALPORT_CONFIG_DIR = configRoot;
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "child.js"), [
    "import { writeFileSync } from 'node:fs';",
    "process.on('SIGTERM', () => {",
    `  writeFileSync(${JSON.stringify(signalFile)}, 'term');`,
    "  process.exit(0);",
    "});",
    `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    `writeFileSync(${JSON.stringify(readyFile)}, 'ready');`,
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");
  writeConfig({
    machineName: "server-process-test",
    host: "127.0.0.1",
    port: 3961,
    workspaces: [
      {
        id: "runner",
        name: "Runner",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: true, codex: false },
      },
    ],
  });

  const server = serveHttp();
  try {
    await waitForApi();
    const started = await workspaceOperation({
      workspace: "runner",
      operation: "process_start",
      command: "node child.js",
    });
    assert.equal(started.ok, true);
    assert.match(started.data.process.processId, /^proc_/);
    await waitForFile(readyFile, "ready");
  } finally {
    server.close();
  }

  if (process.platform === "win32") {
    await waitForProcessGone(Number(await readFile(pidFile, "utf8")));
  } else {
    await waitForFile(signalFile, "term");
  }
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  await rm(root, { recursive: true, force: true });
}

async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("API did not start");
}

async function workspaceOperation(body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}/api/v1/workspace-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function waitForFile(path: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await readFile(path, "utf8")) === expected) return;
    } catch {
      // File is created asynchronously by the managed process.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`file did not become available: ${path}`);
}

async function waitForProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`process did not exit: ${pid}`);
}
