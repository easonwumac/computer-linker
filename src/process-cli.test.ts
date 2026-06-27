import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { writeConfig } from "./config.js";
import { serveHttp } from "./server.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxCliPath = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const originalConfigDir = process.env.WORKSPACE_LINKER_CONFIG_DIR;
const originalLocalPortConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "workspace-linker-process-cli-test-"));
const configRoot = join(root, "config");
const workspaceRoot = join(root, "workspace");
const port = await getAvailablePort();

try {
  process.env.WORKSPACE_LINKER_CONFIG_DIR = configRoot;
  delete process.env.LOCALPORT_CONFIG_DIR;
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "process-cli-child.js"), [
    "process.stdout.write('process-cli-out');",
    "process.stderr.write('process-cli-err');",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");

  writeConfig({
    machineName: "process-cli-test",
    host: "127.0.0.1",
    port,
    ownerToken: "process-token",
    workspaces: [
      {
        id: "runner",
        name: "Runner",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: true, codex: false, screen: false },
      },
    ],
  });

  const server = serveHttp();
  try {
    await waitForApi();
    const started = await workspaceOperation({
      workspace: "runner",
      operation: "process_start",
      command: "node process-cli-child.js",
    });
    assert.equal(started.ok, true);
    const processId = started.data.process.processId as string;
    assert.match(processId, /^proc_/);

    const listed = JSON.parse((await runCliOutput("process", "list", "runner", "--json")).stdout) as {
      processes: Array<{ processId: string; status: string; commandPreview: string }>;
    };
    assert.ok(listed.processes.some((process) => (
      process.processId === processId &&
      process.status === "running" &&
      process.commandPreview === "node process-cli-child.js"
    )));

    const listText = (await runCliOutput("process", "list", "runner")).stdout;
    assert.match(listText, /Workspace Linker managed processes/);
    assert.match(listText, new RegExp(processId));

    const read = await waitForProcessRead(processId);
    assert.equal(read.process.processId, processId);
    assert.equal(read.process.stdout, "process-cli-out");
    assert.equal(read.process.stderr, "process-cli-err");

    const readText = (await runCliOutput("process", "read", "runner", processId)).stdout;
    assert.match(readText, /stdout:\r?\nprocess-cli-out/);
    assert.match(readText, /stderr:\r?\nprocess-cli-err/);

    const stopped = JSON.parse((await runCliOutput("process", "stop", "runner", processId, "--json")).stdout) as {
      process: { processId: string; status: string };
    };
    assert.equal(stopped.process.processId, processId);
    assert.equal(stopped.process.status, "exited");

    await assert.rejects(
      () => runCliOutput("process", "stop", "runner", processId, "--signal", "BAD"),
      /process stop --signal must be one of/,
    );
  } finally {
    server.close();
  }
} finally {
  if (originalConfigDir === undefined) delete process.env.WORKSPACE_LINKER_CONFIG_DIR;
  else process.env.WORKSPACE_LINKER_CONFIG_DIR = originalConfigDir;

  if (originalLocalPortConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalLocalPortConfigDir;

  await rm(root, { recursive: true, force: true });
}

async function runCliOutput(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [tsxCliPath, "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKSPACE_LINKER_CONFIG_DIR: process.env.WORKSPACE_LINKER_CONFIG_DIR,
      LOCALPORT_CONFIG_DIR: process.env.LOCALPORT_CONFIG_DIR,
    },
  });
}

async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
        headers: { authorization: "Bearer process-token" },
      });
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("API did not start");
}

async function workspaceOperation(body: unknown): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/workspace-operation`, {
    method: "POST",
    headers: {
      authorization: "Bearer process-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function waitForProcessRead(processId: string): Promise<{ process: { processId: string; stdout: string; stderr: string } }> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = JSON.parse((await runCliOutput("process", "read", "runner", processId, "--json")).stdout) as {
      process: { processId: string; stdout: string; stderr: string };
    };
    if (result.process.stdout.includes("process-cli-out") && result.process.stderr.includes("process-cli-err")) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("process output did not become available");
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (!address || typeof address === "string") throw new Error("Could not allocate a local test port");
  return address.port;
}
