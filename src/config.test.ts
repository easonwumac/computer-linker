import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDiagnostics } from "./config-diagnostics.js";
import { configPath, loadConfig, writeDefaultConfig } from "./config.js";

const originalWorkspaceConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const originalWorkspaceOwnerToken = process.env.COMPUTER_LINKER_OWNER_TOKEN;
const originalOwnerToken = process.env.LOCALPORT_OWNER_TOKEN;
const originalWorkspacePublicBaseUrl = process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
const originalLocalportPublicBaseUrl = process.env.LOCALPORT_PUBLIC_BASE_URL;
const root = await mkdtemp(join(tmpdir(), "localport-config-test-"));

try {
  process.env.COMPUTER_LINKER_CONFIG_DIR = "";
  process.env.LOCALPORT_CONFIG_DIR = root;
  process.env.COMPUTER_LINKER_OWNER_TOKEN = "";
  delete process.env.LOCALPORT_OWNER_TOKEN;
  process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = "";
  process.env.LOCALPORT_PUBLIC_BASE_URL = "";
  assert.equal(configPath(), join(root, "config.json"));

  const implicit = loadConfig();
  assert.match(implicit.machineId ?? "", /^machine_/);
  assert.equal(implicit.ownerToken, undefined);
  const implicitRaw = JSON.parse(await readFile(configPath(), "utf8")) as { machineId?: string; ownerToken?: string };
  assert.equal(implicitRaw.machineId, implicit.machineId);
  assert.equal(implicitRaw.ownerToken, undefined);
  assert.equal(loadConfig().machineId, implicit.machineId);

  await rm(configPath(), { force: true });
  const writtenPath = writeDefaultConfig();
  assert.equal(writtenPath, configPath());

  const rawConfig = JSON.parse(await readFile(writtenPath, "utf8")) as { machineId?: string; ownerToken?: string };
  assert.match(rawConfig.machineId ?? "", /^machine_/);
  assert.equal(typeof rawConfig.ownerToken, "string");
  assert.ok((rawConfig.ownerToken ?? "").length >= 32);

  const loaded = loadConfig();
  assert.equal(loaded.machineId, rawConfig.machineId);
  assert.equal(loaded.ownerToken, rawConfig.ownerToken);
  assert.equal(loaded.host, "127.0.0.1");
  assert.equal(loaded.port, 3939);

  await writeFile(configPath(), JSON.stringify({
    machineName: "legacy",
    ownerToken: "legacy-token",
    publicBaseUrl: "https://file.example.com",
    workspaces: [],
  }, null, 2), "utf8");
  process.env.COMPUTER_LINKER_OWNER_TOKEN = "";
  process.env.LOCALPORT_OWNER_TOKEN = "env-owner-token";
  const migrated = loadConfig();
  assert.match(migrated.machineId ?? "", /^machine_/);
  assert.equal(migrated.ownerToken, "env-owner-token");
  assert.equal(migrated.publicBaseUrl, "https://file.example.com");
  const migratedRaw = JSON.parse(await readFile(configPath(), "utf8")) as { machineId?: string; ownerToken?: string };
  assert.equal(migratedRaw.machineId, migrated.machineId);
  assert.equal(migratedRaw.ownerToken, "legacy-token");

  const diagnostics = configDiagnostics({
    machineName: "diagnostics",
    host: "127.0.0.1",
    ownerToken: "token",
    workspaces: [
      {
        id: "runner",
        name: "Runner",
        path: root,
        permissions: { read: true, write: false, shell: true, codex: false },
      },
      {
        id: "missing",
        name: "Missing",
        path: join(root, "missing"),
        permissions: { read: true, write: false, shell: false, codex: false },
      },
      {
        id: "runner-readonly",
        name: "Runner Read Only",
        path: root,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
    ],
  });
  assert.ok(diagnostics.some((finding) => finding.id === "workspace-execution-policy-missing" && finding.workspaceId === "runner"));
  assert.ok(diagnostics.some((finding) => finding.id === "workspace-path-missing-on-disk" && finding.workspaceId === "missing" && finding.severity === "critical"));
  assert.ok(diagnostics.some((finding) => finding.id === "workspace-path-duplicate" && finding.workspaceId === "runner-readonly" && finding.severity === "warning"));

  const safeRoot = join(root, "safe");
  await mkdir(safeRoot);
  const safeDiagnostics = configDiagnostics({
    machineName: "diagnostics-safe",
    host: "127.0.0.1",
    ownerToken: "token",
    workspaces: [
      {
        id: "safe",
        name: "Safe",
        path: safeRoot,
        permissions: { read: true, write: false, shell: true, codex: false },
        policy: { allowedCommands: ["npm *"], maxRuntimeSeconds: 600, maxOutputBytes: 200000 },
      },
    ],
  });
  assert.equal(safeDiagnostics.length, 1);
  assert.equal(safeDiagnostics[0].id, "config-baseline-ok");
} finally {
  if (originalWorkspaceConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  else process.env.COMPUTER_LINKER_CONFIG_DIR = originalWorkspaceConfigDir;

  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  if (originalWorkspaceOwnerToken === undefined) delete process.env.COMPUTER_LINKER_OWNER_TOKEN;
  else process.env.COMPUTER_LINKER_OWNER_TOKEN = originalWorkspaceOwnerToken;

  if (originalOwnerToken === undefined) delete process.env.LOCALPORT_OWNER_TOKEN;
  else process.env.LOCALPORT_OWNER_TOKEN = originalOwnerToken;

  if (originalWorkspacePublicBaseUrl === undefined) delete process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
  else process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = originalWorkspacePublicBaseUrl;

  if (originalLocalportPublicBaseUrl === undefined) delete process.env.LOCALPORT_PUBLIC_BASE_URL;
  else process.env.LOCALPORT_PUBLIC_BASE_URL = originalLocalportPublicBaseUrl;

  await rm(root, { recursive: true, force: true });
}
