import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadConfig, writeConfig } from "./config.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const sourcePackageJson = require("../package.json") as { version: string };
const sourceTsxLoaderUrl = pathToFileURL(require.resolve("tsx")).href;
const sourceCliPath = join(process.cwd(), "src", "cli.ts");
const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const originalWorkspaceLinkerConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const originalControlPlaneApiKey = process.env.CONTROL_PLANE_API_KEY;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalOpenAiTunnelId = process.env.COMPUTER_LINKER_OPENAI_TUNNEL_ID;
const originalOpenAiTunnelClient = process.env.COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT;
const originalFakeCloudflaredExit = process.env.COMPUTER_LINKER_FAKE_CLOUDFLARED_EXIT;
const originalPath = process.env.PATH;
const CLI_READY_TIMEOUT_MS = 30000;
const root = await mkdtemp(join(tmpdir(), "localport-cli-test-"));
const workspaceRoot = join(root, "workspace");
const updatedRoot = join(root, "updated");
const tailscaleRoot = join(root, "dev_7_3");
const oneCommandRoot = join(root, "one-command");
const hereRoot = join(root, "here-project");
const freshRoot = join(root, "fresh-project");
const codexRoot = join(root, "codex-project");
const pathOnlyAddRoot = join(root, "path-only-add");
const createdAddRoot = join(root, "created-add");
const devAddRoot = join(root, "dev-add");
const fullTrustAddRoot = join(root, "full-trust-add");
const explicitAddRoot = join(root, "explicit-add");
const legacyAddRoot = join(root, "legacy-add");
const setupReuseRoot = join(root, "setup-reuse");
const bootstrapCleanupRoot = join(root, "bootstrap-cleanup");
const devStartRoot = join(root, "dev-start");
const fakeBinRoot = join(root, "fake-bin");
let cliSectionStartedAt = Date.now();

