#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  console.error(`package smoke failed: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function normalizePackagePath(value) {
  return value.replace(/^\.\//, "").replaceAll("\\", "/");
}

function parsePackJson(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  assert(start !== -1 && end !== -1 && end > start, "npm pack did not return JSON output");
  return JSON.parse(output.slice(start, end + 1));
}

function parseJsonObjectOutput(output, label) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  assert(start !== -1 && end !== -1 && end > start, `${label} did not return JSON output`);
  return JSON.parse(output.slice(start, end + 1));
}

function collectExportPaths(value, paths = []) {
  if (typeof value === "string") {
    paths.push(value);
    return paths;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      collectExportPaths(child, paths);
    }
  }
  return paths;
}

function runNpm(args, options = {}) {
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  };
  if (options.forceRealRun) {
    env.npm_config_dry_run = "false";
  }
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...args] : args;
  return execFileSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runInstalledBin(consumerDir, binName, args, options = {}) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const binPath = join(consumerDir, "node_modules", ".bin", `${binName}${suffix}`);
  assert(existsSync(binPath), `installed package did not create ${binName} bin`);
  return runNpm(["exec", "--", binName, ...args], { cwd: consumerDir, env: options.env, forceRealRun: true });
}

const packOutput = runNpm(["pack", "--dry-run", "--json"]);
const [pack] = parsePackJson(packOutput);
assert(pack, "npm pack did not report package metadata");

const packedFiles = new Set(pack.files.map((file) => normalizePackagePath(file.path)));
const requiredFiles = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "SECURITY.md",
  "docs/alpha-evidence.example.json",
  "docs/chatgpt-setup.md",
  "docs/agent-instructions.md",
  "docs/api-compatibility.md",
  "docs/client-recipes.md",
  "docs/computer-operation-v1.schema.json",
  "docs/release-checklist.md",
  "examples/minimal-mcp-client.mjs",
  "dist/cli.js",
  "dist/client.js",
  "dist/client.d.ts",
  "dist/client-smoke.js",
  "dist/client-smoke.d.ts",
];

for (const path of requiredFiles) {
  assert(packedFiles.has(path), `missing required packed file: ${path}`);
}

