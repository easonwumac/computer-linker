import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDiagnostics } from "./config-diagnostics.js";
import { configPath, loadConfig, loadConfigFile, runtimeConfigSources, writeDefaultConfig } from "./config.js";

const originalWorkspaceConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalLegacyWorkspaceConfigDir = process.env.WORKSPACE_LINKER_CONFIG_DIR;
const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const originalWorkspaceOwnerToken = process.env.COMPUTER_LINKER_OWNER_TOKEN;
const originalLegacyWorkspaceOwnerToken = process.env.WORKSPACE_LINKER_OWNER_TOKEN;
const originalOwnerToken = process.env.LOCALPORT_OWNER_TOKEN;
const originalWorkspacePublicBaseUrl = process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
const originalLegacyWorkspacePublicBaseUrl = process.env.WORKSPACE_LINKER_PUBLIC_BASE_URL;
const originalLocalportPublicBaseUrl = process.env.LOCALPORT_PUBLIC_BASE_URL;
const root = await mkdtemp(join(tmpdir(), "localport-config-test-"));

try {
  process.env.COMPUTER_LINKER_CONFIG_DIR = "";
  process.env.WORKSPACE_LINKER_CONFIG_DIR = "";
  process.env.LOCALPORT_CONFIG_DIR = root;
  process.env.COMPUTER_LINKER_OWNER_TOKEN = "";
  process.env.WORKSPACE_LINKER_OWNER_TOKEN = "";
  delete process.env.LOCALPORT_OWNER_TOKEN;
  process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = "";
  process.env.WORKSPACE_LINKER_PUBLIC_BASE_URL = "";
  process.env.LOCALPORT_PUBLIC_BASE_URL = "";
  assert.equal(configPath(), join(root, "config.json"));

  const implicit = loadConfig();
  assert.match(implicit.machineId ?? "", /^machine_/);
  assert.equal(implicit.ownerToken, undefined);
  assert.deepEqual(implicit.workspaces[0].permissions, {
    read: true,
    write: false,
    shell: false,
    codex: false,
    screen: false,
  });
  const implicitDiagnostics = configDiagnostics(implicit);
  assert.ok(implicitDiagnostics.some((finding) => finding.id === "bootstrap-current-read-only" && finding.workspaceId === "current"));
  const implicitRaw = JSON.parse(await readFile(configPath(), "utf8")) as { machineId?: string; ownerToken?: string; workspaces: Array<{ permissions: { write: boolean; shell: boolean } }> };
  assert.equal(implicitRaw.machineId, implicit.machineId);
  assert.equal(implicitRaw.ownerToken, undefined);
  assert.equal(implicitRaw.workspaces[0].permissions.write, false);
  assert.equal(implicitRaw.workspaces[0].permissions.shell, false);
  assert.equal(loadConfig().machineId, implicit.machineId);

  await rm(configPath(), { force: true });
  const writtenPath = writeDefaultConfig();
  assert.equal(writtenPath, configPath());

  const rawConfig = JSON.parse(await readFile(writtenPath, "utf8")) as { machineId?: string; ownerToken?: string; workspaces: Array<{ permissions: { write: boolean; shell: boolean } }> };
  assert.match(rawConfig.machineId ?? "", /^machine_/);
  assert.equal(typeof rawConfig.ownerToken, "string");
  assert.ok((rawConfig.ownerToken ?? "").length >= 32);
  assert.equal(rawConfig.workspaces[0].permissions.write, false);
  assert.equal(rawConfig.workspaces[0].permissions.shell, false);

  const loaded = loadConfig();
  assert.equal(loaded.machineId, rawConfig.machineId);
  assert.equal(loaded.ownerToken, rawConfig.ownerToken);
  assert.equal(loaded.host, "127.0.0.1");
  assert.equal(loaded.port, 3939);
  assert.deepEqual(loaded.workspaces[0].permissions, {
    read: true,
    write: false,
    shell: false,
    codex: false,
    screen: false,
  });

  await writeFile(configPath(), JSON.stringify({
    machineName: "legacy",
    ownerToken: "legacy-token",
    publicBaseUrl: "https://file.example.com",
    workspaces: [],
  }, null, 2), "utf8");
  process.env.COMPUTER_LINKER_OWNER_TOKEN = "";
  process.env.LOCALPORT_OWNER_TOKEN = "env-owner-token";
  const migrated = loadConfig();
  const migratedFile = loadConfigFile();
  const migratedSources = runtimeConfigSources(migratedFile);
  assert.match(migrated.machineId ?? "", /^machine_/);
  assert.equal(migrated.ownerToken, "env-owner-token");
  assert.equal(migrated.publicBaseUrl, "https://file.example.com");
  assert.equal(migratedFile.ownerToken, "legacy-token");
  assert.equal(migratedSources.ownerToken.source, "env");
  assert.equal(migratedSources.ownerToken.envName, "LOCALPORT_OWNER_TOKEN");
  assert.equal(migratedSources.ownerToken.legacyEnvName, true);
  assert.equal(migratedSources.ownerToken.fileConfigured, true);
  assert.equal(migratedSources.ownerToken.overriddenByEnv, true);
  assert.equal(migratedSources.ownerToken.valueRedacted, "<ownerToken>");
  assert.equal(migratedSources.publicBaseUrl.source, "file");
  assert.equal(migratedSources.publicBaseUrl.value, "https://file.example.com");
  const migratedRaw = JSON.parse(await readFile(configPath(), "utf8")) as { machineId?: string; ownerToken?: string };
  assert.equal(migratedRaw.machineId, migrated.machineId);
  assert.equal(migratedRaw.ownerToken, "legacy-token");

  process.env.COMPUTER_LINKER_OWNER_TOKEN = "env-owner";
  process.env.LOCALPORT_OWNER_TOKEN = "legacy-owner";
  process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = "https://env.example.com";
  const primaryEnv = loadConfig();
  const primaryEnvFile = loadConfigFile();
  const primaryEnvSources = runtimeConfigSources(primaryEnvFile);
  assert.equal(primaryEnv.ownerToken, "env-owner");
  assert.equal(primaryEnv.publicBaseUrl, "https://env.example.com");
  assert.equal(primaryEnvFile.ownerToken, "legacy-token");
  assert.equal(primaryEnvFile.publicBaseUrl, "https://file.example.com");
  assert.equal(primaryEnvSources.ownerToken.source, "env");
  assert.equal(primaryEnvSources.ownerToken.envName, "COMPUTER_LINKER_OWNER_TOKEN");
  assert.equal(primaryEnvSources.ownerToken.legacyEnvName, false);
  assert.equal(primaryEnvSources.publicBaseUrl.source, "env");
  assert.equal(primaryEnvSources.publicBaseUrl.envName, "COMPUTER_LINKER_PUBLIC_BASE_URL");
  assert.equal(primaryEnvSources.publicBaseUrl.value, "https://env.example.com");
  assert.equal(primaryEnvSources.publicBaseUrl.fileValue, "https://file.example.com");
  process.env.COMPUTER_LINKER_OWNER_TOKEN = "";
  process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = "";

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

  const legacyBootstrapDiagnostics = configDiagnostics({
    machineName: "diagnostics",
    host: "127.0.0.1",
    ownerToken: "token",
    workspaces: [
      {
        id: "current",
        name: "Current directory",
        path: process.cwd(),
        permissions: { read: true, write: true, shell: true, codex: false },
      },
    ],
  });
  assert.ok(legacyBootstrapDiagnostics.some((finding) => finding.id === "bootstrap-current-legacy-unsafe" && finding.severity === "warning"));

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

  if (originalLegacyWorkspaceConfigDir === undefined) delete process.env.WORKSPACE_LINKER_CONFIG_DIR;
  else process.env.WORKSPACE_LINKER_CONFIG_DIR = originalLegacyWorkspaceConfigDir;

  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  if (originalWorkspaceOwnerToken === undefined) delete process.env.COMPUTER_LINKER_OWNER_TOKEN;
  else process.env.COMPUTER_LINKER_OWNER_TOKEN = originalWorkspaceOwnerToken;

  if (originalLegacyWorkspaceOwnerToken === undefined) delete process.env.WORKSPACE_LINKER_OWNER_TOKEN;
  else process.env.WORKSPACE_LINKER_OWNER_TOKEN = originalLegacyWorkspaceOwnerToken;

  if (originalOwnerToken === undefined) delete process.env.LOCALPORT_OWNER_TOKEN;
  else process.env.LOCALPORT_OWNER_TOKEN = originalOwnerToken;

  if (originalWorkspacePublicBaseUrl === undefined) delete process.env.COMPUTER_LINKER_PUBLIC_BASE_URL;
  else process.env.COMPUTER_LINKER_PUBLIC_BASE_URL = originalWorkspacePublicBaseUrl;

  if (originalLegacyWorkspacePublicBaseUrl === undefined) delete process.env.WORKSPACE_LINKER_PUBLIC_BASE_URL;
  else process.env.WORKSPACE_LINKER_PUBLIC_BASE_URL = originalLegacyWorkspacePublicBaseUrl;

  if (originalLocalportPublicBaseUrl === undefined) delete process.env.LOCALPORT_PUBLIC_BASE_URL;
  else process.env.LOCALPORT_PUBLIC_BASE_URL = originalLocalportPublicBaseUrl;

  await rm(root, { recursive: true, force: true });
}