try {
  delete process.env.LOCALPORT_CONFIG_DIR;
  process.env.CONTROL_PLANE_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  process.env.COMPUTER_LINKER_OPENAI_TUNNEL_ID = "";
  process.env.COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT = "";
  process.env.COMPUTER_LINKER_CONFIG_DIR = join(root, "config");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(updatedRoot, { recursive: true });
  await mkdir(tailscaleRoot, { recursive: true });
  await mkdir(oneCommandRoot, { recursive: true });
  await mkdir(hereRoot, { recursive: true });
  await mkdir(freshRoot, { recursive: true });
  await mkdir(codexRoot, { recursive: true });
  await mkdir(pathOnlyAddRoot, { recursive: true });
  await mkdir(devAddRoot, { recursive: true });
  await mkdir(fullTrustAddRoot, { recursive: true });
  await mkdir(explicitAddRoot, { recursive: true });
  await mkdir(legacyAddRoot, { recursive: true });
  await mkdir(setupReuseRoot, { recursive: true });
  await mkdir(bootstrapCleanupRoot, { recursive: true });
  await mkdir(devStartRoot, { recursive: true });
  await mkdir(fakeBinRoot, { recursive: true });
  writeConfig({
    machineName: "cli-test",
    ownerToken: "token",
    workspaces: [
      {
        id: "app",
        name: "App",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
    ],
  });

  markCliSection("workspace and config basics");
  await runCli("workspace", "update", "app", "--name", "Updated app", "--path", updatedRoot, "--write", "--shell", "--no-codex");
  let config = loadConfig();
  assert.equal(config.workspaces[0].name, "Updated app");
  assert.equal(config.workspaces[0].path, updatedRoot);
  assert.deepEqual(config.workspaces[0].permissions, {
    read: true,
    write: true,
    shell: true,
    codex: false,
    screen: false,
  });

  await runCli("workspace", "update", "app", "--no-write", "--codex");
  config = loadConfig();
  assert.deepEqual(config.workspaces[0].permissions, {
    read: true,
    write: false,
    shell: true,
    codex: true,
    screen: false,
  });
  await runCli("workspace", "update", "app", "--no-codex");
  config = loadConfig();
  assert.deepEqual(config.workspaces[0].permissions, {
    read: true,
    write: false,
    shell: true,
    codex: false,
    screen: false,
  });
  await runCli("workspace", "update", "app", "--screen");
  config = loadConfig();
  assert.equal(config.workspaces[0].permissions.screen, true);
  const screenStatus = JSON.parse((await runCliOutput("screen", "status", "--json")).stdout) as {
    kind: string;
    provider: string;
    supported: boolean;
    permission: { status: string; detail: string | null };
    modes: string[];
    screenEnabledWorkspaces: Array<{ id: string; name: string; path: string }>;
    nextActions: string[];
  };
  assert.equal(screenStatus.kind, "computer-linker-screen-status");
  assert.equal(typeof screenStatus.provider, "string");
  assert.equal(typeof screenStatus.supported, "boolean");
  assert.equal(typeof screenStatus.permission.status, "string");
  assert.ok(Array.isArray(screenStatus.modes));
  assert.ok(screenStatus.screenEnabledWorkspaces.some((workspace) => workspace.id === "app"));
  assert.ok(screenStatus.nextActions.length > 0);
  const screenStatusText = (await runCliOutput("screen", "status")).stdout;
  assert.match(screenStatusText, /Computer Linker screen status/);
  assert.match(screenStatusText, /screen-enabled workspaces:/);
  const workspaceListWithScreen = (await runCliOutput("workspace", "list")).stdout;
  assert.match(workspaceListWithScreen, /screen=true/);
  await assert.rejects(
    () => runCliOutput("screen", "status", "--bad"),
    /Unknown screen status option: --bad/,
  );
  await runCli("workspace", "update", "app", "--no-screen");
  config = loadConfig();
  assert.equal(config.workspaces[0].permissions.screen, false);
  await runCli("workspace", "update", "app", "--full-trust");
  config = loadConfig();
  assert.deepEqual(config.workspaces[0].permissions, {
    read: true,
    write: true,
    shell: true,
    codex: true,
    screen: true,
  });
  await runCli("workspace", "update", "app", "--read-only");
  config = loadConfig();
  assert.deepEqual(config.workspaces[0].permissions, {
    read: true,
    write: false,
    shell: false,
    codex: false,
    screen: false,
  });
  await assert.rejects(
    () => runCliOutput("workspace", "update", "app", "--read-only", "--write"),
    /workspace update --read-only cannot be combined with --write/,
  );
  await runCli("workspace", "update", "app", "--shell", "--no-write", "--no-codex", "--no-screen");
  config = loadConfig();
  assert.deepEqual(config.workspaces[0].permissions, {
    read: true,
    write: false,
    shell: true,
    codex: false,
    screen: false,
  });

  const redactedProfile = JSON.parse((await runCliOutput("profile")).stdout) as {
    machineId?: string;
    http: { auth: { header?: string; bearerToken?: string } };
  };
  assert.match(redactedProfile.machineId ?? "", /^machine_/);
  assert.equal(redactedProfile.http.auth.header, "Authorization: Bearer <ownerToken>");
  assert.equal(redactedProfile.http.auth.bearerToken, undefined);

  const fullProfile = JSON.parse((await runCliOutput("profile", "--show-token")).stdout) as {
    http: { auth: { header?: string; bearerToken?: string }; publicMcpUrl: string };
  };
  assert.equal(fullProfile.http.auth.header, "Authorization: Bearer token");
  assert.equal(fullProfile.http.auth.bearerToken, "token");

  const redactedConfigShow = JSON.parse((await runCliOutput("config", "show")).stdout) as { ownerToken?: string };
  assert.equal(redactedConfigShow.ownerToken, "<ownerToken>");
  assert.doesNotMatch(JSON.stringify(redactedConfigShow), /"token"/);
  const fullConfigShow = JSON.parse((await runCliOutput("config", "show", "--show-token")).stdout) as { ownerToken?: string };
  assert.equal(fullConfigShow.ownerToken, "token");
  const envConfigShow = JSON.parse((await runCliOutputWithEnv({
    COMPUTER_LINKER_OWNER_TOKEN: "env-redacted",
    COMPUTER_LINKER_PUBLIC_BASE_URL: "https://env.example.com",
  }, "config", "show", "--show-token")).stdout) as { ownerToken?: string; publicBaseUrl?: string };
  assert.equal(envConfigShow.ownerToken, "token");
  assert.notEqual(envConfigShow.ownerToken, "env-redacted");
  assert.notEqual(envConfigShow.publicBaseUrl, "https://env.example.com");
  const envTokenStatus = JSON.parse((await runCliOutputWithEnv({
    COMPUTER_LINKER_OWNER_TOKEN: "env-redacted",
  }, "config", "token", "--json")).stdout) as {
    source: string;
    envName?: string;
    fileConfigured: boolean;
    overriddenByEnv: boolean;
    ownerToken?: string;
  };
  assert.equal(envTokenStatus.source, "env");
  assert.equal(envTokenStatus.envName, "COMPUTER_LINKER_OWNER_TOKEN");
  assert.equal(envTokenStatus.fileConfigured, true);
  assert.equal(envTokenStatus.overriddenByEnv, true);
  assert.equal(envTokenStatus.ownerToken, undefined);
  await assert.rejects(
    () => runCliOutputWithEnv({ COMPUTER_LINKER_OWNER_TOKEN: "env-redacted" }, "config", "token", "rotate"),
    /ownerToken is overridden by COMPUTER_LINKER_OWNER_TOKEN/,
  );
  await assert.rejects(
    () => runCliOutput("config", "show", "--bad"),
    /Unknown config show option: --bad/,
  );

  const workspaceAddConfigDir = join(root, "workspace-add-config");
  const beforeWorkspaceAddConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  process.env.COMPUTER_LINKER_CONFIG_DIR = workspaceAddConfigDir;
  try {
    writeConfig({
      machineName: "workspace-add-test",
      ownerToken: "token",
      workspaces: [],
    });
    const pathOnlyAddText = (await runCliOutput("workspace", "add", pathOnlyAddRoot, "--write")).stdout;
    assert.match(pathOnlyAddText, /Added workspace path-only-add \(path-only-add\)/);
    const createdAddText = (await runCliOutput("workspace", "add", createdAddRoot, "--id", "created-add", "--write")).stdout;
    assert.match(createdAddText, /Added workspace created-add \(created-add\)/);
    assert.equal((await stat(createdAddRoot)).isDirectory(), true);
    let addConfig = loadConfig();
    assert.deepEqual(addConfig.workspaces.find((workspace) => workspace.id === "path-only-add"), {
      id: "path-only-add",
      name: "path-only-add",
      path: pathOnlyAddRoot,
      permissions: { read: true, write: true, shell: false, codex: false, screen: false },
      policy: undefined,
    });
    assert.equal(addConfig.workspaces.find((workspace) => workspace.id === "created-add")?.path, createdAddRoot);

    await runCli("workspace", "add", devAddRoot, "--dev");
    addConfig = loadConfig();
    assert.deepEqual(addConfig.workspaces.find((workspace) => workspace.id === "dev-add"), {
      id: "dev-add",
      name: "dev-add",
      path: devAddRoot,
      permissions: { read: true, write: true, shell: true, codex: false, screen: false },
      policy: undefined,
    });

    await runCli("workspace", "add", fullTrustAddRoot, "--full-trust");
    addConfig = loadConfig();
    assert.deepEqual(addConfig.workspaces.find((workspace) => workspace.id === "full-trust-add"), {
      id: "full-trust-add",
      name: "full-trust-add",
      path: fullTrustAddRoot,
      permissions: { read: true, write: true, shell: true, codex: true, screen: true },
      policy: undefined,
    });

    await runCli("workspace", "add", explicitAddRoot, "--id", "explicit-app", "--name", "Explicit App", "--shell");
    addConfig = loadConfig();
    assert.deepEqual(addConfig.workspaces.find((workspace) => workspace.id === "explicit-app"), {
      id: "explicit-app",
      name: "Explicit App",
      path: explicitAddRoot,
      permissions: { read: true, write: false, shell: true, codex: false, screen: false },
      policy: undefined,
    });

    await runCli("workspace", "add", "legacy-app", legacyAddRoot, "--codex");
    addConfig = loadConfig();
    assert.deepEqual(addConfig.workspaces.find((workspace) => workspace.id === "legacy-app"), {
      id: "legacy-app",
      name: "legacy-add",
      path: legacyAddRoot,
      permissions: { read: true, write: false, shell: false, codex: true, screen: false },
      policy: undefined,
    });

    await assert.rejects(
      () => runCliOutput("workspace", "add", "legacy-app", legacyAddRoot, "--id", "other"),
      /accepts either --id with <path> or legacy <id> <path>/,
    );
    await assert.rejects(
      () => runCliOutput("workspace", "add", explicitAddRoot, "--bad"),
      /Unknown workspace add option: --bad/,
    );
    await assert.rejects(
      () => runCliOutput("workspace", "add", explicitAddRoot, "--read-only", "--shell"),
      /workspace add --read-only cannot be combined with --shell/,
    );
  } finally {
    if (beforeWorkspaceAddConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = beforeWorkspaceAddConfigDir;
  }

  const setupReuseConfigDir = join(root, "setup-reuse-config");
  const beforeSetupReuseConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  process.env.COMPUTER_LINKER_CONFIG_DIR = setupReuseConfigDir;
  try {
    writeConfig({
      machineName: "setup-reuse-test",
      ownerToken: "token",
      workspaces: [
        {
          id: "custom-app",
          name: "Custom App",
          path: setupReuseRoot,
          permissions: { read: true, write: false, shell: false, codex: false, screen: false },
        },
      ],
    });
    const setupReuse = JSON.parse((await runCliOutput("setup", setupReuseRoot, "--write", "--json")).stdout) as {
      workspace: { id: string; created: boolean; permissions: { write: boolean } };
    };
    assert.equal(setupReuse.workspace.id, "custom-app");
    assert.equal(setupReuse.workspace.created, false);
    assert.equal(setupReuse.workspace.permissions.write, true);
    let setupReuseConfig = loadConfig();
    assert.equal(setupReuseConfig.workspaces.length, 1);
    assert.equal(setupReuseConfig.workspaces[0].id, "custom-app");
    assert.equal(setupReuseConfig.workspaces[0].permissions.write, true);

    const setupReadOnly = JSON.parse((await runCliOutput("setup", setupReuseRoot, "--read-only", "--json")).stdout) as {
      workspace: { permissions: { write: boolean; shell: boolean; codex: boolean; screen: boolean } };
    };
    assert.deepEqual(setupReadOnly.workspace.permissions, {
      read: true,
      write: false,
      shell: false,
      codex: false,
      screen: false,
    });
    const setupFullTrust = JSON.parse((await runCliOutput("setup", setupReuseRoot, "--full-trust", "--json")).stdout) as {
      workspace: { permissions: { write: boolean; shell: boolean; codex: boolean; screen: boolean } };
    };
    assert.deepEqual(setupFullTrust.workspace.permissions, {
      read: true,
      write: true,
      shell: true,
      codex: true,
      screen: true,
    });
    await assert.rejects(
      () => runCliOutput("setup", setupReuseRoot, "--read-only", "--codex"),
      /setup --read-only cannot be combined with --codex/,
    );

    await runCli("setup", setupReuseRoot, "--id", "explicit-duplicate");
    setupReuseConfig = loadConfig();
    assert.equal(setupReuseConfig.workspaces.length, 2);
    assert.ok(setupReuseConfig.workspaces.some((workspace) => workspace.id === "explicit-duplicate"));
  } finally {
    if (beforeSetupReuseConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = beforeSetupReuseConfigDir;
  }

  const tokenConfigDir = join(root, "token-config");
  const beforeTokenConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  process.env.COMPUTER_LINKER_CONFIG_DIR = tokenConfigDir;
  try {
    writeConfig({
      machineName: "token-test",
      ownerToken: "old-token",
      workspaces: [],
    });
    const tokenStatusText = (await runCliOutput("config", "token")).stdout;
    assert.match(tokenStatusText, /Computer Linker owner token/);
    assert.match(tokenStatusText, /tokenConfigured: yes/);
    assert.match(tokenStatusText, /authHeader: Authorization: Bearer <ownerToken>/);
    assert.doesNotMatch(tokenStatusText, /old-token/);

    const rotatedText = (await runCliOutput("config", "token", "rotate", "--show-token")).stdout;
    assert.match(rotatedText, /rotated: yes/);
    assert.match(rotatedText, /authHeader: Authorization: Bearer [A-Za-z0-9_-]{32,}/);
    assert.doesNotMatch(rotatedText, /old-token/);
    const rotatedConfig = loadConfig();
    assert.notEqual(rotatedConfig.ownerToken, "old-token");
    assert.match(rotatedConfig.ownerToken ?? "", /^[A-Za-z0-9_-]{32,}$/);

    const rotatedJson = JSON.parse((await runCliOutput("config", "token", "rotate", "--json")).stdout) as {
      kind: string;
      tokenConfigured: boolean;
      rotated: boolean;
      authHeader: string;
      ownerToken?: string;
      nextActions: string[];
    };
    assert.equal(rotatedJson.kind, "computer-linker-owner-token");
    assert.equal(rotatedJson.tokenConfigured, true);
    assert.equal(rotatedJson.rotated, true);
    assert.equal(rotatedJson.authHeader, "Authorization: Bearer <ownerToken>");
    assert.equal(rotatedJson.ownerToken, undefined);
    assert.ok(rotatedJson.nextActions.some((action) => action.includes("Update MCP clients")));

    await assert.rejects(
      () => runCliOutput("config", "token", "--bad"),
      /Unknown config token option: --bad/,
    );
    await assert.rejects(
      () => runCliOutput("config", "token", "rotate", "again"),
      /Usage: computer-linker config token/,
    );
  } finally {
    if (beforeTokenConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = beforeTokenConfigDir;
  }

  await runCli("config", "set-public-url", "https://computer-linker.example.com/path?ignored=true");
  config = loadConfig();
  assert.equal(config.publicBaseUrl, "https://computer-linker.example.com");
  markCliSection("doctor, status, tunnel, and history");
  const doctorOutput = (await runCliOutput("doctor")).stdout;
  assert.match(doctorOutput, /runtime: platform=/);
  assert.match(doctorOutput, /localMcpUrl: http:\/\/127\.0\.0\.1:3939\/mcp/);
  assert.match(doctorOutput, /localApiUrl: http:\/\/127\.0\.0\.1:3939\/api\/v1/);
  assert.match(doctorOutput, /readyForTunnel:/);
  assert.match(doctorOutput, /publicMcpUrl: https:\/\/computer-linker\.example\.com\/mcp/);
  assert.match(doctorOutput, /workspaces: total=1 write=0 shell=1 codex=0/);
  assert.match(doctorOutput, /config: critical=0 warning=/);
  assert.match(doctorOutput, /local tools:/);
  assert.match(doctorOutput, /  node: available/);
  assert.match(doctorOutput, /releaseReadiness: status=/);
  assert.match(doctorOutput, /service: platform=/);
  assert.match(doctorOutput, /startup: ready=yes recommended=/);
  assert.match(doctorOutput, /toolReadiness: ready=yes requiredMissing=none/);
  assert.match(doctorOutput, /service commands:/);
  assert.match(doctorOutput, /computer-linker service profile --platform/);
  assert.match(doctorOutput, /start commands:/);
  assert.match(doctorOutput, /next actions:/);
  const doctorJson = JSON.parse((await runCliOutput("doctor", "--json")).stdout) as {
    readyForTunnel: boolean;
    machine: { platform: string; arch: string; nodeVersion: string };
    runtime: { localApiUrl: string; localMcpUrl: string; startCommands: { start: string; serveHttp: string } };
    startup: {
      kind: string;
      ready: boolean;
      recommendedMode: string;
      localMcpUrl: string;
      localApiUrl: string;
      service: {
        profileBundleCommand: string;
        installDryRunCommand: string;
      };
      modes: Array<{ id: string; command: string; persistent: boolean }>;
      nextActions: string[];
    };
    service: {
      platform: string;
      serviceName: string;
      profileCommand: string;
      profileBundleCommand: string;
      installDryRunCommand: string;
      uninstallDryRunCommand: string;
      statusCommands: string[];
    };
    exposure: { publicMcpUrl?: string; publicBaseUrlConfigured: boolean };
    workspaces: { total: number; writable: number; shellEnabled: number; codexEnabled: number };
    localTools: Array<{ name: string; available: boolean; path?: string; importance?: string; usedFor?: string[] }>;
    toolReadiness: {
      kind: string;
      ready: boolean;
      requiredMissing: string[];
      recommendedMissing: string[];
      availableRecommended: string[];
      installHints: Array<{ name: string; importance: string; usedFor: string[]; install?: { macos?: string; linux?: string; windows?: string; docs?: string } }>;
    };
    configDiagnostics: {
      criticalCount: number;
      warningCount: number;
      findings: Array<{ id: string; severity: string; workspaceId?: string }>;
    };
    releaseReadiness: {
      kind: string;
      ready: boolean;
      status: string;
      recommendedGate: string;
      checks: Array<{ id: string; status: string }>;
      warnings: string[];
      blockingReasons: string[];
    };
    nextActions: string[];
  };
  assert.equal(typeof doctorJson.readyForTunnel, "boolean");
  assert.equal(typeof doctorJson.machine.platform, "string");
  assert.equal(doctorJson.machine.nodeVersion, process.version);
  assert.equal(doctorJson.runtime.localMcpUrl, "http://127.0.0.1:3939/mcp");
  assert.equal(doctorJson.runtime.localApiUrl, "http://127.0.0.1:3939/api/v1");
  assert.equal(doctorJson.runtime.startCommands.start, "computer-linker start");
  assert.equal(doctorJson.runtime.startCommands.serveHttp, "computer-linker start");
  assert.equal(doctorJson.startup.kind, "computer-linker-startup-readiness");
  assert.equal(doctorJson.startup.ready, true);
  assert.equal(doctorJson.startup.localMcpUrl, "http://127.0.0.1:3939/mcp");
  assert.equal(doctorJson.startup.localApiUrl, "http://127.0.0.1:3939/api/v1");
  assert.ok(doctorJson.startup.modes.some((mode) => mode.id === "here" && mode.command === "computer-linker here"));
  assert.ok(doctorJson.startup.modes.some((mode) => mode.id === "start" && mode.command === "computer-linker start"));
  assert.ok(doctorJson.startup.modes.some((mode) => mode.id === "tunnel-cloudflare" && mode.command === "computer-linker start <workspace-path> --tunnel cloudflare"));
  assert.ok(doctorJson.startup.modes.some((mode) => mode.id === "tunnel-tailscale" && mode.command === "computer-linker start <workspace-path> --tunnel tailscale"));
  assert.ok(doctorJson.startup.modes.some((mode) => mode.id === "tunnel-openai" && mode.command === "computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_..."));
  assert.ok(doctorJson.startup.modes.every((mode) => !mode.command.includes("--no-tunnel")));
  assert.ok(doctorJson.startup.modes.some((mode) => mode.id === "service" && mode.persistent));
  assert.match(doctorJson.startup.service.profileBundleCommand, /--output-dir \.\/service-profile$/);
  assert.match(doctorJson.startup.service.installDryRunCommand, /service install --dry-run --platform/);
  assert.ok(doctorJson.startup.nextActions.some((action) => action.includes("computer-linker here")));
  assert.ok(doctorJson.startup.nextActions.some((action) => action.includes("computer-linker start <workspace-path>")));
  assert.match(doctorJson.service.profileCommand, /^computer-linker service profile --platform /);
  assert.match(doctorJson.service.profileBundleCommand, /--output-dir \.\/service-profile$/);
  assert.match(doctorJson.service.installDryRunCommand, /service install --dry-run --platform/);
  assert.match(doctorJson.service.uninstallDryRunCommand, /service uninstall --dry-run --platform/);
  assert.ok(doctorJson.service.statusCommands.length > 0);
  assert.equal(doctorJson.exposure.publicMcpUrl, "https://computer-linker.example.com/mcp");
  assert.equal(doctorJson.exposure.publicBaseUrlConfigured, true);
  assert.deepEqual(doctorJson.workspaces, { total: 1, writable: 0, shellEnabled: 1, codexEnabled: 0 });
  assert.ok(doctorJson.localTools.some((tool) => tool.name === "node" && tool.available && tool.importance === "required"));
  assert.equal(doctorJson.toolReadiness.kind, "computer-linker-tool-readiness");
  assert.equal(doctorJson.toolReadiness.ready, true);
  assert.deepEqual(doctorJson.toolReadiness.requiredMissing, []);
  assert.ok(Array.isArray(doctorJson.toolReadiness.recommendedMissing));
  assert.ok(doctorJson.toolReadiness.availableRecommended.every((tool) => typeof tool === "string"));
  assert.ok(doctorJson.localTools.find((tool) => tool.name === "rg")?.usedFor?.some((item) => item.includes("Fast universal text search")));
  assert.equal(doctorJson.configDiagnostics.criticalCount, 0);
  assert.ok(Array.isArray(doctorJson.configDiagnostics.findings));
  assert.equal(doctorJson.releaseReadiness.kind, "computer-linker-release-readiness");
  assert.equal(doctorJson.releaseReadiness.ready, true);
  assert.match(doctorJson.releaseReadiness.status, /ready|needs_attention/);
  assert.equal(doctorJson.releaseReadiness.recommendedGate, "npm run product:check");
  assert.ok(doctorJson.releaseReadiness.checks.some((check) => check.id === "command-policy"));
  assert.ok(Array.isArray(doctorJson.nextActions));

  const statusOutput = (await runCliOutput("status")).stdout;
  assert.match(statusOutput, /Computer Linker status for cli-test/);
  assert.match(statusOutput, /ready: (ready with warnings|blocked)/);
  assert.match(statusOutput, /connect: https:\/\/computer-linker\.example\.com\/mcp/);
  assert.match(statusOutput, /local MCP: http:\/\/127\.0\.0\.1:3939\/mcp/);
  assert.match(statusOutput, /auth: owner token configured/);
  assert.match(statusOutput, /workspaces: 1 configured, 1 command/);
  assert.match(statusOutput, /tunnel: public URL configured \(https:\/\/computer-linker\.example\.com\)/);
  if (/ready: blocked/.test(statusOutput)) {
    assert.match(statusOutput, /blocked by:/);
    assert.match(statusOutput, /  - .+/);
  } else {
    assert.match(statusOutput, /attention: \d+ warnings; run `computer-linker status --details`/);
  }
  assert.match(statusOutput, /next:/);
  assert.match(statusOutput, /details: computer-linker status --details/);
  assert.doesNotMatch(statusOutput, /config: /);
  assert.doesNotMatch(statusOutput, /Workspace app has shell access enabled/);
  assert.doesNotMatch(statusOutput, /Workspace app can run commands but has no command allowlist yet\./);
  assert.doesNotMatch(statusOutput, /config:workspace-execution-policy-missing/);
  assert.doesNotMatch(statusOutput, /security:shell-broad-access/);
  assert.doesNotMatch(statusOutput, /security:command-allowlist-missing/);

  const detailedStatusOutput = (await runCliOutput("status", "--details")).stdout;
  assert.match(detailedStatusOutput, /Computer Linker status for cli-test/);
  assert.match(detailedStatusOutput, /readiness: (ready with warnings|blocked)/);
  assert.doesNotMatch(statusOutput, /releaseStatus:/);
  assert.match(detailedStatusOutput, /local MCP URL: http:\/\/127\.0\.0\.1:3939\/mcp/);
  assert.doesNotMatch(statusOutput, /localMcpUrl:/);
  assert.doesNotMatch(statusOutput, /localApiUrl:/);
  assert.match(detailedStatusOutput, /public MCP URL: https:\/\/computer-linker\.example\.com\/mcp/);
  assert.doesNotMatch(statusOutput, /publicMcpUrl:/);
  assert.doesNotMatch(statusOutput, /ownerToken=configured/);
  assert.match(detailedStatusOutput, /workspaces: 1/);
  assert.match(detailedStatusOutput, /Workspace app has shell access enabled/);
  assert.match(detailedStatusOutput, /Workspace app can run commands but has no command allowlist yet\./);
  assert.doesNotMatch(detailedStatusOutput, /config:workspace-execution-policy-missing/);
  assert.doesNotMatch(detailedStatusOutput, /security:shell-broad-access/);
  assert.doesNotMatch(detailedStatusOutput, /security:command-allowlist-missing/);
  assert.match(detailedStatusOutput, /next actions:/);
  const statusJson = JSON.parse((await runCliOutput("status", "--json")).stdout) as {
    kind: string;
    schemaVersion: number;
    ready: boolean;
    status: string;
    urls: { localMcpUrl: string; localApiUrl: string; publicMcpUrl?: string };
    workspaces: { total: number; items: Array<{ id: string; permissions: { write: boolean; shell: boolean; codex: boolean } }> };
    tunnel: { openAiSecureTunnelActive: boolean };
    readiness: {
      startupReady: boolean;
      releaseStatus: string;
      blockingReasons: string[];
      warnings: string[];
      configCriticalCount: number;
      configWarningCount: number;
      securityCriticalCount: number;
      securityWarningCount: number;
    };
    nextActions: string[];
  };
  assert.equal(statusJson.kind, "computer-linker-status");
  assert.equal(statusJson.schemaVersion, 1);
  assert.equal(typeof statusJson.ready, "boolean");
  assert.equal(statusJson.urls.localMcpUrl, "http://127.0.0.1:3939/mcp");
  assert.equal(statusJson.urls.localApiUrl, "http://127.0.0.1:3939/api/v1");
  assert.equal(statusJson.urls.publicMcpUrl, "https://computer-linker.example.com/mcp");
  assert.equal(statusJson.workspaces.total, 1);
  assert.equal(statusJson.workspaces.items[0].id, "app");
  assert.equal(statusJson.workspaces.items[0].permissions.shell, true);
  assert.equal(statusJson.tunnel.openAiSecureTunnelActive, false);
  assert.equal(statusJson.readiness.startupReady, true);
  assert.equal(statusJson.readiness.releaseStatus, statusJson.status);
  assert.ok(Array.isArray(statusJson.readiness.blockingReasons));
  assert.ok(Array.isArray(statusJson.readiness.warnings));
  assert.equal(typeof statusJson.readiness.configWarningCount, "number");
  assert.equal(typeof statusJson.readiness.securityWarningCount, "number");
  assert.ok(Array.isArray(statusJson.nextActions));
  await assert.rejects(
    () => runCliOutput("status", "--bad"),
    /Unknown status option: --bad/,
  );

  const beforeFreshBootstrapConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  process.env.COMPUTER_LINKER_CONFIG_DIR = join(root, "fresh-bootstrap-config");
  try {
    const freshBootstrapStatusOutput = (await runCliOutput("status")).stdout;
    assert.match(freshBootstrapStatusOutput, /workspaces: bootstrap read-only current directory/);
    const freshBootstrapStatusJson = JSON.parse((await runCliOutput("status", "--json")).stdout) as {
      workspaces: { total: number; items: Array<{ id: string; permissions: { write: boolean; shell: boolean } }> };
      readiness: { configWarningCount: number; securityWarningCount: number };
    };
    assert.equal(freshBootstrapStatusJson.workspaces.total, 1);
    assert.equal(freshBootstrapStatusJson.workspaces.items[0].id, "current");
    assert.equal(freshBootstrapStatusJson.workspaces.items[0].permissions.write, false);
    assert.equal(freshBootstrapStatusJson.workspaces.items[0].permissions.shell, false);
    assert.equal(freshBootstrapStatusJson.readiness.configWarningCount, 0);
    assert.equal(freshBootstrapStatusJson.readiness.securityWarningCount, 0);
    const freshBootstrapDoctorJson = JSON.parse((await runCliOutput("doctor", "--json")).stdout) as {
      configDiagnostics: { findings: Array<{ id: string; workspaceId?: string }> };
    };
    assert.ok(freshBootstrapDoctorJson.configDiagnostics.findings.some((finding) => finding.id === "bootstrap-current-read-only" && finding.workspaceId === "current"));
  } finally {
    if (beforeFreshBootstrapConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = beforeFreshBootstrapConfigDir;
  }

  const beforeBootstrapStatusConfig = loadConfig();
  writeConfig({
    machineName: "cli-test",
    ownerToken: "token",
    publicBaseUrl: "https://computer-linker.example.com",
    workspaces: [
      {
        id: "current",
        name: "Current directory",
        path: process.cwd(),
        permissions: { read: true, write: true, shell: true, codex: false, screen: false },
      },
      {
        id: "app",
        name: "App",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false, screen: false },
      },
    ],
  });
  const bootstrapStatusOutput = (await runCliOutput("status")).stdout;
  assert.match(bootstrapStatusOutput, /Run `computer-linker doctor --fix` to remove the default current-directory scope now that explicit workspaces are configured\./);
  assert.doesNotMatch(bootstrapStatusOutput, /Workspace current can run local commands but has no execution policy yet\./);
  assert.doesNotMatch(bootstrapStatusOutput, /config:workspace-execution-policy-missing/);
  assert.doesNotMatch(bootstrapStatusOutput, /Run `computer-linker doctor --fix` to add default execution policy for shell\/Codex scopes\./);
  const bootstrapDetailedStatusOutput = (await runCliOutput("status", "--details")).stdout;
  assert.match(bootstrapDetailedStatusOutput, /Workspace current can run local commands but has no execution policy yet\./);
  const bootstrapStatusJson = JSON.parse((await runCliOutput("status", "--json")).stdout) as { nextActions: string[] };
  assert.ok(bootstrapStatusJson.nextActions.some((action) => action.includes("remove the default current-directory scope")));
  assert.equal(bootstrapStatusJson.nextActions.some((action) => action.includes("add default execution policy for shell/Codex scopes")), false);
  const cleanupSetup = JSON.parse((await runCliOutput("setup", bootstrapCleanupRoot, "--json")).stdout) as {
    workspace: { id: string; path: string };
    removedBootstrapWorkspaces: Array<{ id: string; name: string; path: string }>;
  };
  assert.equal(cleanupSetup.workspace.id, "bootstrap-cleanup");
  assert.deepEqual(cleanupSetup.removedBootstrapWorkspaces.map((workspace) => workspace.id), ["current"]);
  const cleanupConfig = loadConfig();
  assert.equal(cleanupConfig.workspaces.some((workspace) => workspace.id === "current"), false);
  assert.ok(cleanupConfig.workspaces.some((workspace) => workspace.id === "bootstrap-cleanup" && workspace.path === bootstrapCleanupRoot));
  writeConfig(beforeBootstrapStatusConfig);

  const beforeDuplicateStatusConfig = loadConfig();
  writeConfig({
    ...beforeDuplicateStatusConfig,
    workspaces: [
      ...beforeDuplicateStatusConfig.workspaces,
      {
        id: "dup-read",
        name: "Duplicate read",
        path: tailscaleRoot,
        permissions: { read: true, write: false, shell: false, codex: false, screen: false },
      },
      {
        id: "dup-write",
        name: "Duplicate write",
        path: tailscaleRoot,
        permissions: { read: true, write: true, shell: false, codex: false, screen: false },
      },
    ],
  });
  const duplicateStatusOutput = (await runCliOutput("status")).stdout;
  assert.doesNotMatch(duplicateStatusOutput, /Duplicate workspace path: dup-write points at a folder already exposed by another workspace\./);
  assert.doesNotMatch(duplicateStatusOutput, /config:workspace-path-duplicate/);
  assert.match(duplicateStatusOutput, /Duplicate workspace scopes share one folder but have different permissions: dup-read \[read\], dup-write \[read,write\]/);
  assert.match(duplicateStatusOutput, /computer-linker workspace remove <id>/);
  assert.doesNotMatch(duplicateStatusOutput, /computer-linker workspace remove dup-write/);
  const duplicateDetailedStatusOutput = (await runCliOutput("status", "--details")).stdout;
  assert.match(duplicateDetailedStatusOutput, /Duplicate workspace path: dup-write points at a folder already exposed by another workspace\./);
  assert.doesNotMatch(duplicateDetailedStatusOutput, /config:workspace-path-duplicate/);
  const duplicateStatusJson = JSON.parse((await runCliOutput("status", "--json")).stdout) as { nextActions: string[] };
  assert.ok(duplicateStatusJson.nextActions.some((action) => action.includes("different permissions") && action.includes("dup-read [read], dup-write [read,write]")));
  assert.equal(duplicateStatusJson.nextActions.some((action) => action.includes("workspace remove dup-write")), false);
  writeConfig(beforeDuplicateStatusConfig);

  const configuredStatusConfig = loadConfig();
  writeConfig({
    ...configuredStatusConfig,
    publicBaseUrl: undefined,
  });
  await writeFile(join(root, "config", "tunnels.json"), `${JSON.stringify([{
    id: "tunnel_openai_test",
    provider: "openai",
    localPort: 3939,
    command: "tunnel-client",
    args: ["run", "--control-plane.tunnel-id", "tunnel_test"],
    display: "tunnel-client run --control-plane.tunnel-id tunnel_test",
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
  }], null, 2)}\n`);
  const openAiTunnelStatus = (await runCliOutput("status")).stdout;
  assert.match(openAiTunnelStatus, /connect: OpenAI Tunnel mode; no public URL or pasted bearer token/);
  assert.match(openAiTunnelStatus, /auth: handled by local tunnel-client/);
  assert.match(openAiTunnelStatus, /tunnel: OpenAI Secure MCP Tunnel active/);
  assert.match(openAiTunnelStatus, /OpenAI Secure MCP Tunnel is running; use Tunnel mode/);
  assert.doesNotMatch(openAiTunnelStatus, /public MCP URL:/);
  assert.doesNotMatch(openAiTunnelStatus, /Set publicBaseUrl/);
  assert.doesNotMatch(openAiTunnelStatus, /security:public-base-url-missing/);
  const openAiTunnelDetailedStatus = (await runCliOutput("status", "--details")).stdout;
  assert.match(openAiTunnelDetailedStatus, /tunnel: openai secure MCP tunnel active \(no public URL\)/);
  assert.match(openAiTunnelDetailedStatus, /public MCP URL: not used in OpenAI tunnel mode/);
  const openAiTunnelStatusText = (await runCliOutput("tunnel", "status")).stdout;
  assert.match(openAiTunnelStatusText, /publicBaseUrl: not required for OpenAI Secure MCP Tunnel/);
  assert.match(openAiTunnelStatusText, /effectivePublicUrl: not used in OpenAI Secure MCP Tunnel mode/);
  assert.match(openAiTunnelStatusText, /openaiTunnel: active; use Tunnel mode in the MCP client, not a public URL/);
  assert.doesNotMatch(openAiTunnelStatusText, /effectivePublicUrl: not detected/);
  const openAiTunnelStatusJson = JSON.parse((await runCliOutput("status", "--json")).stdout) as {
    tunnel: { openAiSecureTunnelActive: boolean };
    readiness: { warnings: string[] };
    nextActions: string[];
  };
  assert.equal(openAiTunnelStatusJson.tunnel.openAiSecureTunnelActive, true);
  assert.equal(openAiTunnelStatusJson.readiness.warnings.some((warning) => warning.includes("public-base-url-missing")), false);
  assert.equal(openAiTunnelStatusJson.nextActions.some((action) => action.includes("publicBaseUrl")), false);
  const openAiTunnelClientSetup = (await runCliOutput("client", "setup")).stdout;
  assert.match(openAiTunnelClientSetup, /ready: yes \(remote\)/);
  assert.match(openAiTunnelClientSetup, /connect: OpenAI Tunnel mode \(tunnel_test\)/);
  assert.match(openAiTunnelClientSetup, /auth: handled by tunnel-client; do not paste a bearer token into ChatGPT Tunnel mode/);
  assert.match(openAiTunnelClientSetup, /tools: 3 stable MCP tools/);
  assert.match(openAiTunnelClientSetup, /tunnel id: tunnel_test/);
  assert.match(openAiTunnelClientSetup, /details: computer-linker client setup --details/);
  assert.doesNotMatch(openAiTunnelClientSetup, /remoteReady: yes/);
  assert.doesNotMatch(openAiTunnelClientSetup, /publicMcpUrl: \(not used in OpenAI tunnel mode\)/);
  assert.doesNotMatch(openAiTunnelClientSetup, /tunnelMcpTarget:/);
  assert.match(openAiTunnelClientSetup, /do not paste a bearer token into ChatGPT Tunnel mode/);
  assert.doesNotMatch(openAiTunnelClientSetup, /remote blockers:/);
  assert.doesNotMatch(openAiTunnelClientSetup, /No public MCP URL/);
  assert.doesNotMatch(openAiTunnelClientSetup, /bearerHeader: Authorization: Bearer <ownerToken>/);
  const openAiTunnelClientSetupDetails = (await runCliOutput("client", "setup", "--details")).stdout;
  assert.match(openAiTunnelClientSetupDetails, /remoteReady: yes/);
  assert.match(openAiTunnelClientSetupDetails, /publicMcpUrl: \(not used in OpenAI tunnel mode\)/);
  assert.match(openAiTunnelClientSetupDetails, /tunnel: OpenAI Secure MCP Tunnel active/);
  assert.match(openAiTunnelClientSetupDetails, /tunnelId: tunnel_test/);
  assert.match(openAiTunnelClientSetupDetails, /auth: openai-secure-tunnel/);
  assert.match(openAiTunnelClientSetupDetails, /do not paste a bearer token into ChatGPT Tunnel mode/);
  const openAiTunnelClientSetupJson = JSON.parse((await runCliOutput("client", "setup", "--json")).stdout) as {
    remoteReady: boolean;
    connection: { publicMcpUrl: string | null; tunnel: { provider: string; tunnelId: string; localMcpTarget: string } | null };
    auth: { mode: string; bearerHeader: string | null; localBearerHeader: string | null };
    remoteBlockingReasons: string[];
    warnings: string[];
    nextActions: string[];
  };
  assert.equal(openAiTunnelClientSetupJson.remoteReady, true);
  assert.equal(openAiTunnelClientSetupJson.connection.publicMcpUrl, null);
  assert.equal(openAiTunnelClientSetupJson.connection.tunnel?.provider, "openai");
  assert.equal(openAiTunnelClientSetupJson.connection.tunnel?.tunnelId, "tunnel_test");
  assert.equal(openAiTunnelClientSetupJson.connection.tunnel?.localMcpTarget, "http://127.0.0.1:3939/mcp");
  assert.equal(openAiTunnelClientSetupJson.auth.mode, "openai-secure-tunnel");
  assert.equal(openAiTunnelClientSetupJson.auth.bearerHeader, null);
  assert.equal(openAiTunnelClientSetupJson.auth.localBearerHeader, "Authorization: Bearer <ownerToken>");
  assert.deepEqual(openAiTunnelClientSetupJson.remoteBlockingReasons, []);
  assert.equal(openAiTunnelClientSetupJson.warnings.some((warning) => warning.includes("No public MCP URL")), false);
  assert.ok(openAiTunnelClientSetupJson.nextActions.some((action) => action.includes("Tunnel mode") && action.includes("tunnel_test")));
  const openAiTunnelDoctor = (await runCliOutput("doctor")).stdout;
  assert.doesNotMatch(openAiTunnelDoctor, /public-base-url-missing/);
  assert.doesNotMatch(openAiTunnelDoctor, /Set publicBaseUrl/);
  const openAiTunnelDoctorJson = JSON.parse((await runCliOutput("doctor", "--json")).stdout) as {
    exposure: { warnings: string[] };
    security: { findings: Array<{ id: string }> };
    releaseReadiness: { warnings: string[] };
    nextActions: string[];
  };
  assert.equal(openAiTunnelDoctorJson.security.findings.some((finding) => finding.id === "public-base-url-missing"), false);
  assert.equal(openAiTunnelDoctorJson.exposure.warnings.some((warning) => warning.includes("publicBaseUrl")), false);
  assert.equal(openAiTunnelDoctorJson.releaseReadiness.warnings.some((warning) => warning.includes("public-base-url-missing")), false);
  assert.equal(openAiTunnelDoctorJson.nextActions.some((action) => action.includes("publicBaseUrl")), false);
  writeConfig(configuredStatusConfig);
  await rm(join(root, "config", "tunnels.json"), { force: true });

  const tunnelStatusText = (await runCliOutput("tunnel", "status")).stdout;
  assert.match(tunnelStatusText, /publicBaseUrl: https:\/\/computer-linker\.example\.com/);
  assert.match(tunnelStatusText, /effectivePublicUrl: https:\/\/computer-linker\.example\.com/);
  assert.match(tunnelStatusText, /providers:/);
  assert.match(tunnelStatusText, /commands:/);
  const tunnelStatusJson = JSON.parse((await runCliOutput("tunnel", "status", "--json")).stdout) as {
    kind: string;
    schemaVersion: number;
    localPort: number;
    publicBaseUrl: string;
    effectivePublicUrl: string;
    effectivePublicUrlSource: string;
    providerContracts: Array<{ provider: string; lifecycle: { detect: boolean; status: boolean; expose: boolean; getPublicUrl: boolean; stop: boolean } }>;
    providers: Array<{ provider: string; publicUrl?: string }>;
  };
  assert.equal(tunnelStatusJson.kind, "tunnel-status");
  assert.equal(tunnelStatusJson.schemaVersion, 1);
  assert.equal(tunnelStatusJson.localPort, 3939);
  assert.equal(tunnelStatusJson.publicBaseUrl, "https://computer-linker.example.com");
  assert.equal(tunnelStatusJson.effectivePublicUrl, "https://computer-linker.example.com");
  assert.equal(tunnelStatusJson.effectivePublicUrlSource, "configured");
  assert.ok(tunnelStatusJson.providerContracts.some((provider) => (
    provider.provider === "cloudflare" &&
    provider.lifecycle.detect &&
    provider.lifecycle.status &&
    provider.lifecycle.expose &&
    provider.lifecycle.getPublicUrl &&
    provider.lifecycle.stop
  )));
  assert.ok(tunnelStatusJson.providers.some((provider) => provider.provider === "cloudflare"));
  const cliManagedClientDir = join(root, "config", "tools", "openai-tunnel-client");
  const cliManagedClientPath = join(cliManagedClientDir, process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
  await mkdir(cliManagedClientDir, { recursive: true });
  await writeFile(cliManagedClientPath, "not a real tunnel-client binary\n", "utf8");
  await writeFile(join(cliManagedClientDir, "release.json"), `${JSON.stringify({
    schemaVersion: 1,
    provider: "openai",
    repository: "openai/tunnel-client",
    releaseTag: "v1.2.3",
    releaseUrl: "https://github.com/openai/tunnel-client/releases/tag/v1.2.3",
    assetName: "tunnel-client-windows-amd64.zip",
    sha256: "b".repeat(64),
    installedAt: "2026-06-28T00:00:00.000Z",
  }, null, 2)}\n`, "utf8");
  const openAiClientStatusText = (await runCliOutput("tunnel", "openai-client", "status")).stdout;
  assert.match(openAiClientStatusText, /OpenAI tunnel-client status/);
  assert.match(openAiClientStatusText, /source: managed/);
  assert.match(openAiClientStatusText, /release: v1\.2\.3/);
  assert.match(openAiClientStatusText, /sha256: b{64}/);
  assert.match(openAiClientStatusText, /updateBehavior: cached managed binary is reused/);
  const openAiClientStatusJson = JSON.parse((await runCliOutput("tunnel", "openai-client", "status", "--json")).stdout) as {
    kind: string;
    tunnelClient: { source: string; path: string; releaseTag: string; sha256: string; installedAt: string };
    updateBehavior: string;
  };
  assert.equal(openAiClientStatusJson.kind, "openai-tunnel-client-status");
  assert.equal(openAiClientStatusJson.tunnelClient.source, "managed");
  assert.equal(openAiClientStatusJson.tunnelClient.path, cliManagedClientPath);
  assert.equal(openAiClientStatusJson.tunnelClient.releaseTag, "v1.2.3");
  assert.equal(openAiClientStatusJson.tunnelClient.sha256, "b".repeat(64));
  assert.equal(openAiClientStatusJson.tunnelClient.installedAt, "2026-06-28T00:00:00.000Z");
  assert.match(openAiClientStatusJson.updateBehavior, /refresh/);
  const tunnelStatusWithClientJson = JSON.parse((await runCliOutput("tunnel", "status", "--json")).stdout) as {
    tools: Array<{ name: string; source?: string; releaseTag?: string; sha256?: string }>;
  };
  const openAiTool = tunnelStatusWithClientJson.tools.find((tool) => tool.name === "tunnel-client");
  assert.equal(openAiTool?.source, "managed");
  assert.equal(openAiTool?.releaseTag, "v1.2.3");
  assert.equal(openAiTool?.sha256, "b".repeat(64));
  await rm(cliManagedClientDir, { recursive: true, force: true });
  await assert.rejects(
    () => runCliOutput("tunnel", "status", "--bad"),
    /Unknown tunnel status option: --bad/,
  );

  await assert.rejects(
    () => runCliOutput("doctor", "--bad"),
    /Unknown doctor option: --bad/,
  );

  const historyLastText = (await runCliOutput("history", "--view", "last", "--limit", "20")).stdout;
  assert.match(historyLastText, /Computer Linker history \(last\)/);
  assert.match(historyLastText, /events: total=/);
  assert.match(historyLastText, /next actions:/);
  const historyConnections = JSON.parse((await runCliOutput("history", "--view", "connections", "--limit", "20", "--json")).stdout) as {
    view: string;
    connections?: unknown[];
  };
  assert.equal(historyConnections.view, "connections");
  assert.ok(Array.isArray(historyConnections.connections));
  const historyBundlePath = join(root, "history-debug-bundle.json");
  const historyDebugBundle = JSON.parse((await runCliOutput(
    "history",
    "--view",
    "debug_bundle",
    "--workspace",
    "app",
    "--limit",
    "20",
    "--json",
    "--output",
    historyBundlePath,
  )).stdout) as {
    view: string;
    debugBundle?: {
      format: string;
      redactions: string[];
      events: unknown[];
      connections: unknown[];
    };
  };
  assert.equal(historyDebugBundle.view, "debug_bundle");
  assert.equal(historyDebugBundle.debugBundle?.format, "computer-linker-debug-bundle-v1");
  assert.ok(historyDebugBundle.debugBundle?.redactions.some((redaction) => redaction.includes("Owner tokens")));
  assert.ok(Array.isArray(historyDebugBundle.debugBundle?.events));
  assert.ok(Array.isArray(historyDebugBundle.debugBundle?.connections));
  assert.deepEqual(JSON.parse(await readFile(historyBundlePath, "utf8")), historyDebugBundle);
  await assert.rejects(
    () => runCliOutput("history", "--view", "bad"),
    /history --view must be one of/,
  );
  await assert.rejects(
    () => runCliOutput("history", "--bad"),
    /Unknown history option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("history", "--workspace"),
    /history --workspace requires a value/,
  );
  await assert.rejects(
    () => runCliOutput("history", "extra"),
    /Unknown history argument: extra/,
  );

  markCliSection("generic client setup and smoke");
  const configuredProfile = JSON.parse((await runCliOutput("profile")).stdout) as {
    http: { publicMcpUrl: string };
  };
  assert.equal(configuredProfile.http.publicMcpUrl, "https://computer-linker.example.com/mcp");
  const mcpClientSetup = JSON.parse((await runCliOutput("client", "setup", "--json")).stdout) as {
    kind: string;
    localReady: boolean;
    remoteReady: boolean;
    connection: { localMcpUrl: string; publicMcpUrl: string | null; publicBaseUrlSource: string | null };
    auth: { mode: string; bearerHeader: string | null; alternateBearerHeader: string | null };
    tools: string[];
    firstPrompt: string;
    agentInstructions: string[];
    remoteBlockingReasons: string[];
  };
  assert.equal(mcpClientSetup.kind, "computer-linker-mcp-client-setup");
  assert.equal(mcpClientSetup.localReady, true);
  assert.equal(mcpClientSetup.remoteReady, true);
  assert.match(mcpClientSetup.connection.localMcpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.equal(mcpClientSetup.connection.publicMcpUrl, "https://computer-linker.example.com/mcp");
  assert.equal(mcpClientSetup.connection.publicBaseUrlSource, "configured");
  assert.equal(mcpClientSetup.auth.mode, "owner-token-or-oauth");
  assert.equal(mcpClientSetup.auth.bearerHeader, "Authorization: Bearer <ownerToken>");
  assert.equal(mcpClientSetup.auth.alternateBearerHeader, "x-computer-linker-token: <ownerToken>");
  assert.deepEqual(mcpClientSetup.tools, ["get_computer_info", "computer_operation", "get_operation_history"]);
  assert.match(mcpClientSetup.firstPrompt, /Call get_computer_info/);
  assert.match(mcpClientSetup.firstPrompt, /dotted ops from computerOperationRegistry/);
  assert.match(mcpClientSetup.firstPrompt, /Do not call compatibility workspace tools/);
  assert.ok(mcpClientSetup.agentInstructions.some((line) => line.includes("Call computer_operation with dotted ops")));
  assert.ok(mcpClientSetup.agentInstructions.some((line) => line.includes("Do not call workspace_operation")));
  assert.deepEqual(mcpClientSetup.remoteBlockingReasons, []);
  const mcpClientSetupText = (await runCliOutput("client", "setup")).stdout;
  assert.match(mcpClientSetupText, /Computer Linker MCP client setup/);
  assert.match(mcpClientSetupText, /ready: yes \(remote\)/);
  assert.match(mcpClientSetupText, /connect: https:\/\/computer-linker\.example\.com\/mcp/);
  assert.match(mcpClientSetupText, /auth: bearer token configured/);
  assert.match(mcpClientSetupText, /tools: 3 stable MCP tools/);
  assert.match(mcpClientSetupText, /details: computer-linker client setup --details/);
  assert.doesNotMatch(mcpClientSetupText, /localMcpUrl:/);
  assert.doesNotMatch(mcpClientSetupText, /publicMcpUrl:/);
  assert.doesNotMatch(mcpClientSetupText, /tools: get_computer_info, computer_operation, get_operation_history/);
  assert.doesNotMatch(mcpClientSetupText, /agent instructions:/);
  assert.doesNotMatch(mcpClientSetupText, /Do not call workspace_operation/);
  assert.doesNotMatch(mcpClientSetupText, /Authorization: Bearer token/);
  const mcpClientSetupDetails = (await runCliOutput("client", "setup", "--details")).stdout;
  assert.match(mcpClientSetupDetails, /localMcpUrl: http:\/\/127\.0\.0\.1:\d+\/mcp/);
  assert.match(mcpClientSetupDetails, /publicMcpUrl: https:\/\/computer-linker\.example\.com\/mcp/);
  assert.match(mcpClientSetupDetails, /tools: get_computer_info, computer_operation, get_operation_history/);
  assert.match(mcpClientSetupDetails, /agent instructions:/);
  assert.match(mcpClientSetupDetails, /Do not call workspace_operation/);
  const mcpClientSetupTextWithToken = (await runCliOutput("client", "setup", "--show-token")).stdout;
  assert.match(mcpClientSetupTextWithToken, /auth: bearer token shown below/);
  assert.match(mcpClientSetupTextWithToken, /bearer header: Authorization: Bearer token/);
  const mcpClientSetupJsonWithToken = JSON.parse((await runCliOutput("client", "setup", "--show-token", "--json")).stdout) as {
    auth: { bearerHeader: string | null; alternateBearerHeader: string | null };
  };
  assert.equal(mcpClientSetupJsonWithToken.auth.bearerHeader, "Authorization: Bearer token");
  assert.equal(mcpClientSetupJsonWithToken.auth.alternateBearerHeader, "x-computer-linker-token: token");
  await assert.rejects(
    () => runCliOutput("client", "setup", "--bad"),
    /Unknown client setup option: --bad/,
  );
  const mcpClientSmokeBadUrl = JSON.parse((await runCliOutput("client", "smoke", "--url", "not a url", "--json")).stdout) as {
    kind: string;
    ready: boolean;
    checks: Array<{ id: string; status: string; message: string }>;
    blockingReasons: string[];
    nextActions: string[];
  };
  assert.equal(mcpClientSmokeBadUrl.kind, "computer-linker-client-smoke");
  assert.equal(mcpClientSmokeBadUrl.ready, false);
  assert.ok(mcpClientSmokeBadUrl.blockingReasons.some((reason) => reason.includes("base-url")));
  assert.equal(JSON.stringify(mcpClientSmokeBadUrl).includes("ChatGPT"), false);
  const mcpClientSmokeText = (await runCliOutput("client", "smoke", "--url", "not a url")).stdout;
  assert.match(mcpClientSmokeText, /Computer Linker MCP client smoke/);
  assert.match(mcpClientSmokeText, /Smoke URL must be a valid URL/);
  assert.doesNotMatch(mcpClientSmokeText, /ChatGPT/);
  const mcpClientSmokeHttpText = (await runCliOutput("client", "smoke", "--url", "http://127.0.0.1:3939")).stdout;
  assert.match(mcpClientSmokeHttpText, /MCP client smoke URL must use https:\/\//);
  assert.doesNotMatch(mcpClientSmokeText, /ChatGPT/);
  await assert.rejects(
    () => runCliOutput("client", "smoke", "--bad"),
    /Unknown client smoke option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("client", "smoke", "--timeout-ms", "bad"),
    /client smoke --timeout-ms requires a positive integer/,
  );
  const mcpClientDiagnoseJson = JSON.parse((await runCliOutput("diagnose", "client", "--url", "not a url", "--json")).stdout) as {
    kind: string;
    target: string;
    setup: { localReady: boolean; remoteReady: boolean };
    smoke: { ready: boolean };
    history: { connections: { view: string }; last: { view: string } };
    diagnosis: { ready: boolean; blockingReasons: string[]; nextActions: string[] };
  };
  assert.equal(mcpClientDiagnoseJson.kind, "computer-linker-client-diagnosis");
  assert.equal(mcpClientDiagnoseJson.target, "url");
  assert.equal(mcpClientDiagnoseJson.setup.localReady, true);
  assert.equal(mcpClientDiagnoseJson.setup.remoteReady, true);
  assert.equal(mcpClientDiagnoseJson.smoke.ready, false);
  assert.equal(mcpClientDiagnoseJson.history.connections.view, "connections");
  assert.equal(mcpClientDiagnoseJson.history.last.view, "last");
  assert.ok(mcpClientDiagnoseJson.diagnosis.blockingReasons.some((reason) => reason.includes("base-url")));
  assert.ok(mcpClientDiagnoseJson.diagnosis.nextActions.length > 0);
  const mcpClientDiagnoseText = (await runCliOutput("client", "diagnose", "--url", "not a url")).stdout;
  assert.match(mcpClientDiagnoseText, /Computer Linker client diagnosis/);
  assert.match(mcpClientDiagnoseText, /ready: no/);
  assert.match(mcpClientDiagnoseText, /blocked by:/);
  await assert.rejects(
    () => runCliOutput("client", "diagnose", "--bad"),
    /Unknown client diagnose option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("client", "diagnose", "--local", "--remote"),
    /client diagnose accepts only one target/,
  );
  await assert.rejects(
    () => runCliOutput("client", "bad"),
    /Usage: computer-linker client <setup\|smoke\|diagnose\|chatgpt>/,
  );
  const checkJson = JSON.parse((await runCliOutput("check", "--json")).stdout) as {
    kind: string;
    ready: boolean;
    tempKept: boolean;
    localMcpUrl: string;
    smoke: { checks: Array<{ id: string; status: string }>; authHeader: string };
  };
  assert.equal(checkJson.kind, "computer-linker-self-test");
  assert.equal(checkJson.ready, true);
  assert.equal(checkJson.tempKept, false);
  assert.match(checkJson.localMcpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.equal(checkJson.smoke.authHeader, "Authorization: Bearer <ownerToken>");
  assert.ok(checkJson.smoke.checks.some((check) => check.id === "mcp-list-tools" && check.status === "pass"));
  assert.ok(checkJson.smoke.checks.some((check) => check.id === "mcp-get-computer-info" && check.status === "pass"));
  assert.ok(checkJson.smoke.checks.some((check) => check.id === "mcp-read-only-operation" && check.status === "pass"));
  const checkText = (await runCliOutput("check")).stdout;
  assert.match(checkText, /Computer Linker self-test/);
  assert.match(checkText, /ready: yes/);
  assert.match(checkText, /\[pass\] mcp-read-only-operation/);
  await assert.rejects(
    () => runCliOutput("check", "--bad"),
    /Unknown check option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("check", "--timeout-ms", "bad"),
    /check --timeout-ms requires a positive integer/,
  );
  const selfTestJson = JSON.parse((await runCliOutput("self-test", "--json")).stdout) as {
    kind: string;
    ready: boolean;
  };
  assert.equal(selfTestJson.kind, "computer-linker-self-test");
  assert.equal(selfTestJson.ready, true);
  markCliSection("ChatGPT compatibility helpers");
  const chatGptTools = ["get_computer_info", "computer_operation", "get_operation_history"];
  const chatGptProfile = JSON.parse((await runCliOutput("client", "chatgpt", "profile")).stdout) as {
    kind: string;
    mode: string;
    name: string;
    mcpServerUrl: string;
    publicBaseUrl: string | null;
    auth: { bearer: { header: string | null; token?: string; alternateHeader: string | null } };
    tools: string[];
    operationShape: { envelope: { op: string; input: { query?: string }; options: { maxResults?: number } } };
    recommendedFlow: Array<{ tool: string }>;
    modelGuide: {
      mcpEntrypoint: string;
      jsonApiEntrypoint: {
        endpoint: string;
        action: string;
        availability: string;
        publicTunnelDefault: string;
      };
      operationSelection: Array<{ op: string }>;
    };
    workflowRecipes: Array<{ name: string; steps: Array<{ tool: string; input?: { op?: string } }> }>;
    warnings: string[];
  };
  assert.equal(chatGptProfile.kind, "chatgpt-mcp-app");
  assert.equal(chatGptProfile.mode, "coding");
  assert.equal(chatGptProfile.name, "Computer Linker (cli-test)");
  assert.equal(chatGptProfile.mcpServerUrl, "https://computer-linker.example.com/mcp");
  assert.equal(chatGptProfile.publicBaseUrl, "https://computer-linker.example.com");
  assert.equal(chatGptProfile.auth.bearer.header, "Authorization: Bearer <ownerToken>");
  assert.equal(chatGptProfile.auth.bearer.token, undefined);
  assert.equal(chatGptProfile.auth.bearer.alternateHeader, "x-computer-linker-token: <ownerToken>");
  assert.deepEqual(chatGptProfile.tools, chatGptTools);
  assert.equal(chatGptProfile.operationShape.envelope.op, "file.search");
  assert.equal(chatGptProfile.operationShape.envelope.input.query, "TODO");
  assert.equal(chatGptProfile.operationShape.envelope.options.maxResults, 20);
  assert.deepEqual(chatGptProfile.recommendedFlow.map((step) => step.tool), ["get_computer_info", "computer_operation", "get_operation_history"]);
  assert.equal(chatGptProfile.modelGuide.mcpEntrypoint, "computer_operation");
  assert.deepEqual(chatGptProfile.modelGuide.jsonApiEntrypoint, {
    endpoint: "POST /api/v1/control",
    action: "computer_operation",
    availability: "local-or-trusted-private-only",
    publicTunnelDefault: "blocked-when-publicMcpOnly",
  });
  assert.ok(chatGptProfile.modelGuide.operationSelection.some((item) => item.op === "codex.run"));
  assert.ok(chatGptProfile.workflowRecipes.some((recipe) => recipe.name === "connect_and_orient"));
  assert.ok(chatGptProfile.workflowRecipes.some((recipe) => recipe.name === "codex_assisted_change"));
  assert.ok(chatGptProfile.warnings.every((warning) => !warning.includes("publicBaseUrl is not configured")));

  const chatGptProfileUrlOverride = JSON.parse((await runCliOutput("client", "chatgpt", "profile", "--url", "https://detected.trycloudflare.com/ignored?x=1")).stdout) as {
    mcpServerUrl: string;
    publicBaseUrl: string | null;
    warnings: string[];
  };
  assert.equal(chatGptProfileUrlOverride.mcpServerUrl, "https://detected.trycloudflare.com/mcp");
  assert.equal(chatGptProfileUrlOverride.publicBaseUrl, "https://detected.trycloudflare.com");
  assert.ok(chatGptProfileUrlOverride.warnings.some((warning) => warning.includes("overridden for this profile only")));
  assert.equal(loadConfig().publicBaseUrl, "https://computer-linker.example.com");

  const chatGptProfileWithToken = JSON.parse((await runCliOutput("client", "chatgpt", "profile", "--show-token")).stdout) as {
    auth: { bearer: { header: string | null; token?: string; alternateHeader: string | null } };
  };
  assert.equal(chatGptProfileWithToken.auth.bearer.header, "Authorization: Bearer token");
  assert.equal(chatGptProfileWithToken.auth.bearer.token, "token");
  assert.equal(chatGptProfileWithToken.auth.bearer.alternateHeader, "x-computer-linker-token: token");

  await assert.rejects(
    () => runCliOutput("connect-profile", "--chatgpt"),
    /connect-profile was removed; use `computer-linker client chatgpt profile`/,
  );
  await assert.rejects(
    () => runCliOutput("chatgpt", "profile"),
    /chatgpt was removed; use `computer-linker client chatgpt <subcommand>`/,
  );
  await assert.rejects(
    () => runCliOutput("profile", "--chatgpt"),
    /profile --chatgpt was removed; use `computer-linker client chatgpt profile`/,
  );

  const safeChatGptProfile = JSON.parse((await runCliOutput("client", "chatgpt", "profile", "--mode", "safe")).stdout) as {
    mode: string;
    setup: { mode: string; firstPrompt: string };
    operationShape: { envelope: { op: string } };
    recommendedFlow: Array<{ input?: { op?: string } }>;
    modelGuide: { operationSelection: Array<{ op: string }> };
    workflowRecipes: Array<{ name: string }>;
    gptInstructions: string[];
    warnings: string[];
  };
  assert.equal(safeChatGptProfile.mode, "safe");
  assert.equal(safeChatGptProfile.setup.mode, "safe");
  assert.match(safeChatGptProfile.setup.firstPrompt, /read-only/);
  assert.equal(safeChatGptProfile.operationShape.envelope.op, "file.search");
  assert.equal(safeChatGptProfile.recommendedFlow[1].input?.op, "code.context");
  assert.equal(safeChatGptProfile.modelGuide.operationSelection.some((item) => item.op === "file.patch"), false);
  assert.equal(safeChatGptProfile.modelGuide.operationSelection.some((item) => item.op === "codex.run"), false);
  assert.equal(safeChatGptProfile.workflowRecipes.some((recipe) => recipe.name === "implement_and_verify"), false);
  assert.ok(safeChatGptProfile.gptInstructions.some((instruction) => instruction.includes("Stay read-only")));
  assert.ok(safeChatGptProfile.warnings.some((warning) => warning.includes("Safe mode")));

  const chatGptManifest = JSON.parse((await runCliOutput("client", "chatgpt", "manifest")).stdout) as {
    kind: string;
    mode: string;
    appName: string;
    mcpServerUrl: string;
    auth: { preferred: string; fallback: string; scopes: string[] };
    tools: string[];
  };
  assert.equal(chatGptManifest.kind, "chatgpt-app-manifest");
  assert.equal(chatGptManifest.mode, "coding");
  assert.equal(chatGptManifest.appName, "Computer Linker (cli-test)");
  assert.equal(chatGptManifest.mcpServerUrl, "https://computer-linker.example.com/mcp");
  assert.equal(chatGptManifest.auth.preferred, "oauth");
  assert.equal(chatGptManifest.auth.fallback, "bearer");
  assert.deepEqual(chatGptManifest.auth.scopes, ["computer-linker"]);
  assert.deepEqual(chatGptManifest.tools, chatGptTools);

  const chatGptConnector = JSON.parse((await runCliOutput("client", "chatgpt", "connector")).stdout) as {
    kind: string;
    mode: string;
    displayName: string;
    mcpServerUrl: string;
    auth: { bearerHeader: string | null; alternateBearerHeader: string | null };
    modelGuide: { mcpEntrypoint: string };
    workflowRecipes: Array<{ name: string }>;
  };
  assert.equal(chatGptConnector.kind, "chatgpt-connector-config");
  assert.equal(chatGptConnector.mode, "coding");
  assert.equal(chatGptConnector.displayName, "Computer Linker (cli-test)");
  assert.equal(chatGptConnector.mcpServerUrl, "https://computer-linker.example.com/mcp");
  assert.equal(chatGptConnector.auth.bearerHeader, "Authorization: Bearer <ownerToken>");
  assert.equal(chatGptConnector.auth.alternateBearerHeader, "x-computer-linker-token: <ownerToken>");
  assert.equal(chatGptConnector.modelGuide.mcpEntrypoint, "computer_operation");
  assert.ok(chatGptConnector.workflowRecipes.some((recipe) => recipe.name === "search_and_read"));

  const chatGptConnectorWithToken = JSON.parse((await runCliOutput("client", "chatgpt", "connector", "--show-token")).stdout) as {
    auth: { bearerHeader: string | null };
  };
  assert.equal(chatGptConnectorWithToken.auth.bearerHeader, "Authorization: Bearer token");
  const chatGptConnectorUrlOverride = JSON.parse((await runCliOutput("client", "chatgpt", "connector", "--url", "https://connector-detected.trycloudflare.com")).stdout) as {
    mcpServerUrl: string;
    warnings: string[];
  };
  assert.equal(chatGptConnectorUrlOverride.mcpServerUrl, "https://connector-detected.trycloudflare.com/mcp");
  assert.ok(chatGptConnectorUrlOverride.warnings.some((warning) => warning.includes("overridden for this profile only")));

  const fullChatGptConnector = JSON.parse((await runCliOutput("client", "chatgpt", "connector", "--mode", "full")).stdout) as {
    mode: string;
    setup: { mode: string };
    modelGuide: { operationSelection: Array<{ op: string }> };
    gptInstructions: string[];
    warnings: string[];
  };
  assert.equal(fullChatGptConnector.mode, "full");
  assert.equal(fullChatGptConnector.setup.mode, "full");
  assert.ok(fullChatGptConnector.modelGuide.operationSelection.some((item) => item.op === "command.run"));
  assert.ok(fullChatGptConnector.gptInstructions.some((instruction) => instruction.includes("Full mode")));
  assert.ok(fullChatGptConnector.warnings.some((warning) => warning.includes("Full mode")));

  const chatGptOutputDir = join(root, "chatgpt-config");
  const chatGptFiles = JSON.parse((await runCliOutput("client", "chatgpt", "files", "--output-dir", chatGptOutputDir, "--show-token", "--mode", "safe")).stdout) as {
    kind: string;
    outputDir: string;
    files: { profile: string; manifest: string; connector: string; operationRegistry: string; index: string };
  };
  assert.equal(chatGptFiles.kind, "chatgpt-config-files");
  assert.equal(chatGptFiles.outputDir, chatGptOutputDir);
  assert.equal(chatGptFiles.files.profile, join(chatGptOutputDir, "chatgpt-profile.json"));
  assert.equal(chatGptFiles.files.manifest, join(chatGptOutputDir, "chatgpt-app-manifest.json"));
  assert.equal(chatGptFiles.files.connector, join(chatGptOutputDir, "chatgpt-connector-config.json"));
  assert.equal(chatGptFiles.files.operationRegistry, join(chatGptOutputDir, "operation-registry.json"));
  assert.equal(chatGptFiles.files.index, join(chatGptOutputDir, "chatgpt-index.json"));
  const writtenProfile = JSON.parse(await readFile(chatGptFiles.files.profile, "utf8")) as {
    kind: string;
    mode: string;
    auth: { bearer: { token?: string } };
  };
  const writtenManifest = JSON.parse(await readFile(chatGptFiles.files.manifest, "utf8")) as { kind: string; mode: string };
  const writtenConnector = JSON.parse(await readFile(chatGptFiles.files.connector, "utf8")) as {
    kind: string;
    mode: string;
    auth: { bearerHeader: string | null };
  };
  const writtenOperationRegistryText = await readFile(chatGptFiles.files.operationRegistry, "utf8");
  const writtenOperationRegistry = JSON.parse(writtenOperationRegistryText) as {
    kind: string;
    contract: {
      jsonApi: { action: string };
      envelope: { scope: string; op: string; input: Record<string, unknown>; options: Record<string, unknown> };
    };
    count: number;
    operations: Array<{ op: string; category: string; permission: string; boundary: string }>;
  };
  const writtenIndex = JSON.parse(await readFile(chatGptFiles.files.index, "utf8")) as {
    kind: string;
    mode: string;
    files: { profile: string; operationRegistry: string };
    nextSteps: string[];
  };
  assert.equal(writtenProfile.kind, "chatgpt-mcp-app");
  assert.equal(writtenProfile.mode, "safe");
  assert.equal(writtenProfile.auth.bearer.token, "token");
  assert.equal(writtenManifest.kind, "chatgpt-app-manifest");
  assert.equal(writtenManifest.mode, "safe");
  assert.equal(writtenConnector.kind, "chatgpt-connector-config");
  assert.equal(writtenConnector.mode, "safe");
  assert.equal(writtenConnector.auth.bearerHeader, "Authorization: Bearer token");
  assert.equal(writtenOperationRegistry.kind, "operation-registry");
  assert.equal(writtenOperationRegistry.contract.jsonApi.action, "computer_operation");
  assert.deepEqual(writtenOperationRegistry.contract.envelope.input, {});
  assert.deepEqual(writtenOperationRegistry.contract.envelope.options, { maxBytes: 65536 });
  assert.equal(writtenOperationRegistry.count, writtenOperationRegistry.operations.length);
  assert.ok(writtenOperationRegistry.operations.some((operation) => operation.op === "file.search" && operation.category === "file"));
  assert.ok(writtenOperationRegistry.operations.some((operation) => operation.op === "code.context" && operation.category === "code"));
  assert.ok(writtenOperationRegistry.operations.some((operation) => operation.op === "git.diff" && operation.category === "git"));
  assert.ok(writtenOperationRegistry.operations.some((operation) => operation.op === "package.run" && operation.category === "package"));
  assert.ok(writtenOperationRegistry.operations.some((operation) => operation.op === "codex.run" && operation.category === "codex"));
  assert.equal(writtenOperationRegistryText.includes("Authorization: Bearer token"), false);
  assert.equal(writtenIndex.kind, "chatgpt-config-files");
  assert.equal(writtenIndex.mode, "safe");
  assert.equal(writtenIndex.files.profile, chatGptFiles.files.profile);
  assert.equal(writtenIndex.files.operationRegistry, chatGptFiles.files.operationRegistry);
  assert.ok(writtenIndex.nextSteps.some((step) => step.includes("chatgpt-app-manifest.json")));
  assert.ok(writtenIndex.nextSteps.some((step) => step.includes("operation-registry.json")));

  const chatGptShortOutputDir = join(root, "chatgpt-config-short");
  const chatGptShortFiles = JSON.parse((await runCliOutput("client", "chatgpt", "files", chatGptShortOutputDir, "--mode", "safe")).stdout) as {
    kind: string;
    outputDir: string;
    files: { profile: string };
  };
  assert.equal(chatGptShortFiles.kind, "chatgpt-config-files");
  assert.equal(chatGptShortFiles.outputDir, chatGptShortOutputDir);
  assert.equal(chatGptShortFiles.files.profile, join(chatGptShortOutputDir, "chatgpt-profile.json"));

  const chatGptOverrideOutputDir = join(root, "chatgpt-config-override");
  const chatGptOverrideFiles = JSON.parse((await runCliOutput("client", "chatgpt", "files", "--output-dir", chatGptOverrideOutputDir, "--url", "https://files-detected.trycloudflare.com")).stdout) as {
    files: { connector: string; index: string };
  };
  const writtenOverrideConnector = JSON.parse(await readFile(chatGptOverrideFiles.files.connector, "utf8")) as {
    mcpServerUrl: string;
    warnings: string[];
  };
  assert.equal(writtenOverrideConnector.mcpServerUrl, "https://files-detected.trycloudflare.com/mcp");
  assert.ok(writtenOverrideConnector.warnings.some((warning) => warning.includes("overridden for this profile only")));

  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "files", "--output-dir"),
    /client chatgpt files --output-dir requires a directory path/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "profile", "--format", "bad"),
    /does not accept --format/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "profile", "--mode", "bad"),
    /client chatgpt profile --mode must be one of: safe, coding, full/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "profile", "--url", "http://127.0.0.1:3939"),
    /client chatgpt profile --url must use https:\/\//,
  );
  await assert.rejects(
    () => runCliOutput("profile", "--mode", "safe"),
    /profile --mode is only supported by `computer-linker client chatgpt profile --mode ...`/,
  );
  await assert.rejects(
    () => runCliOutput("profile", "--url", "https://detected.trycloudflare.com"),
    /profile --url is only supported by `computer-linker client chatgpt profile --url ...`/,
  );

  await runCli("workspace", "update", "app", "--no-codex");
  const chatGptVerifyCoding = JSON.parse((await runCliOutput("client", "chatgpt", "verify", "--mode", "coding", "--json")).stdout) as {
    kind: string;
    mode: string;
    ready: boolean;
    mcpServerUrl: string;
    publicBaseUrl: string | null;
    tools: string[];
    blockingReasons: string[];
    warnings: string[];
  };
  assert.equal(chatGptVerifyCoding.kind, "chatgpt-verify");
  assert.equal(chatGptVerifyCoding.mode, "coding");
  assert.equal(chatGptVerifyCoding.ready, true);
  assert.equal(chatGptVerifyCoding.mcpServerUrl, "https://computer-linker.example.com/mcp");
  assert.equal(chatGptVerifyCoding.publicBaseUrl, "https://computer-linker.example.com");
  assert.deepEqual(chatGptVerifyCoding.tools, chatGptTools);
  assert.deepEqual(chatGptVerifyCoding.blockingReasons, []);
  assert.ok(chatGptVerifyCoding.warnings.some((warning) => warning.includes("mode-permissions")));

  const chatGptVerifySafe = JSON.parse((await runCliOutput("client", "chatgpt", "verify", "--mode", "safe", "--json")).stdout) as {
    mode: string;
    ready: boolean;
    blockingReasons: string[];
  };
  assert.equal(chatGptVerifySafe.mode, "safe");
  assert.equal(chatGptVerifySafe.ready, false);
  assert.ok(chatGptVerifySafe.blockingReasons.some((reason) => reason.includes("mode-permissions")));

  const chatGptVerifyText = (await runCliOutput("client", "chatgpt", "verify", "--mode", "coding")).stdout;
  assert.match(chatGptVerifyText, /Computer Linker ChatGPT verify \(coding\)/);
  assert.match(chatGptVerifyText, /ready: yes/);

  const chatGptUrlJson = JSON.parse((await runCliOutput("client", "chatgpt", "url", "--json")).stdout) as {
    kind: string;
    ready: boolean;
    mcpServerUrl: string | null;
    publicBaseUrl: string | null;
    publicBaseUrlSource: string | null;
    configuredPublicBaseUrl: string | null;
    detectedPublicUrl: string | null;
    authHeader: string;
  };
  assert.equal(chatGptUrlJson.kind, "chatgpt-url");
  assert.equal(chatGptUrlJson.ready, true);
  assert.equal(chatGptUrlJson.mcpServerUrl, "https://computer-linker.example.com/mcp");
  assert.equal(chatGptUrlJson.publicBaseUrl, "https://computer-linker.example.com");
  assert.equal(chatGptUrlJson.publicBaseUrlSource, "configured");
  assert.equal(chatGptUrlJson.configuredPublicBaseUrl, "https://computer-linker.example.com");
  assert.equal(chatGptUrlJson.detectedPublicUrl, null);
  assert.equal(chatGptUrlJson.authHeader, "Authorization: Bearer <ownerToken>");

  const chatGptUrlWithToken = JSON.parse((await runCliOutput("client", "chatgpt", "url", "--show-token", "--json")).stdout) as {
    authHeader: string;
  };
  assert.equal(chatGptUrlWithToken.authHeader, "Authorization: Bearer token");

  const chatGptUrlText = (await runCliOutput("client", "chatgpt", "url")).stdout;
  assert.match(chatGptUrlText, /Computer Linker ChatGPT URL/);
  assert.match(chatGptUrlText, /mcpServerUrl: https:\/\/computer-linker\.example\.com\/mcp/);
  assert.match(chatGptUrlText, /publicBaseUrlSource: configured/);

  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "verify", "--mode", "bad"),
    /must be one of: safe, coding, full/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "verify", "--bad"),
    /Unknown client chatgpt verify option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "url", "--bad"),
    /Unknown client chatgpt url option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "smoke", "--bad"),
    /Unknown client chatgpt smoke option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("client", "chatgpt", "smoke", "--timeout-ms", "bad"),
    /client chatgpt smoke --timeout-ms requires a positive integer/,
  );
  markCliSection("doctor fixes and MCP-only setup");
  const doctorFixConfigDir = join(root, "doctor-fix-config");
  const doctorFixRunner = join(root, "doctor-fix-runner");
  const doctorFixPartial = join(root, "doctor-fix-partial");
  await mkdir(doctorFixRunner, { recursive: true });
  await mkdir(doctorFixPartial, { recursive: true });
  const beforeDoctorFixConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  process.env.COMPUTER_LINKER_CONFIG_DIR = doctorFixConfigDir;
  try {
    writeConfig({
      machineName: "doctor-fix",
      ownerToken: "token",
      workspaces: [
        {
          id: "current",
          name: "Current directory",
          path: process.cwd(),
          permissions: { read: true, write: true, shell: true, codex: false, screen: false },
        },
        {
          id: "runner",
          name: "Runner",
          path: doctorFixRunner,
          permissions: { read: true, write: false, shell: true, codex: false, screen: false },
        },
        {
          id: "runner-copy",
          name: "Runner Copy",
          path: doctorFixRunner,
          permissions: { read: true, write: false, shell: true, codex: false, screen: false },
        },
        {
          id: "partial",
          name: "Partial",
          path: doctorFixPartial,
          permissions: { read: true, write: false, shell: true, codex: false, screen: false },
          policy: { allowedCommands: ["make *"] },
        },
      ],
    });
    const dryRunRepair = JSON.parse((await runCliOutput("doctor", "--fix", "--dry-run", "--json")).stdout) as {
      kind: string;
      dryRun: boolean;
      changed: boolean;
      repairs: Array<{ id: string; status: string; workspaceId?: string }>;
    };
    assert.equal(dryRunRepair.kind, "computer-linker-config-repair");
    assert.equal(dryRunRepair.dryRun, true);
    assert.equal(dryRunRepair.changed, true);
    assert.ok(dryRunRepair.repairs.some((item) => item.id === "remove-bootstrap-current-workspace" && item.status === "planned"));
    assert.ok(dryRunRepair.repairs.some((item) => item.id === "remove-exact-duplicate-workspace" && item.status === "planned" && item.workspaceId === "runner-copy"));
    assert.ok(dryRunRepair.repairs.some((item) => item.id === "add-default-execution-policy" && item.status === "planned" && item.workspaceId === "runner"));
    const afterDryRunConfig = loadConfig();
    assert.equal(afterDryRunConfig.workspaces.some((workspace) => workspace.id === "current"), true);
    assert.equal(afterDryRunConfig.workspaces.some((workspace) => workspace.id === "runner-copy"), true);
    assert.equal(afterDryRunConfig.workspaces.find((workspace) => workspace.id === "runner")?.policy, undefined);
    const dryRunText = (await runCliOutput("doctor", "--fix", "--dry-run")).stdout;
    assert.match(dryRunText, /Computer Linker doctor fix dry run/);
    assert.match(dryRunText, /dryRun: yes/);
    assert.match(dryRunText, /changed: yes \(not written\)/);
    assert.match(dryRunText, /planned: remove-bootstrap-current-workspace current/);
    assert.match(dryRunText, /Run `computer-linker doctor --fix` to apply these repairs\./);

    const repair = JSON.parse((await runCliOutput("doctor", "--fix", "--json")).stdout) as {
      kind: string;
      dryRun: boolean;
      changed: boolean;
      repairs: Array<{ id: string; status: string; workspaceId?: string }>;
    };
    assert.equal(repair.kind, "computer-linker-config-repair");
    assert.equal(repair.dryRun, false);
    assert.equal(repair.changed, true);
    assert.ok(repair.repairs.some((item) => item.id === "remove-bootstrap-current-workspace" && item.status === "applied"));
    assert.ok(repair.repairs.some((item) => item.id === "remove-exact-duplicate-workspace" && item.workspaceId === "runner-copy"));
    assert.ok(repair.repairs.some((item) => item.id === "add-default-execution-policy" && item.workspaceId === "runner"));
    assert.ok(repair.repairs.some((item) => item.id === "complete-execution-policy" && item.workspaceId === "partial"));
    const fixedConfig = loadConfig();
    assert.equal(fixedConfig.workspaces.some((workspace) => workspace.id === "current"), false);
    assert.equal(fixedConfig.workspaces.some((workspace) => workspace.id === "runner-copy"), false);
    assert.ok(fixedConfig.workspaces.find((workspace) => workspace.id === "runner")?.policy?.allowedCommands?.includes("npm *"));
    const partialPolicy = fixedConfig.workspaces.find((workspace) => workspace.id === "partial")?.policy;
    assert.deepEqual(partialPolicy?.allowedCommands, ["make *"]);
    assert.equal(partialPolicy?.maxRuntimeSeconds, 600);
    assert.equal(partialPolicy?.maxOutputBytes, 200000);
    assert.ok(partialPolicy?.deniedCommands?.includes("rm -rf *"));
    const secondRepair = JSON.parse((await runCliOutput("doctor", "--fix", "--json")).stdout) as { changed: boolean };
    assert.equal(secondRepair.changed, false);
    await assert.rejects(
      () => runCliOutput("doctor", "--dry-run"),
      /doctor --dry-run requires --fix/,
    );
  } finally {
    if (beforeDoctorFixConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = beforeDoctorFixConfigDir;
  }
  await assert.rejects(
    () => runCliOutput("config", "set-public-url", "http://127.0.0.1:3939"),
    /must use https:\/\//,
  );
  const setupMcpOnlyText = (await runCliOutput(
    "setup",
    "mcp-only",
    "https://mcp-only.example.com/path?ignored=true",
    updatedRoot,
    "--name",
    "MCP App",
    "--write",
    "--show-token",
  )).stdout;
  assert.match(setupMcpOnlyText, /Computer Linker setup/);
  assert.match(setupMcpOnlyText, /connect: https:\/\/mcp-only\.example\.com\/mcp/);
  assert.match(setupMcpOnlyText, /public access: MCP endpoint only/);
  assert.match(setupMcpOnlyText, /auth: bearer token shown below/);
  assert.match(setupMcpOnlyText, /auth header: Authorization: Bearer token/);
  assert.match(setupMcpOnlyText, /workspace: created updated \(MCP App\)/);
  assert.match(setupMcpOnlyText, /access: read\/write/);
  assert.match(setupMcpOnlyText, /next:/);
  assert.match(setupMcpOnlyText, /details: rerun the same setup command with --json for policy\/WAF details/);
  assert.doesNotMatch(setupMcpOnlyText, /publicMcpUrl:/);
  assert.doesNotMatch(setupMcpOnlyText, /publicMcpOnly:/);
  assert.doesNotMatch(setupMcpOnlyText, /authHeader:/);
  assert.doesNotMatch(setupMcpOnlyText, /expression: \(http\.host eq "mcp-only\.example\.com" and http\.request\.uri\.path ne "\/mcp"\)/);
  config = loadConfig();
  assert.equal(config.publicBaseUrl, "https://mcp-only.example.com");
  assert.equal(config.publicMcpOnly, true);
  assert.equal(config.ownerToken, "token");
  const mcpOnlyProfile = JSON.parse((await runCliOutput("profile")).stdout) as {
    http: {
      localApiUrl: string;
      publicMcpUrl: string;
      publicApiUrl: string | null;
      publicApiAvailable: boolean;
    };
  };
  assert.equal(mcpOnlyProfile.http.localApiUrl, "http://127.0.0.1:3939/api/v1");
  assert.equal(mcpOnlyProfile.http.publicMcpUrl, "https://mcp-only.example.com/mcp");
  assert.equal(mcpOnlyProfile.http.publicApiUrl, null);
  assert.equal(mcpOnlyProfile.http.publicApiAvailable, false);
  assert.deepEqual(config.workspaces.find((workspace) => workspace.id === "updated"), {
    id: "updated",
    name: "MCP App",
    path: updatedRoot,
    permissions: { read: true, write: true, shell: false, codex: false, screen: false },
    policy: undefined,
  });
  const setupMcpOnlyJson = JSON.parse((await runCliOutput("setup", "mcp-only", "--url", "https://json-mcp.example.com", "--json")).stdout) as {
    kind: string;
    publicMcpUrl: string;
    publicMcpOnly: boolean;
    authHeader: string;
    ownerToken?: string;
    cloudflare: { tunnelService: string; wafExpression: string };
  };
  assert.equal(setupMcpOnlyJson.kind, "computer-linker-mcp-only-setup");
  assert.equal(setupMcpOnlyJson.publicMcpUrl, "https://json-mcp.example.com/mcp");
  assert.equal(setupMcpOnlyJson.publicMcpOnly, true);
  assert.equal(setupMcpOnlyJson.authHeader, "Authorization: Bearer <ownerToken>");
  assert.equal(setupMcpOnlyJson.ownerToken, undefined);
  assert.equal(setupMcpOnlyJson.cloudflare.tunnelService, "http://127.0.0.1:3939");
  assert.equal(setupMcpOnlyJson.cloudflare.wafExpression, '(http.host eq "json-mcp.example.com" and http.request.uri.path ne "/mcp")');
  const setupMcpOnlyJsonWithPath = JSON.parse((await runCliOutput(
    "setup",
    "mcp-only",
    "--url",
    "https://json-path-mcp.example.com",
    updatedRoot,
    "--id",
    "jsonpath",
    "--json",
  )).stdout) as {
    workspace?: { id: string; name: string; path: string };
  };
  assert.equal(setupMcpOnlyJsonWithPath.workspace?.id, "jsonpath");
  assert.equal(setupMcpOnlyJsonWithPath.workspace?.name, "updated");
  assert.equal(setupMcpOnlyJsonWithPath.workspace?.path, updatedRoot);
  assert.equal(loadConfig().workspaces.find((workspace) => workspace.id === "jsonpath")?.name, "updated");
  await runCli("config", "clear-public-url");
  const setupSimpleWorkspaceText = (await runCliOutput("setup", tailscaleRoot)).stdout;
  assert.match(setupSimpleWorkspaceText, /Computer Linker setup/);
  assert.match(setupSimpleWorkspaceText, /connect: local only/);
  assert.match(setupSimpleWorkspaceText, /public access: MCP endpoint only/);
  assert.match(setupSimpleWorkspaceText, /workspace: created dev-7-3 \(dev_7_3\)/);
  assert.match(setupSimpleWorkspaceText, /access: read\/write, commands/);
  assert.match(setupSimpleWorkspaceText, /command policy: default limits|command policy: configured/);
  assert.match(setupSimpleWorkspaceText, /Start server: computer-linker start/);
  assert.doesNotMatch(setupSimpleWorkspaceText, /allowedCommands=/);
  assert.doesNotMatch(setupSimpleWorkspaceText, /authHeader:/);
  const setupSimpleWorkspace = JSON.parse((await runCliOutput(
    "setup",
    tailscaleRoot,
    "--json",
  )).stdout) as {
    publicBaseUrl: string | null;
    publicMcpUrl?: string;
    commands: { start: string; startLocalOnly: string; showToken: string };
    workspace?: { id: string; name: string; path: string; permissions: { write: boolean; shell: boolean }; policy?: { allowedCommands?: string[] } };
  };
  assert.equal(setupSimpleWorkspace.publicBaseUrl, null);
  assert.equal(setupSimpleWorkspace.publicMcpUrl, undefined);
  assert.equal(setupSimpleWorkspace.commands.start, "computer-linker start");
  assert.equal(setupSimpleWorkspace.commands.startLocalOnly, "computer-linker start");
  assert.equal(setupSimpleWorkspace.commands.showToken, "computer-linker profile --show-token");
  assert.equal(setupSimpleWorkspace.workspace?.id, "dev-7-3");
  assert.equal(setupSimpleWorkspace.workspace?.name, "dev_7_3");
  assert.equal(setupSimpleWorkspace.workspace?.path, tailscaleRoot);
  assert.equal(setupSimpleWorkspace.workspace?.permissions.write, true);
  assert.equal(setupSimpleWorkspace.workspace?.permissions.shell, true);
  assert.ok(setupSimpleWorkspace.workspace?.policy?.allowedCommands?.includes("npm *"));
  const mainConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  process.env.COMPUTER_LINKER_CONFIG_DIR = join(root, "fresh-config");
  try {
    const freshSetup = JSON.parse((await runCliOutput(
      "setup",
      freshRoot,
      "--shell",
      "--json",
    )).stdout) as {
      ownerTokenCreated: boolean;
      workspace?: { id: string; policy?: { allowedCommands?: string[]; maxRuntimeSeconds?: number; maxOutputBytes?: number } };
    };
    assert.equal(freshSetup.ownerTokenCreated, true);
    assert.equal(freshSetup.workspace?.id, "fresh-project");
    assert.ok(freshSetup.workspace?.policy?.allowedCommands?.includes("npm *"));
    assert.equal(freshSetup.workspace?.policy?.maxRuntimeSeconds, 600);
    assert.equal(freshSetup.workspace?.policy?.maxOutputBytes, 200000);
    const freshConfig = loadConfig();
    assert.equal(freshConfig.workspaces.some((workspace) => workspace.id === "current"), false);
    assert.equal(freshConfig.workspaces.length, 1);
    assert.ok(freshConfig.ownerToken);
    assert.ok(freshConfig.workspaces[0].policy?.allowedCommands?.includes("git *"));

    const codexSetup = JSON.parse((await runCliOutput(
      "setup",
      codexRoot,
      "--codex",
      "--json",
    )).stdout) as {
      workspace?: { id: string; policy?: { allowedCommands?: string[]; maxRuntimeSeconds?: number } };
    };
    assert.equal(codexSetup.workspace?.id, "codex-project");
    assert.ok(codexSetup.workspace?.policy?.allowedCommands?.includes("codex *"));
    assert.equal(codexSetup.workspace?.policy?.maxRuntimeSeconds, 1800);
  } finally {
    if (mainConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = mainConfigDir;
  }
  const setupMcpOnlyTailscale = JSON.parse((await runCliOutput(
    "setup",
    "mcp-only",
    tailscaleRoot,
    "--tunnel",
    "tailscale",
    "--json",
  )).stdout) as {
    publicBaseUrl: string | null;
    publicMcpUrl?: string;
    publicMcpOnly: boolean;
    tunnel: string | null;
    commands: { start: string };
    workspace?: { id: string; name: string; path: string };
  };
  assert.equal(setupMcpOnlyTailscale.publicBaseUrl, null);
  assert.equal(setupMcpOnlyTailscale.publicMcpUrl, undefined);
  assert.equal(setupMcpOnlyTailscale.publicMcpOnly, true);
  assert.equal(setupMcpOnlyTailscale.tunnel, "tailscale");
  assert.equal(setupMcpOnlyTailscale.commands.start, "computer-linker start --tunnel tailscale");
  assert.equal(setupMcpOnlyTailscale.workspace?.id, "dev-7-3");
  assert.equal(setupMcpOnlyTailscale.workspace?.name, "dev_7_3");
  assert.equal(setupMcpOnlyTailscale.workspace?.path, tailscaleRoot);
  assert.equal(loadConfig().publicBaseUrl, undefined);
  const setupMcpOnlyOpenAi = JSON.parse((await runCliOutput(
    "setup",
    "mcp-only",
    tailscaleRoot,
    "--tunnel",
    "openai",
    "--tunnel-id",
    "tunnel_test",
    "--json",
  )).stdout) as {
    publicBaseUrl: string | null;
    publicMcpUrl?: string;
    tunnel: string | null;
    openaiTunnelId: string | null;
    commands: { start: string };
  };
  assert.equal(setupMcpOnlyOpenAi.publicBaseUrl, null);
  assert.equal(setupMcpOnlyOpenAi.publicMcpUrl, undefined);
  assert.equal(setupMcpOnlyOpenAi.tunnel, "openai");
  assert.equal(setupMcpOnlyOpenAi.openaiTunnelId, "tunnel_test");
  assert.equal(setupMcpOnlyOpenAi.commands.start, "computer-linker start --tunnel openai --tunnel-id tunnel_test");
  await assert.rejects(
    () => runCliOutput("setup", "mcp-only", "http://127.0.0.1:3939"),
    /must use https:\/\//,
  );
  await assert.rejects(
    () => runCliOutput("setup", "mcp-only", "https://mcp.example.com", "--id", "only-id"),
    /--id requires a workspace path/,
  );
  await assert.rejects(
    () => runCliOutput("setup", "mcp-only", "https://mcp.example.com", "--bad"),
    /Unknown setup mcp-only option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("setup", "mcp-only", tailscaleRoot, "--tunnel", "bad"),
    /setup mcp-only --tunnel must be one of: cloudflare, tailscale, openai/,
  );
  markCliSection("config policy and local client profiles");
  const configValidationText = (await runCliOutput("config", "validate")).stdout;
  assert.match(configValidationText, /Computer Linker config validation/);
  assert.match(configValidationText, /status: /);
  const configValidationJson = JSON.parse((await runCliOutput("config", "validate", "--json")).stdout) as {
    kind: string;
    configPath: string;
    status: string;
    ready: boolean;
    schemaValidation: { valid: boolean };
    configDiagnostics: { criticalCount: number; findings: Array<{ id: string }> };
    releaseReadiness: { recommendedGate: string };
  };
  assert.equal(configValidationJson.kind, "computer-linker-config-validation");
  assert.equal(configValidationJson.configPath, join(root, "config", "config.json"));
  assert.equal(configValidationJson.schemaValidation.valid, true);
  assert.equal(configValidationJson.configDiagnostics.criticalCount, 0);
  assert.equal(configValidationJson.releaseReadiness.recommendedGate, "npm run product:check");
  const validConfigText = await readFile(join(root, "config", "config.json"), "utf8");
  await writeFile(join(root, "config", "config.json"), JSON.stringify({
    machineName: "bad-config",
    port: 70000,
    workspaces: [
      {
        id: "app",
        name: "App",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
    ],
  }, null, 2), "utf8");
  const invalidConfigValidation = runCliFailure("config", "validate", "--json");
  assert.notEqual(invalidConfigValidation.status, 0);
  const invalidConfigValidationJson = JSON.parse(invalidConfigValidation.stdout) as {
    status: string;
    schemaValidation: { valid: boolean; issues: Array<{ path: string; message: string }> };
    releaseReadiness: { blockingReasons: string[] };
  };
  assert.equal(invalidConfigValidationJson.status, "blocked");
  assert.equal(invalidConfigValidationJson.schemaValidation.valid, false);
  assert.ok(invalidConfigValidationJson.schemaValidation.issues.some((issue) => issue.path === "$.port"));
  assert.ok(invalidConfigValidationJson.releaseReadiness.blockingReasons.includes("config schema validation failed"));
  await writeFile(join(root, "config", "config.json"), validConfigText, "utf8");

  const emptyPolicy = JSON.parse((await runCliOutput("config", "policy", "app", "--json")).stdout) as {
    kind: string;
    workspaceId: string;
    policy: Record<string, unknown>;
  };
  assert.equal(emptyPolicy.kind, "computer-linker-config-policy");
  assert.equal(emptyPolicy.workspaceId, "app");
  assert.deepEqual(emptyPolicy.policy, {});
  await runCli(
    "config",
    "policy",
    "app",
    "--allow",
    "npm *",
    "--allow",
    "git *",
    "--deny",
    "rm -rf *",
    "--max-runtime-seconds",
    "600",
    "--max-output-bytes",
    "200000",
  );
  config = loadConfig();
  assert.deepEqual(config.workspaces[0].policy, {
    maxRuntimeSeconds: 600,
    maxOutputBytes: 200000,
    allowedCommands: ["npm *", "git *"],
    deniedCommands: ["rm -rf *"],
  });
  const policyText = (await runCliOutput("config", "policy", "app")).stdout;
  assert.match(policyText, /allowedCommands: npm \*, git \*/);
  assert.match(policyText, /allowShellMetacharacters: false/);
  const advancedPolicy = JSON.parse((await runCliOutput("config", "policy", "app", "--allow-shell-metacharacters", "--json")).stdout) as {
    policy: { allowShellMetacharacters?: boolean };
  };
  assert.equal(advancedPolicy.policy.allowShellMetacharacters, true);
  const updatedPolicy = JSON.parse((await runCliOutput("config", "policy", "app", "--clear-allowed", "--block-shell-metacharacters", "--json")).stdout) as {
    policy: { allowedCommands?: string[]; deniedCommands?: string[]; maxRuntimeSeconds?: number; allowShellMetacharacters?: boolean };
  };
  assert.equal(updatedPolicy.policy.allowedCommands, undefined);
  assert.deepEqual(updatedPolicy.policy.deniedCommands, ["rm -rf *"]);
  assert.equal(updatedPolicy.policy.maxRuntimeSeconds, 600);
  assert.equal(updatedPolicy.policy.allowShellMetacharacters, false);
  const sensitivePathPolicy = JSON.parse((await runCliOutput(
    "config",
    "policy",
    "app",
    "--allow-sensitive-path-metadata",
    "--allow-sensitive-path-writes",
    "--json",
  )).stdout) as {
    policy: { allowSensitivePathMetadata?: boolean; allowSensitivePathWrites?: boolean };
  };
  assert.equal(sensitivePathPolicy.policy.allowSensitivePathMetadata, true);
  assert.equal(sensitivePathPolicy.policy.allowSensitivePathWrites, true);
  const sensitivePathPolicyText = (await runCliOutput("config", "policy", "app")).stdout;
  assert.match(sensitivePathPolicyText, /allowSensitivePathMetadata: true/);
  assert.match(sensitivePathPolicyText, /allowSensitivePathWrites: true/);
  const blockedSensitiveMetadataPolicy = JSON.parse((await runCliOutput(
    "config",
    "policy",
    "app",
    "--block-sensitive-path-metadata",
    "--json",
  )).stdout) as {
    policy: { allowSensitivePathMetadata?: boolean; allowSensitivePathWrites?: boolean };
  };
  assert.equal(blockedSensitiveMetadataPolicy.policy.allowSensitivePathMetadata, false);
  assert.equal(blockedSensitiveMetadataPolicy.policy.allowSensitivePathWrites, true);
  await assert.rejects(
    () => runCliOutput("config", "policy", "missing"),
    /Unknown workspace: missing/,
  );
  await assert.rejects(
    () => runCliOutput("config", "policy", "app", "--allow"),
    /config policy --allow requires a value/,
  );
  await assert.rejects(
    () => runCliOutput("config", "policy", "app", "--allow-shell-metacharacters", "--block-shell-metacharacters"),
    /cannot combine --allow-shell-metacharacters and --block-shell-metacharacters/,
  );
  await assert.rejects(
    () => runCliOutput("config", "policy", "app", "--allow-sensitive-path-writes", "--block-sensitive-path-writes"),
    /cannot combine --allow-sensitive-path-writes and --block-sensitive-path-writes/,
  );
  await runCli("config", "clear-public-url");
  assert.equal(loadConfig().publicBaseUrl, undefined);
  const chatGptVerifyLocal = JSON.parse((await runCliOutput("client", "chatgpt", "verify", "--json")).stdout) as {
    ready: boolean;
    blockingReasons: string[];
  };
  assert.equal(chatGptVerifyLocal.ready, false);
  assert.ok(chatGptVerifyLocal.blockingReasons.some((reason) => reason.includes("public-base-url")));
  const chatGptUrlLocal = JSON.parse((await runCliOutput("client", "chatgpt", "url", "--json")).stdout) as {
    ready: boolean;
    mcpServerUrl: string | null;
    warnings: string[];
  };
  assert.equal(chatGptUrlLocal.ready, false);
  assert.equal(chatGptUrlLocal.mcpServerUrl, null);
  assert.ok(chatGptUrlLocal.warnings.some((warning) => warning.includes("No public HTTPS MCP URL")));
  const persistedTunnelPath = join(root, "config", "tunnels.json");
  await writeFile(persistedTunnelPath, JSON.stringify([
    {
      id: "persisted-cli-tunnel",
      provider: "cloudflare",
      localPort: 3939,
      command: "cloudflared",
      args: ["tunnel", "--url", "http://127.0.0.1:3939"],
      display: "cloudflared tunnel --url http://127.0.0.1:3939",
      pid: process.pid,
      startedAt: new Date(0).toISOString(),
      status: "running",
      exitCode: null,
      stdout: "",
      stderr: "",
      publicUrl: "https://persisted-cli.trycloudflare.com",
    },
  ], null, 2));
  const chatGptUrlPersistedTunnel = JSON.parse((await runCliOutput("client", "chatgpt", "url", "--json")).stdout) as {
    ready: boolean;
    mcpServerUrl: string | null;
    publicBaseUrlSource: string | null;
    detectedPublicUrl: string | null;
  };
  assert.equal(chatGptUrlPersistedTunnel.ready, true);
  assert.equal(chatGptUrlPersistedTunnel.mcpServerUrl, "https://persisted-cli.trycloudflare.com/mcp");
  assert.equal(chatGptUrlPersistedTunnel.publicBaseUrlSource, "running-tunnel");
  assert.equal(chatGptUrlPersistedTunnel.detectedPublicUrl, "https://persisted-cli.trycloudflare.com");
  await rm(persistedTunnelPath, { force: true });
  const localOnlyChatGptProfile = JSON.parse((await runCliOutput("client", "chatgpt", "profile")).stdout) as {
    warnings: string[];
  };
  assert.ok(localOnlyChatGptProfile.warnings.some((warning) => warning.includes("publicBaseUrl is not configured")));
  assert.ok(localOnlyChatGptProfile.warnings.some((warning) => warning.includes("mcpServerUrl must use https://")));

  markCliSection("service profiles and quickstart");
  const linuxServiceProfile = JSON.parse((await runCliOutput("service", "profile", "--platform", "linux")).stdout) as {
    kind: string;
    platform: string;
    serviceName: string;
    command: string[];
    manifest: string;
    installCommands: string[];
    notes: string[];
  };
  assert.equal(linuxServiceProfile.kind, "computer-linker-service-profile");
  assert.equal(linuxServiceProfile.platform, "linux");
  assert.equal(linuxServiceProfile.serviceName, "computer-linker");
  assert.ok(linuxServiceProfile.command.includes("serve"));
  assert.ok(linuxServiceProfile.command.includes("--transport"));
  assert.match(linuxServiceProfile.manifest, /\[Unit\]/);
  assert.match(linuxServiceProfile.manifest, /Environment=COMPUTER_LINKER_CONFIG_DIR=/);
  assert.ok(linuxServiceProfile.installCommands.some((command) => command.includes("systemctl enable --now")));
  assert.ok(linuxServiceProfile.notes.some((note) => note.includes("computer-linker init")));

  const macosServiceManifest = (await runCliOutput("service", "profile", "--platform", "macos", "--format", "manifest")).stdout;
  assert.match(macosServiceManifest, /<key>Label<\/key>/);
  assert.match(macosServiceManifest, /com\.computer-linker\.computer-linker/);
  assert.match(macosServiceManifest, /COMPUTER_LINKER_CONFIG_DIR/);

  const windowsServiceManifest = (await runCliOutput("service", "profile", "--platform", "windows", "--format", "manifest", "--service-name", "Computer Linker Test")).stdout;
  assert.match(windowsServiceManifest, /sc\.exe create/);
  assert.match(windowsServiceManifest, /computer-linker-test/);
  assert.match(windowsServiceManifest, /COMPUTER_LINKER_CONFIG_DIR/);

  const serviceOutputDir = join(root, "service-profile");
  const serviceFiles = JSON.parse((await runCliOutput("service", "profile", "--platform", "linux", "--output-dir", serviceOutputDir)).stdout) as {
    kind: string;
    outputDir: string;
    files: { profile: string; manifest: string; install: string; uninstall: string };
  };
  assert.equal(serviceFiles.kind, "computer-linker-service-files");
  assert.equal(serviceFiles.outputDir, serviceOutputDir);
  const writtenServiceProfile = JSON.parse(await readFile(serviceFiles.files.profile, "utf8")) as { kind: string; platform: string };
  assert.equal(writtenServiceProfile.kind, "computer-linker-service-profile");
  assert.equal(writtenServiceProfile.platform, "linux");
  assert.match(await readFile(serviceFiles.files.manifest, "utf8"), /\[Service\]/);
  assert.match(await readFile(serviceFiles.files.install, "utf8"), /systemctl enable --now/);
  assert.match(await readFile(serviceFiles.files.uninstall, "utf8"), /systemctl disable --now/);

  const serviceStatus = JSON.parse((await runCliOutput("service", "status", "--platform", "linux", "--json")).stdout) as {
    kind: string;
    platform: string;
    serviceName: string;
    manifestExists: boolean | null;
    statusCommands: string[];
    startCommands: string[];
    logCommands: string[];
  };
  assert.equal(serviceStatus.kind, "computer-linker-service-status");
  assert.equal(serviceStatus.platform, "linux");
  assert.equal(serviceStatus.serviceName, "computer-linker");
  assert.equal(typeof serviceStatus.manifestExists, "boolean");
  assert.ok(serviceStatus.statusCommands.some((command) => command.includes("systemctl status")));
  assert.ok(serviceStatus.startCommands.some((command) => command.includes("systemctl start")));
  assert.ok(serviceStatus.logCommands.some((command) => command.includes("journalctl")));
  const serviceStatusText = (await runCliOutput("service", "status", "--platform", "macos")).stdout;
  assert.match(serviceStatusText, /Computer Linker service status \(macos\)/);
  assert.match(serviceStatusText, /launchctl print/);
  assert.match(serviceStatusText, /daily commands:/);

  const installPlan = JSON.parse((await runCliOutput("service", "install", "--dry-run", "--platform", "windows", "--json")).stdout) as {
    kind: string;
    action: string;
    dryRun: boolean;
    platform: string;
    requiresElevation: boolean;
    commands: string[];
  };
  assert.equal(installPlan.kind, "computer-linker-service-plan");
  assert.equal(installPlan.action, "install");
  assert.equal(installPlan.dryRun, true);
  assert.equal(installPlan.platform, "windows");
  assert.equal(installPlan.requiresElevation, true);
  assert.ok(installPlan.commands.some((command) => command.includes("install-service.ps1") || command.includes("Get-Service")));

  const uninstallPlanText = (await runCliOutput("service", "uninstall", "--dry-run", "--platform", "linux")).stdout;
  assert.match(uninstallPlanText, /service uninstall dry run \(linux\)/);
  assert.match(uninstallPlanText, /systemctl disable --now/);
  const startPlanText = (await runCliOutput("service", "start", "--dry-run", "--platform", "windows")).stdout;
  assert.match(startPlanText, /service start dry run \(windows\)/);
  assert.match(startPlanText, /sc\.exe start/);
  const serviceLogs = JSON.parse((await runCliOutput("service", "logs", "--platform", "windows", "--lines", "5", "--json")).stdout) as {
    kind: string;
    platform: string;
    stdout: { exists: boolean };
    stderr: { exists: boolean };
  };
  assert.equal(serviceLogs.kind, "computer-linker-service-logs");
  assert.equal(serviceLogs.platform, "windows");
  assert.equal(serviceLogs.stdout.exists, false);
  assert.equal(serviceLogs.stderr.exists, false);
  const serviceInstallWithoutDryRun = runCliFailure("service", "install", "--platform", "linux");
  assert.notEqual(serviceInstallWithoutDryRun.status, 0);
  assert.match(serviceInstallWithoutDryRun.stderr, /requires --yes or --dry-run/);
  await assert.rejects(
    () => runCliOutput("service", "profile", "--platform", "bad"),
    /must be one of: linux, macos, windows/,
  );
  await assert.rejects(
    () => runCliOutput("service", "profile", "--output-dir"),
    /requires a directory path/,
  );
  const quickstartText = (await runCliOutput("quickstart", tailscaleRoot, "--tunnel", "openai", "--tunnel-id", "tunnel_test")).stdout;
  assert.match(quickstartText, /Computer Linker quickstart/);
  assert.match(quickstartText, /workspace path:/);
  assert.match(quickstartText, /computer-linker check/);
  assert.match(quickstartText, /computer-linker start .*dev_7_3.* --tunnel openai --tunnel-id tunnel_test/);
  assert.match(quickstartText, /Keep the start command running\. Run client setup and verify commands in another terminal\./);
  assert.match(quickstartText, /Prerequisite: OpenAI Secure MCP Tunnel requires CONTROL_PLANE_API_KEY or OPENAI_API_KEY/);
  assert.match(quickstartText, /PowerShell: \$env:CONTROL_PLANE_API_KEY = "sk-\.\.\."/);
  assert.match(quickstartText, /OpenAI tunnel tunnel_test uses the local MCP target http:\/\/127\.0\.0\.1:3939\/mcp/);
  assert.match(quickstartText, /Auth: handled by OpenAI tunnel-client/);
  assert.match(quickstartText, /ChatGPT connector: choose Tunnel and select or paste tunnel_test/);
  assert.doesNotMatch(quickstartText, /Token:/);
  assert.match(quickstartText, /computer-linker client setup/);
  assert.match(quickstartText, /computer-linker history --view connections/);
  const quickstartJson = JSON.parse((await runCliOutput("quickstart", freshRoot, "--url", "https://quick.example.com/path", "--write", "--json")).stdout) as {
    kind: string;
    workspacePath: string;
    permissions: { write: boolean; shell: boolean };
    tunnel: { provider: string | null; publicBaseUrl: string | null };
    commands: { check: string; selfTest: string; start: string; localSmoke: string };
    connection: { mcpUrl: string; authHeader: string };
    terminalHint: string;
  };
  assert.equal(quickstartJson.kind, "computer-linker-quickstart");
  assert.equal(quickstartJson.workspacePath, freshRoot);
  assert.equal(quickstartJson.permissions.write, true);
  assert.equal(quickstartJson.permissions.shell, false);
  assert.equal(quickstartJson.tunnel.provider, null);
  assert.equal(quickstartJson.tunnel.publicBaseUrl, "https://quick.example.com");
  assert.match(quickstartJson.commands.check, /computer-linker check/);
  assert.equal(quickstartJson.commands.selfTest, quickstartJson.commands.check);
  assert.match(quickstartJson.commands.start, /computer-linker start .*fresh-project.* --url "?https:\/\/quick\.example\.com"? --write/);
  assert.equal(quickstartJson.connection.mcpUrl, "https://quick.example.com/mcp");
  assert.equal(quickstartJson.connection.authHeader, "Authorization: Bearer <ownerToken>");
  assert.match(quickstartJson.terminalHint, /another terminal/);
  assert.match(quickstartJson.commands.localSmoke, /computer-linker client smoke --allow-http --url "?http:\/\/127\.0\.0\.1:3939\/mcp"?/);
  const quickstartCodingJson = JSON.parse((await runCliOutput("quickstart", freshRoot, "--coding", "--json")).stdout) as {
    permissions: { write: boolean; shell: boolean; codex: boolean; screen: boolean };
  };
  assert.deepEqual(quickstartCodingJson.permissions, {
    write: true,
    shell: true,
    codex: false,
    screen: false,
  });
  const quickstartFullTrustJson = JSON.parse((await runCliOutput("quickstart", freshRoot, "--full-trust", "--json")).stdout) as {
    permissions: { write: boolean; shell: boolean; codex: boolean; screen: boolean };
  };
  assert.deepEqual(quickstartFullTrustJson.permissions, {
    write: true,
    shell: true,
    codex: true,
    screen: true,
  });
  await assert.rejects(
    () => runCliOutput("quickstart", freshRoot, "--read-only", "--write"),
    /quickstart --read-only cannot be combined with --write/,
  );
  const npmDevQuickstartJson = JSON.parse((await runCliOutputWithEnv({
    npm_lifecycle_event: "dev",
    npm_lifecycle_script: "tsx src/cli.ts",
  }, "quickstart", freshRoot, "--json")).stdout) as {
    commandPrefix: string;
    commands: { start: string; clientSetup: string };
  };
  assert.equal(npmDevQuickstartJson.commandPrefix, "npm run dev --");
  assert.match(npmDevQuickstartJson.commands.start, /npm run dev -- start .*fresh-project/);
  assert.match(npmDevQuickstartJson.commands.clientSetup, /npm run dev -- client setup/);
  const npmDevSetupJson = JSON.parse((await runCliOutputWithEnv({
    npm_lifecycle_event: "dev",
    npm_lifecycle_script: "tsx src/cli.ts",
  }, "setup", freshRoot, "--json")).stdout) as {
    commands: { start: string; startLocalOnly: string; showToken: string };
  };
  assert.equal(npmDevSetupJson.commands.start, "npm run dev -- start");
  assert.equal(npmDevSetupJson.commands.startLocalOnly, "npm run dev -- start");
  assert.equal(npmDevSetupJson.commands.showToken, "npm run dev -- profile --show-token");
  await assert.rejects(
    () => runCliOutput("quickstart", "--bad"),
    /Unknown quickstart option: --bad/,
  );
  await assert.rejects(
    () => runCliOutput("quickstart", freshRoot, "--tunnel-id", "tunnel_test"),
    /quickstart --tunnel-id is only valid with --tunnel openai/,
  );
  markCliSection("help output and version");
  const startHelpText = (await runCliOutput("start", "--help")).stdout;
  assert.match(startHelpText, /Computer Linker start/);
  assert.match(startHelpText, /computer-linker start <workspace-path>/);
  assert.match(startHelpText, /Use `computer-linker here` when you are already inside the folder to expose/);
  assert.match(startHelpText, /Creates config, owner token, and a workspace entry/);
  assert.match(startHelpText, /--full-trust\s+Writes, approved commands, Codex operations, and screen capture/);
  assert.match(startHelpText, /--tunnel openai\|tailscale\|cloudflare/);
  assert.match(startHelpText, /OpenAI tunnel requires CONTROL_PLANE_API_KEY or OPENAI_API_KEY/);
  assert.doesNotMatch(startHelpText, /Unknown start option/);
  const quickstartHelpText = (await runCliOutput("quickstart", "--help")).stdout;
  assert.match(quickstartHelpText, /Computer Linker quickstart/);
  assert.match(quickstartHelpText, /computer-linker quickstart \[workspace-path\]/);
  assert.match(quickstartHelpText, /Does not read or write config/);
  assert.doesNotMatch(quickstartHelpText, /Unknown quickstart option/);
  const helpText = (await runCliOutput("help")).stdout;
  assert.match(helpText, /computer-linker here/);
  assert.match(helpText, /computer-linker start <workspace-path>/);
  assert.match(helpText, /computer-linker start <workspace-path> --tunnel openai\|tailscale\|cloudflare/);
  assert.match(helpText, /Optional install check: computer-linker check/);
  assert.match(helpText, /In your project folder: computer-linker here/);
  assert.match(helpText, /Connect client: computer-linker client setup/);
  assert.match(helpText, /Check state: computer-linker status/);
  assert.match(helpText, /computer-linker here --tunnel cloudflare/);
  assert.match(helpText, /computer-linker here --tunnel tailscale/);
  assert.match(helpText, /computer-linker here --tunnel openai --tunnel-id tunnel_\.\.\./);
  assert.match(helpText, /computer-linker start C:\\Projects\\my-app --tunnel cloudflare/);
  assert.match(helpText, /computer-linker start C:\\Projects\\my-app --tunnel tailscale/);
  assert.match(helpText, /computer-linker start C:\\Projects\\my-app --tunnel openai --tunnel-id tunnel_\.\.\./);
  assert.match(helpText, /computer-linker status/);
  assert.match(helpText, /computer-linker check/);
  assert.match(helpText, /computer-linker client setup/);
  assert.match(helpText, /computer-linker quickstart C:\\Projects\\my-app/);
  assert.match(helpText, /computer-linker help here/);
  assert.match(helpText, /computer-linker help check/);
  assert.match(helpText, /computer-linker help start/);
  assert.match(helpText, /computer-linker help client setup/);
  assert.match(helpText, /computer-linker help advanced/);
  assert.match(helpText, /Tokens stay hidden by default/);
  assert.doesNotMatch(helpText, /computer-linker self-test/);
  assert.doesNotMatch(helpText, /computer-linker doctor --fix/);
  assert.doesNotMatch(helpText, /computer-linker profile$/m);
  assert.doesNotMatch(helpText, /computer-linker client smoke/);
  assert.doesNotMatch(helpText, /computer-linker --version/);
  assert.doesNotMatch(helpText, /profile --show-token/);
  assert.doesNotMatch(helpText, /client chatgpt/);
  assert.doesNotMatch(helpText, /computer-linker setup <workspace-path>/);
  assert.doesNotMatch(helpText, /localport/i);
  assert.doesNotMatch(helpText, /serve --transport/);
  assert.doesNotMatch(helpText, /--no-tunnel/);
  assert.equal((await runCliOutput()).stdout, helpText);
  const npmDevHelpText = (await runCliOutputWithEnv({
    npm_lifecycle_event: "dev",
    npm_lifecycle_script: "tsx src/cli.ts",
  }, "help")).stdout;
  assert.match(npmDevHelpText, /npm run dev -- here/);
  assert.match(npmDevHelpText, /npm run dev -- start <workspace-path>/);
  assert.match(npmDevHelpText, /npm run dev -- check/);
  assert.match(npmDevHelpText, /npm run dev -- client setup/);
  assert.match(npmDevHelpText, /npm run dev -- quickstart C:\\Projects\\my-app/);
  assert.doesNotMatch(npmDevHelpText, /npm run dev -- --version/);
  assert.match(npmDevHelpText, /Details: npm run dev -- help here \| npm run dev -- help check \| npm run dev -- help start \| npm run dev -- help client setup \| npm run dev -- help advanced/);
  assert.doesNotMatch(npmDevHelpText, /computer-linker start <workspace-path>/);
  const advancedHelpText = (await runCliOutput("help", "advanced")).stdout;
  assert.match(advancedHelpText, /Advanced Usage:/);
  assert.match(advancedHelpText, /computer-linker --version/);
  assert.match(advancedHelpText, /computer-linker here \[--tunnel cloudflare\|tailscale\|openai\]/);
  assert.match(advancedHelpText, /computer-linker quickstart \[workspace-path\]/);
  assert.match(advancedHelpText, /computer-linker check \[--json\]/);
  assert.match(advancedHelpText, /computer-linker self-test \[--json\]/);
  assert.match(advancedHelpText, /computer-linker client setup \[--details\] \[--show-token\] \[--json\]/);
  assert.match(advancedHelpText, /computer-linker client smoke \[--url https:\/\/\.\.\.\/mcp\]/);
  assert.match(advancedHelpText, /computer-linker client diagnose \[--local\|--remote\|--url https:\/\/\.\.\.\/mcp\]/);
  assert.match(advancedHelpText, /computer-linker diagnose client \[--local\|--remote\|--url https:\/\/\.\.\.\/mcp\]/);
  assert.match(advancedHelpText, /computer-linker setup <workspace-path>/);
  assert.match(advancedHelpText, /computer-linker workspace add <path> \[--id workspace-id\]/);
  assert.match(advancedHelpText, /computer-linker help chatgpt/);
  assert.match(advancedHelpText, /Client-specific helpers are compatibility exports/);
  assert.doesNotMatch(advancedHelpText, /computer-linker client chatgpt url/);
  assert.match(advancedHelpText, /Compatibility: LOCALPORT_\* env vars/);
  assert.doesNotMatch(advancedHelpText, /localport remains available as a CLI alias/i);
  const npmDevAdvancedHelpText = (await runCliOutputWithEnv({
    npm_lifecycle_event: "dev",
    npm_lifecycle_script: "tsx src/cli.ts",
  }, "help", "advanced")).stdout;
  assert.match(npmDevAdvancedHelpText, /npm run dev -- setup <workspace-path>/);
  assert.match(npmDevAdvancedHelpText, /npm run dev -- help chatgpt/);
  const initHelpText = (await runCliOutput("init", "--help")).stdout;
  assert.match(initHelpText, /Computer Linker init/);
  assert.match(initHelpText, /Creates the local config and owner token/);
  assert.equal((await runCliOutput("help", "init")).stdout, initHelpText);
  const serveHelpText = (await runCliOutput("serve", "--help")).stdout;
  assert.match(serveHelpText, /Computer Linker serve/);
  assert.match(serveHelpText, /prefer `computer-linker here` or `computer-linker start <folder>`/);
  assert.equal((await runCliOutput("help", "serve")).stdout, serveHelpText);
  const hereHelpText = (await runCliOutput("here", "--help")).stdout;
  assert.match(hereHelpText, /Computer Linker here/);
  assert.match(hereHelpText, /computer-linker here --tunnel tailscale/);
  assert.match(hereHelpText, /For another folder/);
  assert.equal((await runCliOutput("help", "here")).stdout, hereHelpText);
  assert.equal((await runCliOutput("help", "start")).stdout, startHelpText);
  assert.equal((await runCliOutput("help", "quickstart")).stdout, quickstartHelpText);
  const setupHelpText = (await runCliOutput("setup", "--help")).stdout;
  assert.match(setupHelpText, /Computer Linker setup/);
  assert.match(setupHelpText, /without starting the server/);
  assert.match(setupHelpText, /computer-linker setup <workspace-path>/);
  assert.equal((await runCliOutput("setup", "mcp-only", "--help")).stdout, setupHelpText);
  assert.equal((await runCliOutput("help", "setup")).stdout, setupHelpText);
  const profileHelpText = (await runCliOutput("profile", "--help")).stdout;
  assert.match(profileHelpText, /Computer Linker profile/);
  assert.match(profileHelpText, /Tokens are redacted unless --show-token/);
  assert.doesNotMatch(profileHelpText, /--chatgpt/);
  assert.equal((await runCliOutput("help", "profile")).stdout, profileHelpText);
  const clientHelpText = (await runCliOutput("client", "--help")).stdout;
  assert.match(clientHelpText, /Computer Linker client/);
  assert.match(clientHelpText, /prefer generic setup first/);
  assert.equal((await runCliOutput("client", "help")).stdout, clientHelpText);
  assert.equal((await runCliOutput("help", "client")).stdout, clientHelpText);
  const clientSetupHelpText = (await runCliOutput("client", "setup", "--help")).stdout;
  assert.match(clientSetupHelpText, /Computer Linker client setup/);
  assert.match(clientSetupHelpText, /computer-linker client setup \[--details\] \[--show-token\] \[--json\]/);
  assert.match(clientSetupHelpText, /Use --details for tool names, first prompt, and copy-pasteable agent instructions/);
  assert.match(clientSetupHelpText, /Use --show-token only on a trusted local setup screen/);
  assert.equal((await runCliOutput("client", "help", "setup")).stdout, clientSetupHelpText);
  assert.equal((await runCliOutput("help", "client", "setup")).stdout, clientSetupHelpText);
  const clientSmokeHelpText = (await runCliOutput("client", "smoke", "--help")).stdout;
  assert.match(clientSmokeHelpText, /Computer Linker client smoke/);
  assert.match(clientSmokeHelpText, /Use --allow-http only for trusted local loopback tests/);
  assert.match(clientSmokeHelpText, /COMPUTER_LINKER_TOKEN/);
  assert.match(clientSmokeHelpText, /--token only for CI or non-interactive automation/);
  const clientDiagnoseHelpText = (await runCliOutput("client", "diagnose", "--help")).stdout;
  assert.match(clientDiagnoseHelpText, /Computer Linker client diagnose/);
  assert.match(clientDiagnoseHelpText, /computer-linker diagnose client/);
  assert.equal((await runCliOutput("client", "help", "diagnose")).stdout, clientDiagnoseHelpText);
  assert.equal((await runCliOutput("help", "client", "diagnose")).stdout, clientDiagnoseHelpText);
  const exposeHelpText = (await runCliOutput("expose", "--help")).stdout;
  assert.match(exposeHelpText, /Computer Linker expose/);
  assert.match(exposeHelpText, /start <workspace-path> --tunnel/);
  assert.equal((await runCliOutput("expose", "help")).stdout, exposeHelpText);
  assert.equal((await runCliOutput("help", "expose")).stdout, exposeHelpText);
  const exposeTailscaleHelpText = (await runCliOutput("expose", "tailscale", "--help")).stdout;
  assert.match(exposeTailscaleHelpText, /Computer Linker expose tailscale/);
  assert.match(exposeTailscaleHelpText, /Tailscale Funnel/);
  assert.equal((await runCliOutput("expose", "help", "tailscale")).stdout, exposeTailscaleHelpText);
  assert.equal((await runCliOutput("help", "expose", "tailscale")).stdout, exposeTailscaleHelpText);
  const statusHelpText = (await runCliOutput("status", "--help")).stdout;
  assert.match(statusHelpText, /Computer Linker status/);
  assert.match(statusHelpText, /computer-linker status \[--details\] \[--json\]/);
  assert.match(statusHelpText, /Use --details for warnings/);
  assert.equal((await runCliOutput("help", "status")).stdout, statusHelpText);
  const checkHelpText = (await runCliOutput("check", "--help")).stdout;
  assert.match(checkHelpText, /Computer Linker check/);
  assert.match(checkHelpText, /computer-linker check \[--json\]/);
  assert.match(checkHelpText, /without touching your real config or folders/);
  assert.equal((await runCliOutput("help", "check")).stdout, checkHelpText);
  const selfTestHelpText = (await runCliOutput("self-test", "--help")).stdout;
  assert.match(selfTestHelpText, /Computer Linker self-test/);
  assert.match(selfTestHelpText, /temporary local MCP server/);
  assert.equal((await runCliOutput("help", "self-test")).stdout, selfTestHelpText);
  const doctorHelpText = (await runCliOutput("doctor", "--help")).stdout;
  assert.match(doctorHelpText, /Computer Linker doctor/);
  assert.match(doctorHelpText, /computer-linker doctor --fix \[--dry-run\]/);
  assert.equal((await runCliOutput("help", "doctor")).stdout, doctorHelpText);
  const historyHelpText = (await runCliOutput("history", "--help")).stdout;
  assert.match(historyHelpText, /Computer Linker history/);
  assert.match(historyHelpText, /computer-linker history \[--view/);
  assert.equal((await runCliOutput("help", "history")).stdout, historyHelpText);
  const configHelpText = (await runCliOutput("config", "--help")).stdout;
  assert.match(configHelpText, /Computer Linker config/);
  assert.match(configHelpText, /Tokens are redacted unless --show-token/);
  assert.equal((await runCliOutput("config", "help")).stdout, configHelpText);
  assert.equal((await runCliOutput("help", "config")).stdout, configHelpText);
  const configTokenHelpText = (await runCliOutput("config", "token", "--help")).stdout;
  assert.match(configTokenHelpText, /Computer Linker config token/);
  assert.match(configTokenHelpText, /trusted local setup screen/);
  assert.equal((await runCliOutput("config", "help", "token")).stdout, configTokenHelpText);
  assert.equal((await runCliOutput("help", "config", "token")).stdout, configTokenHelpText);
  const tunnelHelpText = (await runCliOutput("tunnel", "--help")).stdout;
  assert.match(tunnelHelpText, /Computer Linker tunnel/);
  assert.match(tunnelHelpText, /OpenAI Secure MCP Tunnel mode reports a tunnel id/);
  assert.equal((await runCliOutput("tunnel", "status", "--help")).stdout, tunnelHelpText);
  assert.equal((await runCliOutput("help", "tunnel")).stdout, tunnelHelpText);
  const serviceHelpText = (await runCliOutput("service", "--help")).stdout;
  assert.match(serviceHelpText, /Computer Linker service/);
  assert.match(serviceHelpText, /Install and uninstall require --yes/);
  assert.match(serviceHelpText, /computer-linker service logs/);
  assert.equal((await runCliOutput("service", "help")).stdout, serviceHelpText);
  assert.equal((await runCliOutput("help", "service")).stdout, serviceHelpText);
  const serviceInstallHelpText = (await runCliOutput("service", "install", "--help")).stdout;
  assert.match(serviceInstallHelpText, /Computer Linker service install/);
  assert.match(serviceInstallHelpText, /applies it with --yes/);
  assert.equal((await runCliOutput("service", "help", "install")).stdout, serviceInstallHelpText);
  assert.equal((await runCliOutput("help", "service", "install")).stdout, serviceInstallHelpText);
  const serviceLogsHelpText = (await runCliOutput("service", "logs", "--help")).stdout;
  assert.match(serviceLogsHelpText, /Computer Linker service logs/);
  assert.match(serviceLogsHelpText, /Reads generated service stdout\/stderr logs/);
  assert.equal((await runCliOutput("service", "help", "logs")).stdout, serviceLogsHelpText);
  assert.equal((await runCliOutput("help", "service", "logs")).stdout, serviceLogsHelpText);
  const workspaceHelpText = (await runCliOutput("workspace", "--help")).stdout;
  assert.match(workspaceHelpText, /Computer Linker workspace/);
  assert.match(workspaceHelpText, /computer-linker workspace list/);
  assert.match(workspaceHelpText, /computer-linker workspace add <path>/);
  assert.match(workspaceHelpText, /computer-linker workspace remove <id>/);
  assert.match(workspaceHelpText, /This does not delete the folder on disk/);
  assert.equal((await runCliOutput("workspace", "help")).stdout, workspaceHelpText);
  assert.equal((await runCliOutput("help", "workspace")).stdout, workspaceHelpText);
  const workspaceAddHelpText = (await runCliOutput("workspace", "add", "--help")).stdout;
  assert.match(workspaceAddHelpText, /Computer Linker workspace add/);
  assert.match(workspaceAddHelpText, /If --id is omitted, the id is derived from the folder name/);
  assert.equal((await runCliOutput("workspace", "help", "add")).stdout, workspaceAddHelpText);
  assert.equal((await runCliOutput("help", "workspace", "add")).stdout, workspaceAddHelpText);
  const workspaceUpdateHelpText = (await runCliOutput("workspace", "update", "--help")).stdout;
  assert.match(workspaceUpdateHelpText, /Computer Linker workspace update/);
  assert.match(workspaceUpdateHelpText, /computer-linker workspace update <id>/);
  const workspaceRemoveHelpText = (await runCliOutput("workspace", "remove", "--help")).stdout;
  assert.match(workspaceRemoveHelpText, /Computer Linker workspace remove/);
  assert.match(workspaceRemoveHelpText, /This does not delete the folder on disk/);
  const chatGptHelpText = (await runCliOutput("help", "chatgpt")).stdout;
  assert.match(chatGptHelpText, /ChatGPT Compatibility Helpers/);
  assert.match(chatGptHelpText, /ChatGPT is one MCP client, not the product axis/);
  assert.match(chatGptHelpText, /computer-linker client setup/);
  assert.match(chatGptHelpText, /computer-linker client chatgpt url/);
  assert.match(chatGptHelpText, /computer-linker client chatgpt files/);
  await assert.rejects(
    () => runCliOutput("help", "bad"),
    /Unknown help topic: bad/,
  );
  const versionText = (await runCliOutput("--version")).stdout;
  assert.equal(versionText.trim(), `computer-linker ${sourcePackageJson.version}`);
  const versionCommandText = (await runCliOutput("version")).stdout;
  assert.equal(versionCommandText.trim(), `computer-linker ${sourcePackageJson.version}`);
  markCliSection("start, expose, tunnel, and init flows");
  const oneCommandPort = await getFreePort();
  writeConfig({
    ...loadConfig(),
    port: oneCommandPort,
  });
  const oneCommandStart = await runCliUntilStdout("tunnel: disabled", "start", oneCommandRoot);
  assert.match(oneCommandStart.stdout, /Computer Linker auto setup/);
  assert.match(oneCommandStart.stdout, /workspace: created one-command \(one-command\)/);
  assert.match(oneCommandStart.stdout, /access: read\/write, commands/);
  assert.match(oneCommandStart.stdout, /command policy: default limits/);
  assert.doesNotMatch(oneCommandStart.stdout, /permissions:/);
  assert.doesNotMatch(oneCommandStart.stdout, /allowedCommands=/);
  assert.match(oneCommandStart.stdout, /Computer Linker started/);
  assert.match(oneCommandStart.stdout, /server: running/);
  assert.match(oneCommandStart.stdout, /connect: local only/);
  assert.match(oneCommandStart.stdout, /auth: bearer token configured; setup command: computer-linker client setup/);
  assert.match(oneCommandStart.stdout, /startup check: ready \(\d+\/\d+\)/);
  assert.match(oneCommandStart.stdout, /tunnel: disabled; restart with --tunnel openai, tailscale, or cloudflare for remote access/);
  assert.match(oneCommandStart.stdout, /details: computer-linker status --details/);
  assert.doesNotMatch(oneCommandStart.stdout, /Public MCP URL:/);
  assert.doesNotMatch(oneCommandStart.stdout, /Local API:/);
  assert.doesNotMatch(oneCommandStart.stdout, /Show token on a trusted local setup screen/);
  assert.doesNotMatch(oneCommandStart.stdout, /Authorization: Bearer <ownerToken>/);
  assert.doesNotMatch(oneCommandStart.stdout, /Authorization: Bearer token/);
  config = loadConfig();
  const oneCommandWorkspace = config.workspaces.find((workspace) => workspace.id === "one-command");
  assert.equal(config.port, oneCommandPort);
  assert.equal(oneCommandWorkspace?.name, "one-command");
  assert.equal(oneCommandWorkspace?.path, oneCommandRoot);
  assert.deepEqual(oneCommandWorkspace?.permissions, {
    read: true,
    write: true,
    shell: true,
    codex: false,
    screen: false,
  });
  assert.ok(oneCommandWorkspace?.policy?.allowedCommands?.includes("npm *"));
  const herePort = await getFreePort();
  writeConfig({
    ...loadConfig(),
    port: herePort,
  });
  const hereStart = await runCliUntilStdoutFrom(hereRoot, "tunnel: disabled", "here");
  assert.match(hereStart.stdout, /Computer Linker auto setup/);
  assert.match(hereStart.stdout, /workspace: created here-project \(here-project\)/);
  assert.match(hereStart.stdout, /Computer Linker started/);
  assert.match(hereStart.stdout, /startup check: ready \(\d+\/\d+\)/);
  config = loadConfig();
  const hereWorkspace = config.workspaces.find((workspace) => workspace.id === "here-project");
  assert.equal(config.port, herePort);
  assert.equal(hereWorkspace?.name, "here-project");
  assert.equal(hereWorkspace?.path, hereRoot);
  assert.deepEqual(hereWorkspace?.permissions, {
    read: true,
    write: true,
    shell: true,
    codex: false,
    screen: false,
  });
  assert.ok(hereWorkspace?.policy?.allowedCommands?.includes("npm *"));
  await assert.rejects(
    () => runCliOutput("here", hereRoot),
    /here does not accept a workspace path/,
  );
  const hereHelpRuntime = (await runCliOutputFrom(hereRoot, "here", "--help")).stdout;
  assert.match(hereHelpRuntime, /Computer Linker here/);
  assert.match(hereHelpRuntime, /Equivalent to `computer-linker start \.`/);
  const devStartPort = await getFreePort();
  writeConfig({
    ...loadConfig(),
    port: devStartPort,
  });
  const devStart = await runCliUntilStdout("tunnel: disabled", "start", devStartRoot, "--dev");
  assert.match(devStart.stdout, /workspace: created dev-start \(dev-start\)/);
  assert.match(devStart.stdout, /access: read\/write, commands/);
  assert.match(devStart.stdout, /command policy: default limits/);
  assert.doesNotMatch(devStart.stdout, /permissions:/);
  assert.doesNotMatch(devStart.stdout, /allowedCommands=/);
  assert.match(devStart.stdout, /startup check: ready \(\d+\/\d+\)/);
  config = loadConfig();
  const devStartWorkspace = config.workspaces.find((workspace) => workspace.id === "dev-start");
  assert.deepEqual(devStartWorkspace?.permissions, {
    read: true,
    write: true,
    shell: true,
    codex: false,
    screen: false,
  });
  assert.ok(devStartWorkspace?.policy?.allowedCommands?.includes("npm *"));
  await installFakeCloudflared(fakeBinRoot);
  process.env.PATH = `${fakeBinRoot}${delimiter}${process.env.PATH ?? ""}`;
  const tunnelAutoPort = await getFreePort();
  writeConfig({
    ...loadConfig(),
    port: tunnelAutoPort,
    publicBaseUrl: undefined,
    publicMcpOnly: false,
  });
  const tunnelStart = await runCliUntilReady("start", "--tunnel", "cloudflare", "--tunnel-timeout-ms", "1000");
  assert.match(tunnelStart.stdout, /public access: MCP endpoint only for cloudflare tunnel/);
  assert.match(tunnelStart.stdout, /Computer Linker started/);
  assert.match(tunnelStart.stdout, /connect: https:\/\/cli-auto\.trycloudflare\.com\/mcp/);
  assert.match(tunnelStart.stdout, /tunnel: cloudflare active/);
  assert.match(tunnelStart.stdout, /public MCP: https:\/\/cli-auto\.trycloudflare\.com\/mcp/);
  assert.match(tunnelStart.stdout, /Use https:\/\/cli-auto\.trycloudflare\.com\/mcp as the remote MCP URL\./);
  assert.doesNotMatch(tunnelStart.stdout, /Public MCP URL: pending tunnel detection/);
  assert.equal(loadConfig().publicMcpOnly, true);
  const exposeAutoPort = await getFreePort();
  writeConfig({
    ...loadConfig(),
    port: exposeAutoPort,
    publicBaseUrl: undefined,
    publicMcpOnly: false,
  });
  process.env.COMPUTER_LINKER_FAKE_CLOUDFLARED_EXIT = "1";
  const exposeTunnel = await runCliOutput("expose", "cloudflare");
  assert.match(exposeTunnel.stdout, /public access: MCP endpoint only for cloudflare tunnel/);
  assert.equal(loadConfig().publicMcpOnly, true);
  await assert.rejects(
    () => runCliOutput("expose", "cloudflare", "--mode", "funnel"),
    /expose --mode is only valid with tailscale/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--tunnel", "bad"),
    /start --tunnel must be one of: cloudflare, tailscale, openai/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--mode", "funnel"),
    /start --mode is only valid with --tunnel tailscale/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--tunnel", "tailscale", "--mode", "serve"),
    /start --mode must be funnel/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--tunnel", "openai"),
    /requires --tunnel-id tunnel_\.\.\. or COMPUTER_LINKER_OPENAI_TUNNEL_ID/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--tunnel", "openai", "--tunnel-id", "tunnel_test"),
    /requires CONTROL_PLANE_API_KEY .*PowerShell: \$env:CONTROL_PLANE_API_KEY = "sk-\.\.\."/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--tunnel-id", "tunnel_test"),
    /only valid with --tunnel openai/,
  );
  const fakeOpenAiTunnelClient = await installFakeOpenAiTunnelClient(fakeBinRoot);
  const openAiStartPort = await getFreePort();
  process.env.CONTROL_PLANE_API_KEY = "test-control-plane-key";
  writeConfig({
    ...loadConfig(),
    port: openAiStartPort,
    publicBaseUrl: undefined,
    publicMcpOnly: false,
  });
  const openAiStart = await runCliUntilStdout(
    "tunnel: OpenAI Secure MCP Tunnel active",
    "start",
    "--tunnel",
    "openai",
    "--tunnel-id",
    "tunnel_cli_test",
    "--tunnel-client",
    fakeOpenAiTunnelClient,
    "--tunnel-timeout-ms",
    "1",
  );
  assert.match(openAiStart.stdout, /OpenAI tunnel-client: ready \(override\)/);
  assert.match(openAiStart.stdout, /Computer Linker started/);
  assert.match(openAiStart.stdout, /connect: OpenAI Tunnel mode \(tunnel_cli_test\)/);
  assert.match(openAiStart.stdout, /auth: handled by tunnel-client; do not paste a bearer token into ChatGPT/);
  assert.match(openAiStart.stdout, /tunnel: OpenAI Secure MCP Tunnel active/);
  assert.match(openAiStart.stdout, /tunnel id: tunnel_cli_test/);
  assert.match(openAiStart.stdout, /In ChatGPT connector settings, choose Tunnel mode and select or paste the tunnel id above\./);
  assert.doesNotMatch(openAiStart.stdout, /health file:/);
  assert.doesNotMatch(openAiStart.stdout, /Public MCP URL: not used in OpenAI tunnel mode/);
  assert.doesNotMatch(openAiStart.stdout, /HTTP auth: OpenAI tunnel-client forwards the owner token/);
  assert.doesNotMatch(openAiStart.stdout, /HTTP auth: send this header from your MCP client/);
  assert.doesNotMatch(openAiStart.stdout, /Authorization: Bearer <ownerToken>/);
  assert.match(openAiStart.stdout, /startup check: ready \(\d+\/\d+\)/);
  assert.doesNotMatch(openAiStart.stdout, /Local private MCP target: http:\/\/127\.0\.0\.1:\d+\/mcp/);
  assert.doesNotMatch(openAiStart.stdout, /Configured public MCP URL: http:\/\/127\.0\.0\.1/);
  await assert.rejects(
    () => runCliOutput("start", "--no-tunnel", "--tunnel", "cloudflare"),
    /accepts either --tunnel or --no-tunnel/,
  );
  await assert.rejects(
    () => runCliOutput("start", "--write"),
    /start --write is only valid when start is given a workspace path/,
  );

  writeConfig({
    ...config,
    ownerToken: undefined,
  });
  await assert.rejects(
    () => runCliOutput("start", "--tunnel", "cloudflare"),
    /Refusing to expose Computer Linker without an owner token/,
  );
  await assert.rejects(
    () => runCliOutput("expose", "cloudflare"),
    /Refusing to expose Computer Linker without an owner token/,
  );

  const initText = (await runCliOutput("init")).stdout;
  assert.match(initText, /Updated Computer Linker config with owner token:/);
  assert.match(initText, /ownerToken: created/);
  assert.match(initText, /authHeader: Authorization: Bearer <ownerToken>/);
  assert.match(initText, /showToken: computer-linker profile --show-token/);
  assert.doesNotMatch(initText, /Authorization: Bearer [A-Za-z0-9_-]{32,}/);
  assert.doesNotMatch(initText, /ownerTokenValue: [A-Za-z0-9_-]{32,}/);
  config = loadConfig();
  assert.equal(typeof config.ownerToken, "string");
  assert.ok((config.ownerToken ?? "").length >= 32);
  const initShowTokenText = (await runCliOutput("init", "--show-token")).stdout;
  assert.match(initShowTokenText, /Computer Linker config already exists:/);
  assert.match(initShowTokenText, /ownerToken: configured/);
  assert.match(initShowTokenText, /authHeader: Authorization: Bearer [A-Za-z0-9_-]{32,}/);
  assert.match(initShowTokenText, /ownerTokenValue: [A-Za-z0-9_-]{32,}/);
  await assert.rejects(
    () => runCliOutput("init", "--bad"),
    /Unknown init option: --bad/,
  );
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;
  if (originalWorkspaceLinkerConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  else process.env.COMPUTER_LINKER_CONFIG_DIR = originalWorkspaceLinkerConfigDir;
  if (originalControlPlaneApiKey === undefined) delete process.env.CONTROL_PLANE_API_KEY;
  else process.env.CONTROL_PLANE_API_KEY = originalControlPlaneApiKey;
  if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  if (originalOpenAiTunnelId === undefined) delete process.env.COMPUTER_LINKER_OPENAI_TUNNEL_ID;
  else process.env.COMPUTER_LINKER_OPENAI_TUNNEL_ID = originalOpenAiTunnelId;
  if (originalOpenAiTunnelClient === undefined) delete process.env.COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT;
  else process.env.COMPUTER_LINKER_OPENAI_TUNNEL_CLIENT = originalOpenAiTunnelClient;
  if (originalFakeCloudflaredExit === undefined) delete process.env.COMPUTER_LINKER_FAKE_CLOUDFLARED_EXIT;
  else process.env.COMPUTER_LINKER_FAKE_CLOUDFLARED_EXIT = originalFakeCloudflaredExit;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;

  await rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 });
}

function markCliSection(label: string): void {
  const now = Date.now();
  const elapsedMs = now - cliSectionStartedAt;
  cliSectionStartedAt = now;
  process.stderr.write(`[cli.test] ${label} (+${formatDuration(elapsedMs)})\n`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function runCli(...args: string[]): Promise<void> {
  await runCliOutput(...args);
}

async function runCliOutput(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliOutputWithEnv({}, ...args);
}

async function runCliOutputWithEnv(env: NodeJS.ProcessEnv, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliOutputWithEnvFrom(process.cwd(), env, ...args);
}

async function runCliOutputFrom(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliOutputWithEnvFrom(cwd, {}, ...args);
}

async function runCliOutputWithEnvFrom(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, sourceCliArgs(...args), {
    cwd,
    timeout: 30000,
    env: {
      ...process.env,
      ...env,
      LOCALPORT_CONFIG_DIR: process.env.LOCALPORT_CONFIG_DIR,
      COMPUTER_LINKER_CONFIG_DIR: process.env.COMPUTER_LINKER_CONFIG_DIR,
    },
  });
}

function runCliFailure(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, sourceCliArgs(...args), {
    cwd: process.cwd(),
    timeout: 5000,
    encoding: "utf8",
    env: {
      ...process.env,
      LOCALPORT_CONFIG_DIR: process.env.LOCALPORT_CONFIG_DIR,
      COMPUTER_LINKER_CONFIG_DIR: process.env.COMPUTER_LINKER_CONFIG_DIR,
    },
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runCliUntilReady(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliUntilStdout("server: running", ...args);
}

async function runCliUntilStdout(marker: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliUntilStdoutFrom(process.cwd(), marker, ...args);
}

async function runCliUntilStdoutFrom(cwd: string, marker: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(process.execPath, sourceCliArgs(...args), {
    cwd,
    env: {
      ...process.env,
      LOCALPORT_CONFIG_DIR: process.env.LOCALPORT_CONFIG_DIR,
      COMPUTER_LINKER_CONFIG_DIR: process.env.COMPUTER_LINKER_CONFIG_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let ready = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for CLI output ${marker}. stdout=${stdout} stderr=${stderr}`));
    }, CLI_READY_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (!ready && stdout.includes(marker)) {
        ready = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (ready) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`CLI exited before output ${marker} code=${code ?? "null"} signal=${signal ?? "null"} stdout=${stdout} stderr=${stderr}`));
    });
  });
}

function sourceCliArgs(...args: string[]): string[] {
  return ["--import", sourceTsxLoaderUrl, sourceCliPath, ...args];
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Unable to allocate a test port"));
      });
    });
  });
}

async function installFakeCloudflared(directory: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(join(directory, "cloudflared.cmd"), [
      "@echo off",
      "if \"%1\"==\"--version\" (",
      "  echo cloudflared version test",
      "  exit /b 0",
      ")",
      "if \"%COMPUTER_LINKER_FAKE_CLOUDFLARED_EXIT%\"==\"1\" (",
      "  echo https://cli-auto.trycloudflare.com",
      "  exit /b 0",
      ")",
      "echo https://cli-auto.trycloudflare.com",
      ":loop",
      "ping -n 2 127.0.0.1 >nul",
      "goto loop",
      "",
    ].join("\r\n"));
    return;
  }

  const path = join(directory, "cloudflared");
  await writeFile(path, [
    "#!/usr/bin/env sh",
    "if [ \"$1\" = \"--version\" ]; then",
    "  echo 'cloudflared version test'",
    "  exit 0",
    "fi",
    "if [ \"$COMPUTER_LINKER_FAKE_CLOUDFLARED_EXIT\" = \"1\" ]; then",
    "  echo 'https://cli-auto.trycloudflare.com'",
    "  exit 0",
    "fi",
    "echo 'https://cli-auto.trycloudflare.com'",
    "while true; do sleep 1; done",
    "",
  ].join("\n"));
  await chmod(path, 0o755);
}

async function installFakeOpenAiTunnelClient(directory: string): Promise<string> {
  const path = join(directory, process.platform === "win32" ? "tunnel-client.cmd" : "tunnel-client");
  if (process.platform === "win32") {
    await writeFile(path, [
      "@echo off",
      "if \"%1\"==\"--version\" (",
      "  echo tunnel-client test",
      "  exit /b 0",
      ")",
      "ping -n 4 127.0.0.1 >nul",
      "exit /b 0",
      "",
    ].join("\r\n"));
    return path;
  }

  await writeFile(path, [
    "#!/usr/bin/env sh",
    "if [ \"$1\" = \"--version\" ]; then",
    "  echo 'tunnel-client test'",
    "  exit 0",
    "fi",
    "sleep 3",
    "",
  ].join("\n"));
  await chmod(path, 0o755);
  return path;
}