for (const path of packedFiles) {
  assert(!path.startsWith("src/"), `source file leaked into package: ${path}`);
  assert(!path.includes(".test."), `test file leaked into package: ${path}`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const installedPackageRoot = (consumerDir) => join(consumerDir, "node_modules", ...packageJson.name.split("/"));

assert(packageJson.bin?.["computer-linker"] === "dist/cli.js", "computer-linker bin must point to dist/cli.js");
assert(!Object.hasOwn(packageJson.bin ?? {}, "localport"), "package must not publish the legacy localport CLI alias");

for (const [name, path] of Object.entries(packageJson.bin ?? {})) {
  const normalizedPath = normalizePackagePath(path);
  assert(packedFiles.has(normalizedPath), `bin ${name} points to unpacked file: ${path}`);
  const firstLine = readFileSync(normalizedPath, "utf8").split(/\r?\n/, 1)[0];
  assert(firstLine === "#!/usr/bin/env node", `bin ${name} target must start with a node shebang: ${path}`);
}

for (const path of collectExportPaths(packageJson.exports)) {
  assert(packedFiles.has(normalizePackagePath(path)), `export points to unpacked file: ${path}`);
}

const helpOutput = execFileSync(process.execPath, ["dist/cli.js", "help"], {
  encoding: "utf8",
});
const bareCliOutput = execFileSync(process.execPath, ["dist/cli.js"], {
  encoding: "utf8",
});
const advancedHelpOutput = execFileSync(process.execPath, ["dist/cli.js", "help", "advanced"], {
  encoding: "utf8",
});
const profileHelpOutput = execFileSync(process.execPath, ["dist/cli.js", "profile", "--help"], {
  encoding: "utf8",
});
const chatGptHelpOutput = execFileSync(process.execPath, ["dist/cli.js", "help", "chatgpt"], {
  encoding: "utf8",
});
const versionOutput = execFileSync(process.execPath, ["dist/cli.js", "--version"], {
  encoding: "utf8",
});
const sourceQuickstart = parseJsonObjectOutput(
  execFileSync(process.execPath, ["dist/cli.js", "quickstart", "C:\\Projects\\my-app", "--json"], {
    encoding: "utf8",
  }),
  "source quickstart",
);
const sourceOpenAiQuickstart = parseJsonObjectOutput(
  execFileSync(process.execPath, ["dist/cli.js", "quickstart", "C:\\Projects\\my-app", "--tunnel", "openai", "--tunnel-id", "tunnel_smoke", "--json"], {
    encoding: "utf8",
  }),
  "source OpenAI quickstart",
);
const sourceCliPath = resolve("dist/cli.js");
const sourceAbsoluteQuickstart = parseJsonObjectOutput(
  execFileSync(process.execPath, [sourceCliPath, "quickstart", "C:\\Projects\\my-app", "--write", "--json"], {
    cwd: tmpdir(),
    encoding: "utf8",
  }),
  "source absolute quickstart",
);
const sourceInitConfigDir = mkdtempSync(join(tmpdir(), "computer-linker-source-init-"));
const sourceInitOutput = execFileSync(process.execPath, ["dist/cli.js", "init"], {
  encoding: "utf8",
  env: {
    ...process.env,
    LOCALPORT_CONFIG_DIR: "",
    COMPUTER_LINKER_CONFIG_DIR: sourceInitConfigDir,
  },
});
assert(helpOutput.includes("Computer Linker"), "CLI help did not start successfully");
assert(bareCliOutput === helpOutput, "bare CLI invocation must print help instead of starting a server");
assert(helpOutput.includes("computer-linker here"), "default CLI help must expose the current-folder shortcut");
assert(helpOutput.includes("computer-linker start <workspace-path>"), "default CLI help must keep the explicit path setup command");
assert(helpOutput.includes("computer-linker start <workspace-path> --tunnel openai|tailscale|cloudflare"), "default CLI help must collapse tunnel providers into one first-run command");
assert(helpOutput.includes("computer-linker check"), "default CLI help must expose the productized install check");
assert(helpOutput.includes("computer-linker quickstart C:\\Projects\\my-app"), "default CLI help must include the quickstart preview without exposing the full option matrix");
assert(helpOutput.includes("computer-linker client setup"), "default CLI help must include generic MCP client setup");
assert(helpOutput.includes("computer-linker help advanced"), "default CLI help must point advanced users to extended commands");
assert(!helpOutput.includes("computer-linker self-test"), "default CLI help must keep install self-test in advanced help");
assert(!helpOutput.includes("computer-linker client smoke"), "default CLI help must keep client smoke in advanced help");
assert(!helpOutput.includes("computer-linker doctor --fix"), "default CLI help must keep repair commands in focused help");
assert(!helpOutput.includes("client chatgpt"), "default CLI help must keep ChatGPT-specific helpers out of the first-run surface");
assert(!helpOutput.toLowerCase().includes("dashboard"), "default CLI help must stay CLI-first and not advertise a dashboard");
assert(!/localport/i.test(helpOutput), "default CLI help must not advertise legacy LocalPort compatibility");
assert(!helpOutput.includes("serve --transport"), "default CLI help must keep low-level serve commands in advanced help");
assert(!helpOutput.includes("--no-tunnel"), "default CLI help must not show legacy no-tunnel compatibility");
assert(!profileHelpOutput.includes("--chatgpt"), "profile help must not advertise ChatGPT-specific shortcuts");
assert(advancedHelpOutput.includes("computer-linker help chatgpt"), "advanced help must point ChatGPT users to the dedicated compatibility help");
assert(!advancedHelpOutput.includes("computer-linker client chatgpt url"), "advanced help must not foreground ChatGPT-specific helpers");
assert(chatGptHelpOutput.includes("ChatGPT is one MCP client, not the product axis"), "ChatGPT help must frame ChatGPT as a compatibility client");
assert(chatGptHelpOutput.includes("computer-linker client chatgpt url"), "ChatGPT help must list ChatGPT-specific compatibility commands");
assert(versionOutput.trim() === `computer-linker ${packageJson.version}`, "CLI --version must match package.json");
assert(sourceQuickstart.kind === "computer-linker-quickstart", "source quickstart did not return the quickstart report");
assert(sourceQuickstart.commandPrefix?.includes("node"), "source quickstart must use the checkout node runner");
assert(sourceQuickstart.commands?.check?.includes("check"), "source quickstart must expose commands.check");
assert(sourceQuickstart.commands?.selfTest === sourceQuickstart.commands?.check, "source quickstart must preserve selfTest as a compatibility alias");
assert(sourceQuickstart.commands?.start?.includes("dist"), "source quickstart must point at dist/cli.js commands");
assert(!sourceQuickstart.commands?.start?.includes("--dev"), "source quickstart should not require the legacy development preset");
assert(sourceQuickstart.permissions?.write === true, "source quickstart default mode did not enable write permission");
assert(sourceQuickstart.permissions?.shell === true, "source quickstart default mode did not enable shell permission");
assert(sourceQuickstart.terminalHint?.includes("another terminal"), "source quickstart must explain that start keeps running and the remaining commands need another terminal");
assert(sourceOpenAiQuickstart.prerequisites?.some((item) => item.includes("CONTROL_PLANE_API_KEY")), "source OpenAI quickstart must surface the API key prerequisite");
assert(sourceOpenAiQuickstart.prerequisites?.some((item) => item.includes("PowerShell: $env:CONTROL_PLANE_API_KEY")), "source OpenAI quickstart must include a copy-pasteable PowerShell API key hint");
assert(sourceAbsoluteQuickstart.commandPrefix?.includes(sourceCliPath), "source absolute quickstart must preserve the invoked dist/cli.js path");
assert(sourceAbsoluteQuickstart.commands?.start?.includes(sourceCliPath), "source absolute quickstart commands must stay runnable outside the checkout cwd");
assert(sourceInitOutput.includes("showToken: node"), "source init must use the checkout node runner in token guidance");
assert(sourceInitOutput.includes("dist"), "source init token guidance must point at dist/cli.js");
rmSync(sourceInitConfigDir, { recursive: true, force: true });

const clientModule = await import(pathToFileURL(resolve("dist/client.js")).href);
assert(
  typeof clientModule.ComputerLinkerClient === "function",
  "SDK entrypoint did not export ComputerLinkerClient",
);
assert(
  typeof clientModule.ComputerLinkerClient.prototype.smoke === "function",
  "SDK entrypoint did not expose the generic client smoke helper",
);
assert(
  clientModule.WorkspaceLinkerClient === clientModule.ComputerLinkerClient,
  "SDK entrypoint must preserve WorkspaceLinkerClient as a compatibility alias",
);

const installRoot = mkdtempSync(join(tmpdir(), "computer-linker-install-smoke-"));
try {
  const packDestination = join(installRoot, "package");
  const consumerDir = join(installRoot, "consumer");
  mkdirSync(packDestination, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });
  const actualPackOutput = runNpm(["pack", "--json", "--pack-destination", packDestination], { forceRealRun: true });
  const [actualPack] = parsePackJson(actualPackOutput);
  assert(actualPack?.filename, "npm pack did not create an installable package archive");
  const tarball = join(packDestination, actualPack.filename);
  assert(existsSync(tarball), `package archive was not written: ${tarball}`);

  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
  }, null, 2));
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: consumerDir, forceRealRun: true });

  const installedHelp = runInstalledBin(consumerDir, "computer-linker", ["help"]);
  assert(installedHelp.includes("computer-linker here"), "installed CLI bin help did not expose the current-folder shortcut");
  assert(installedHelp.includes("computer-linker start <workspace-path>"), "installed CLI bin help did not run correctly");
  assert(installedHelp.includes("computer-linker quickstart C:\\Projects\\my-app"), "installed CLI bin help did not expose quickstart preview");
  const installedVersion = runInstalledBin(consumerDir, "computer-linker", ["--version"]);
  assert(installedVersion.trim() === `computer-linker ${packageJson.version}`, "installed CLI bin version did not match package.json");
  const installedConfigDir = join(installRoot, "installed-config");
  const installedWorkspaceDir = join(installRoot, "installed-workspace");
  mkdirSync(installedWorkspaceDir, { recursive: true });
  const installedQuickstart = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["quickstart", installedWorkspaceDir, "--json"]),
    "installed quickstart",
  );
  assert(installedQuickstart.kind === "computer-linker-quickstart", "installed quickstart did not return the quickstart report");
  assert(installedQuickstart.commandPrefix === "computer-linker", "installed quickstart must use the published CLI command");
  assert(installedQuickstart.commands?.check?.includes("computer-linker check"), "installed quickstart must expose the check command");
  assert(installedQuickstart.commands?.selfTest === installedQuickstart.commands?.check, "installed quickstart must preserve selfTest as a compatibility alias");
  assert(installedQuickstart.commands?.start?.includes("computer-linker start"), "installed quickstart did not include the start command");
  assert(!installedQuickstart.commands?.start?.includes("--dev"), "installed quickstart should not require the legacy development preset");
  assert(installedQuickstart.terminalHint?.includes("another terminal"), "installed quickstart must explain that follow-up commands run in another terminal");
  assert(installedQuickstart.permissions?.write === true, "installed quickstart default mode did not enable write permission");
  assert(installedQuickstart.permissions?.shell === true, "installed quickstart default mode did not enable shell permission");
  assert(installedQuickstart.connection?.authHeader === "Authorization: Bearer <ownerToken>", "installed quickstart must not reveal owner tokens");
  const installedCheck = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["check", "--json"]),
    "installed check",
  );
  assert(installedCheck.kind === "computer-linker-self-test", "installed check did not return the self-test report");
  assert(installedCheck.ready === true, "installed check was not ready");
  assert(installedCheck.smoke?.checks?.some((check) => check.id === "mcp-list-tools" && check.status === "pass"), "installed check did not verify MCP tools/list");
  assert(installedCheck.smoke?.checks?.some((check) => check.id === "mcp-get-computer-info" && check.status === "pass"), "installed check did not verify MCP get_computer_info");
  assert(installedCheck.smoke?.checks?.some((check) => check.id === "mcp-read-only-operation" && check.status === "pass"), "installed check did not verify MCP computer_operation");
  assert(installedCheck.smoke?.authHeader === "Authorization: Bearer <ownerToken>", "installed check must not reveal the generated owner token");
  const installedSelfTestHelp = runInstalledBin(consumerDir, "computer-linker", ["self-test", "--help"]);
  assert(installedSelfTestHelp.includes("computer-linker self-test"), "installed self-test compatibility help did not run");

  const installedEnv = { COMPUTER_LINKER_CONFIG_DIR: installedConfigDir };
  const installedSetup = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["setup", installedWorkspaceDir, "--id", "app", "--write", "--json"], { env: installedEnv }),
    "installed setup",
  );
  assert(installedSetup.kind === "computer-linker-mcp-only-setup", "installed setup did not return the setup report");
  assert(installedSetup.ownerTokenCreated === true, "installed setup should create an owner token in an isolated config");
  assert(installedSetup.workspace?.id === "app", "installed setup did not create the requested workspace id");
  assert(installedSetup.workspace?.name === basename(installedWorkspaceDir), "installed setup should default workspace name from folder name");
  assert(installedSetup.workspace?.path === installedWorkspaceDir, "installed setup stored the wrong workspace path");
  assert(installedSetup.workspace?.permissions?.write === true, "installed setup did not persist write permission");

  const installedStatus = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["status", "--json"], { env: installedEnv }),
    "installed status",
  );
  assert(installedStatus.kind === "computer-linker-status", "installed status did not return the status report");
  assert(installedStatus.auth?.ownerTokenConfigured === true, "installed status did not read the isolated owner token");
  assert(installedStatus.workspaces?.total === 1, "installed status did not read the isolated workspace");
  assert(installedStatus.workspaces?.items?.[0]?.id === "app", "installed status returned the wrong workspace id");
  assert(installedStatus.workspaces?.items?.[0]?.permissions?.write === true, "installed status returned the wrong workspace permissions");

  const installedClientSetup = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["client", "setup", "--json"], { env: installedEnv }),
    "installed client setup",
  );
  assert(installedClientSetup.kind === "computer-linker-mcp-client-setup", "installed client setup did not return the MCP client setup report");
  assert(installedClientSetup.localReady === true, "installed client setup should be ready for local loopback clients");
  assert(installedClientSetup.connection?.localMcpUrl?.endsWith("/mcp"), "installed client setup did not include a local MCP URL");
  assert(installedClientSetup.auth?.bearerHeader === "Authorization: Bearer <ownerToken>", "installed client setup must not reveal the generated owner token");
  assert(installedClientSetup.auth?.alternateBearerHeader === "x-computer-linker-token: <ownerToken>", "installed client setup must redact alternate bearer token by default");
  assert(Array.isArray(installedClientSetup.tools), "installed client setup did not include a tool list");
  assert(installedClientSetup.tools.includes("get_computer_info"), "installed client setup did not include get_computer_info");
  assert(installedClientSetup.tools.includes("computer_operation"), "installed client setup did not include computer_operation");
  assert(installedClientSetup.tools.includes("get_operation_history"), "installed client setup did not include get_operation_history");
  assert(installedClientSetup.firstPrompt?.includes("computerOperationRegistry"), "installed client setup first prompt must point agents at computerOperationRegistry");
  assert(installedClientSetup.firstPrompt?.includes("Do not call compatibility workspace tools"), "installed client setup first prompt must keep compatibility tools opt-in");
  assert(installedClientSetup.agentInstructions?.some((line) => line.includes("Call computer_operation with dotted ops")), "installed client setup must include generic computer_operation agent guidance");
  assert(installedClientSetup.agentInstructions?.some((line) => line.includes("Do not call workspace_operation")), "installed client setup must warn agents away from compatibility tools");
  const installedClientDiagnosis = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["diagnose", "client", "--url", "not a url", "--json"], { env: installedEnv }),
    "installed client diagnosis",
  );
  assert(installedClientDiagnosis.kind === "computer-linker-client-diagnosis", "installed client diagnosis did not return the diagnosis report");
  assert(installedClientDiagnosis.target === "url", "installed client diagnosis did not preserve the explicit URL target");
  assert(installedClientDiagnosis.diagnosis?.ready === false, "installed client diagnosis should fail on an invalid URL");
  const installedClientSetupWithToken = parseJsonObjectOutput(
    runInstalledBin(consumerDir, "computer-linker", ["client", "setup", "--show-token", "--json"], { env: installedEnv }),
    "installed client setup with token",
  );
  assert(/^Authorization: Bearer [A-Za-z0-9_-]{32,}$/.test(installedClientSetupWithToken.auth?.bearerHeader ?? ""), "installed client setup --show-token must print the generated bearer header");
  assert(/^x-computer-linker-token: [A-Za-z0-9_-]{32,}$/.test(installedClientSetupWithToken.auth?.alternateBearerHeader ?? ""), "installed client setup --show-token must print the alternate bearer header");

  const installedPackageDir = installedPackageRoot(consumerDir);
  const installedPackageJson = JSON.parse(readFileSync(join(installedPackageDir, "package.json"), "utf8"));
  assert(installedPackageJson.version === packageJson.version, "installed package version does not match source package.json");
  const installedClientModule = await import(pathToFileURL(join(installedPackageDir, "dist", "client.js")).href);
  assert(
    typeof installedClientModule.ComputerLinkerClient === "function",
    "installed SDK entrypoint did not export ComputerLinkerClient",
  );
  assert(
    typeof installedClientModule.ComputerLinkerClient.prototype.smoke === "function",
    "installed SDK entrypoint did not expose the generic client smoke helper",
  );
  assert(
    installedClientModule.WorkspaceLinkerClient === installedClientModule.ComputerLinkerClient,
    "installed SDK entrypoint must preserve WorkspaceLinkerClient as a compatibility alias",
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}

console.log(
  `package smoke ok: ${pack.filename}, ${pack.files.length} files, CLI/SDK entrypoints, quickstart, setup, client setup/diagnosis, check, and package install verified`,
);
