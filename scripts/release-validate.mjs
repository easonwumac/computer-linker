#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const tagBuild = process.env.GITHUB_REF_TYPE === "tag";

function fail(message) {
  console.error(`release validation failed: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function countMatches(text, regex) {
  return Array.from(text.matchAll(regex)).length;
}

function assertSingleWindowsNodeGate(workflowText, label) {
  assert(!/\bstrategy:/i.test(workflowText), `${label} workflow must not use a strategy matrix while Actions budget is constrained`);
  assert(!/\bmatrix:/i.test(workflowText), `${label} workflow must not use a matrix while Actions budget is constrained`);
  assert(!/\bubuntu-[a-z0-9.-]+/i.test(workflowText), `${label} workflow must not include Linux runners in the default Actions gate`);
  assert(!/\bmacos-[a-z0-9.-]+/i.test(workflowText), `${label} workflow must not include macOS runners in the default Actions gate`);
  assert(countMatches(workflowText, /\bruns-on:/g) === 1, `${label} workflow must keep a single Windows runner while Actions budget is constrained`);
  assert(countMatches(workflowText, /\bnode-version:/g) === 1, `${label} workflow must keep a single Node version while Actions budget is constrained`);
  assert(workflowText.includes("runs-on: windows-latest"), `${label} workflow must stay on windows-latest for the primary product gate`);
  assert(workflowText.includes('node-version: "22.x"'), `${label} workflow must stay on the primary Node 22 line`);
}

function assertNoBackgroundActionsTriggers(workflowText, label) {
  assert(!workflowText.includes("schedule:"), `${label} workflow must not auto-run on a schedule while Actions budget is constrained`);
  assert(!workflowText.includes("workflow_run:"), `${label} workflow must not auto-run from another workflow while Actions budget is constrained`);
  assert(!workflowText.includes("tags:"), `${label} workflow must not auto-run on tag push while Actions budget is constrained`);
}

function assertBoundedCiActionsWorkflow(workflowText, label) {
  assert(workflowText.includes("workflow_dispatch"), `${label} workflow must support manual dispatch for reruns`);
  assert(workflowText.includes("push:"), `${label} workflow must run on pushes to main`);
  assert(workflowText.includes("pull_request:"), `${label} workflow must run on pull requests to main`);
  assert(workflowText.includes("branches:") && workflowText.includes("- main"), `${label} workflow auto triggers must be limited to the main branch`);
  assertNoBackgroundActionsTriggers(workflowText, label);
  assertSingleWindowsNodeGate(workflowText, label);
}

function assertManualReleaseActionsWorkflow(workflowText, label) {
  assert(workflowText.includes("workflow_dispatch"), `${label} workflow must be manually dispatched while Actions budget is constrained`);
  assert(!workflowText.includes("push:"), `${label} workflow must not auto-run on push while release packaging is manual`);
  assert(!workflowText.includes("pull_request:"), `${label} workflow must not auto-run on pull_request while release packaging is manual`);
  assertNoBackgroundActionsTriggers(workflowText, label);
  assertSingleWindowsNodeGate(workflowText, label);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  } catch (error) {
    fail(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertNonEmptyFile(path) {
  assert(existsSync(path), `missing required release file: ${path}`);
  assert(readText(path).trim().length > 0, `required release file is empty: ${path}`);
}

const packageJson = readJson("package.json");
const lockJson = readJson("package-lock.json");
const schemaJson = readJson("docs/computer-operation-v1.schema.json");

assert(packageJson.name === "@easonwumac/computer-linker", "package name must be @easonwumac/computer-linker");
assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageJson.version), `package version is not semver-like: ${packageJson.version}`);
assert(packageJson.description === "Local MCP server for controlled computer operations.", "package description must describe the Computer Linker product model");
const packageKeywords = new Set(packageJson.keywords ?? []);
for (const keyword of ["mcp", "mcp-server", "computer", "codex", "local-first", "automation", "screenshot"]) {
  assert(packageKeywords.has(keyword), `package.json keywords must include ${keyword}`);
}
assert(!packageKeywords.has("workspace"), "package.json keywords must not position the package as workspace-first");
assert(!packageKeywords.has("chatgpt"), "package.json keywords must not position ChatGPT as the product axis");
assert(lockJson.name === packageJson.name, "package-lock root name must match package.json");
assert(lockJson.version === packageJson.version, "package-lock root version must match package.json");
assert(lockJson.packages?.[""]?.name === packageJson.name, "package-lock packages[''].name must match package.json");
assert(lockJson.packages?.[""]?.version === packageJson.version, "package-lock packages[''].version must match package.json");

const packageFiles = new Set(packageJson.files ?? []);
for (const path of ["dist", "docs", "examples", "README.md", "CHANGELOG.md", "LICENSE", "SECURITY.md"]) {
  assert(packageFiles.has(path), `package.json files must include ${path}`);
}

for (const path of [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "SECURITY.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/usage-guide.md",
  "docs/cli-reference.md",
  "docs/tutorials.md",
  "docs/command-policy.md",
  "docs/agent-playbook.md",
  "docs/developer-guide.md",
  "docs/architecture.md",
  "docs/product-spec.md",
  "docs/release-checklist.md",
  "docs/service-mode.md",
  "docs/alpha-evidence.example.json",
  "docs/agent-instructions.md",
  "docs/api-compatibility.md",
  "docs/sdk-quickstart.md",
  "docs/client-sdk.md",
  "docs/client-recipes.md",
  "docs/computer-operation-v1.schema.json",
  "examples/minimal-mcp-client.mjs",
  "scripts/alpha-evidence.mjs",
  "scripts/alpha-evidence.test.mjs",
  "scripts/alpha-readiness-report.mjs",
  "scripts/alpha-readiness-report.test.mjs",
  "scripts/package-smoke.mjs",
  "scripts/run-tests.mjs",
  "scripts/create-public-mirror.mjs",
  "scripts/create-public-snapshot.mjs",
  "scripts/release-npm.mjs",
  "scripts/verify-npm-release.mjs",
  "scripts/publish-guard.mjs",
  "scripts/public-release-audit.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
]) {
  assertNonEmptyFile(path);
}

assert(packageJson.scripts?.["public:audit"] === "node scripts/public-release-audit.mjs", "package.json must expose npm run public:audit");
assert(packageJson.scripts?.["public:check"]?.includes("npm run public:audit"), "package.json must expose npm run public:check");
assert(packageJson.scripts?.["public:mirror"] === "node scripts/create-public-mirror.mjs", "package.json must expose npm run public:mirror for the one-command public mirror path");
assert(packageJson.scripts?.["public:ready"] === "node scripts/alpha-readiness-report.mjs --accept-public-snapshot", "package.json must expose npm run public:ready for the fresh public snapshot release path");
assert(packageJson.scripts?.["public:release-ready"] === "node scripts/alpha-readiness-report.mjs --accept-public-snapshot --require-evidence --require-dated-changelog", "package.json must expose npm run public:release-ready for the final public alpha gate");
assert(packageJson.scripts?.["public:repo-ready"] === "npm run product:check && npm run public:audit -- --strict-history", "package.json must expose npm run public:repo-ready for preserved-history public repo checks");
assert(packageJson.scripts?.["public:snapshot"] === "node scripts/create-public-snapshot.mjs", "package.json must expose npm run public:snapshot");
assert(packageJson.scripts?.release === "node scripts/release-npm.mjs --publish --create-tag --push", "package.json must expose one-command npm run release publishing");
assert(packageJson.scripts?.["release:check"] === "node scripts/release-npm.mjs --check", "package.json must expose npm run release:check");
assert(packageJson.scripts?.["release:dry-run"] === "node scripts/release-npm.mjs --dry-run", "package.json must expose npm run release:dry-run");
assert(packageJson.scripts?.["release:publish"] === "node scripts/release-npm.mjs --publish", "package.json must expose npm run release:publish");
assert(packageJson.scripts?.["release:verify"] === "node scripts/verify-npm-release.mjs", "package.json must expose npm run release:verify");
assert(packageJson.scripts?.["alpha:check"] === "node scripts/alpha-readiness-report.mjs", "package.json must expose npm run alpha:check for local alpha readiness");
assert(packageJson.scripts?.["alpha:snapshot-check"] === "node scripts/alpha-readiness-report.mjs --accept-public-snapshot", "package.json must expose npm run alpha:snapshot-check for public snapshot release readiness");
assert(packageJson.scripts?.["alpha:evidence"] === "node scripts/alpha-evidence.mjs", "package.json must expose npm run alpha:evidence for external client/tunnel evidence");
assert(packageJson.scripts?.["publish:guard"] === "node scripts/publish-guard.mjs", "package.json must expose npm run publish:guard");
assert(packageJson.scripts?.prepublishOnly === "npm run publish:guard", "npm publish must run npm run publish:guard via prepublishOnly");
assert(packageJson.scripts?.dev === "tsx src/cli.ts", "npm run dev must expose the source checkout CLI");
assert(packageJson.scripts?.test === "node scripts/run-tests.mjs", "npm test must use the progress-reporting test runner");
const publishGuardScript = readText("scripts/publish-guard.mjs");
const releaseNpmScript = readText("scripts/release-npm.mjs");
const publicReleaseAuditScript = readText("scripts/public-release-audit.mjs");
assert(publishGuardScript.includes("public:check"), "publish guard must run npm run public:check before npm publish");
assert(publishGuardScript.includes("--strict-history"), "publish guard must require strict public history before npm publish");
assert(!publishGuardScript.includes('shell: process.platform === "win32"'), "publish guard must avoid shell: true when invoking npm on Windows");
assert(releaseNpmScript.includes("NODE_AUTH_TOKEN") && releaseNpmScript.includes("Windows user environment"), "release wrapper must load Windows user-level NODE_AUTH_TOKEN without requiring a new shell");
assert(publicReleaseAuditScript.includes('"npm-token"'), "public release audit must scan npm access tokens");
assert(publicReleaseAuditScript.includes("collectUntrackedFiles"), "public release audit must label untracked file findings distinctly");
assert(publicReleaseAuditScript.includes("provenanceRiskPatterns"), "public release audit must scan suspicious third-party provenance markers");
assert(publicReleaseAuditScript.includes("legacyProductNamePatterns"), "public release audit must scan retired product-name markers");
assert(packageJson.scripts?.start === "node dist/cli.js start", "npm start must use the product-mode local HTTP entrypoint");
const testRunnerScript = readText("scripts/run-tests.mjs");
assert(testRunnerScript.includes("src/screenshot.test.ts"), "npm test must include screenshot provider coverage");
assert(testRunnerScript.includes("scripts/alpha-evidence.test.mjs"), "npm test must include alpha evidence tooling coverage");
assert(testRunnerScript.includes("scripts/alpha-readiness-report.test.mjs"), "npm test must include alpha readiness report guidance coverage");
assert(testRunnerScript.includes("test suite:"), "npm test must print progress for long Windows test runs");
assert(packageJson.bin?.["computer-linker"] === "dist/cli.js", "package must publish the computer-linker CLI");
assert(!Object.hasOwn(packageJson.bin ?? {}, "localport"), "package must not publish the legacy localport CLI alias");

const changelog = readText("CHANGELOG.md");
const changelogHeading = new RegExp(`^## ${packageJson.version.replaceAll(".", "\\.")} - .+`, "m");
assert(changelogHeading.test(changelog), `CHANGELOG.md must contain a heading for ${packageJson.version}`);
if (args.has("--require-dated-changelog") || tagBuild) {
  assert(!new RegExp(`^## ${packageJson.version.replaceAll(".", "\\.")} - Unreleased$`, "m").test(changelog), "tagged releases require a dated changelog heading");
}
assert(changelog.includes("short\n  MCP connection summary"), "CHANGELOG must mention the concise client setup summary");
assert(changelog.includes("Public mirror snapshots now create a `v<package.version>` tag"), "CHANGELOG must mention public mirror release tag creation");
assert(changelog.includes("Publishable public mirrors now require the matching changelog heading"), "CHANGELOG must mention the public mirror changelog gate");
assert(changelog.includes("OpenAI Secure MCP Tunnel support now treats tunnel-id mode as remote-ready"), "CHANGELOG must mention OpenAI tunnel mode readiness");
assert(changelog.includes("OpenAI tunnel quickstart, start help, and missing-key errors now surface"), "CHANGELOG must mention OpenAI tunnel API key prerequisite guidance");
assert(changelog.includes("Quickstart text and JSON now explain that `start` stays running"), "CHANGELOG must mention quickstart terminal handoff guidance");
assert(changelog.includes("Product spec guidance for the CLI management surface now matches"), "CHANGELOG must mention product spec first-run help alignment");
assert(changelog.includes("Package metadata now positions Computer Linker as a generic MCP/local\n  automation package"), "CHANGELOG must mention generic package metadata positioning");
assert(changelog.includes("SDK entrypoint types now expose `ComputerLinker*` names"), "CHANGELOG must mention SDK ComputerLinker type exports");
assert(changelog.includes("SDK now includes `client.computer.*` helpers"), "CHANGELOG must mention computer-operation-first SDK helpers");
assert(changelog.includes("CLI quick reference, agent playbook, and SDK quickstart"), "CHANGELOG must mention the expanded teaching docs");
assert(changelog.includes("SDK computer helper contract is now split into `src/client-computer-helpers.ts`"), "CHANGELOG must mention the SDK helper module split");
assert(changelog.includes("Capability discovery now separates primary MCP/JSON API recommendations"), "CHANGELOG must mention primary/compatibility discovery split");
assert(changelog.includes("Public MCP-only routing now treats forwarded public requests as public"), "CHANGELOG must mention public MCP-only spoofed host hardening");
assert(changelog.includes("Owner-token authentication now uses timing-safe comparison"), "CHANGELOG must mention owner-token auth hardening");
assert(changelog.includes("Public release audit now blocks tracked or packed\n  `.computer-linker-alpha-evidence.json`"), "CHANGELOG must mention local alpha evidence release audit protection");
assert(changelog.includes("npm run public:release-ready"), "CHANGELOG must mention the final public release readiness command");
assert(changelog.includes("Local npm release wrapper commands"), "CHANGELOG must mention local npm release automation");
assert(changelog.includes("Added `computer-linker here` as the short daily startup command"), "CHANGELOG must mention the current-folder startup shortcut");
assert(changelog.includes("step-by-step getting started tutorial"), "CHANGELOG must mention the getting started tutorial");
assert(changelog.includes("implementation module map"), "CHANGELOG must mention the architecture module map");
assert(changelog.includes("documentation map"), "CHANGELOG must mention the documentation map");
assert(changelog.includes("Workspace root handling"), "CHANGELOG must mention workspace root handling");
const readme = readText("README.md");
assert(readme.includes("Leave that terminal running. In another terminal"), "README Quick Start must explain that start keeps running and follow-up commands use another terminal");
assert(readme.includes("computer-linker here"), "README Quick Start must document the current-folder startup shortcut");
assert(readme.includes("docs/README.md"), "README must link the documentation map");
assert(readme.includes("docs/getting-started.md"), "README must link the step-by-step tutorial");
assert(readme.includes("docs/cli-reference.md"), "README must link the CLI quick reference");
assert(readme.includes("docs/agent-playbook.md"), "README must link the agent playbook");
assert(readme.includes("docs/sdk-quickstart.md"), "README must link the SDK quickstart");
assert(readme.includes("docs/developer-guide.md"), "README must link the developer guide");
assert(readme.includes("computer-linker check"), "README Quick Start must document the productized install check");
assert(readme.includes("`quickstart --json` exposes `commands.check`"), "README must document the quickstart JSON check command contract");
assert(readme.includes("Call computer_operation with dotted ops from computerOperationRegistry"), "README agent instructions must direct agents to the generic computer_operation registry");
assert(readme.includes("computer-linker diagnose client"), "README must document the client diagnosis command");
assert(readme.includes("node examples/minimal-mcp-client.mjs"), "README must document the minimal MCP client example");
assert(readme.includes("docs/api-compatibility.md"), "README must link the API compatibility policy");
assert(readme.includes("docs/agent-instructions.md"), "README must link reusable agent instructions");
assert(readme.includes("docs/client-recipes.md"), "README must link MCP client recipes");
assert(readme.includes("Capability discovery exposes `discovery.primary`"), "README must explain primary/compatibility discovery split");
assert(readme.includes("does\nnot accept the owner token as a positional command argument"), "README minimal client guidance must avoid positional token arguments");
assert(readme.includes("Sensitive file content is blocked by default"), "README must document default sensitive file protection");
assert(readme.includes('"op": "file.read"'), "README useful first operations must include a generic file.read example");
assert(!readme.includes('"workspaceId": "app", "op": "read"'), "README must not recommend legacy workspaceId/read examples in the agent instructions");
assert(readme.includes("Do not call workspace_operation, read, ls, grep, glob, or create_file unless the server explicitly exposes compatibility tools"), "README agent instructions must keep compatibility tools opt-in");
assert(readme.includes("public:mirror -- --remote <github-owner>/<public-repo>"), "README public mirror guidance must use the one-command --remote path");
assert(readme.includes("npm run public:release-ready"), "README must document the final public release readiness command");
assert(readme.includes("npm run release:publish -- --create-tag --push --otp <code>"), "README must document the local npm release publish wrapper");
assert(readme.includes("npm run release -- --otp <code>"), "README must document the one-command npm release path");
assert(readme.includes("current shell has not picked it up yet"), "README must document Windows user-level NODE_AUTH_TOKEN release hydration");
assert(readme.includes("npm run release:verify"), "README must document the local npm release verification wrapper");
assert(readme.includes("push -u origin main --follow-tags"), "README public mirror push command must include the release tag");
assert(!readme.includes("public:snapshot -- --output ../computer-linker-public --remote <github-owner>/<public-repo>"), "README public snapshot quick path must rely on the default output directory");
assert(readme.includes("pushes to `main`\nand pull requests targeting `main`"), "README must document the automatic bounded CI gate");

const docsIndex = readText("docs/README.md");
assert(docsIndex.includes("Getting Started") && docsIndex.includes("Developer Guide"), "docs index must route users and developers to the right guides");
assert(docsIndex.includes("Client SDK"), "docs index must route SDK consumers to the client SDK guide");
assert(docsIndex.includes("CLI Quick Reference"), "docs index must route CLI users to the quick reference");
assert(docsIndex.includes("Agent Playbook"), "docs index must route agents to the playbook");
assert(docsIndex.includes("SDK Quickstart"), "docs index must route SDK consumers to the short quickstart");

const developerGuide = readText("docs/developer-guide.md");
assert(developerGuide.includes("ensureWorkspaceRootDirectory"), "developer guide must explain shared workspace root helpers");
assert(developerGuide.includes("Adding An Operation"), "developer guide must document the operation extension workflow");
assert(developerGuide.includes("src/client-computer-helpers.ts"), "developer guide must document the SDK helper module boundary");

const architecture = readText("docs/architecture.md");
const agentInstructionsDoc = readText("docs/agent-instructions.md");
assert(architecture.includes("`network:false` is a legacy non-grant marker"), "architecture docs must clarify network:false is not network isolation");
assert(architecture.includes("registry `networkAccess`"), "architecture docs must mention registry networkAccess semantics");
assert(architecture.includes("`discovery.primary` and `discovery.compatibility`"), "architecture docs must explain primary/compatibility discovery split");
assert(architecture.includes("src/client-computer-helpers.ts"), "architecture docs must include the SDK helper module boundary");
assert(agentInstructionsDoc.includes("Do not treat `network:false` as a network sandbox"), "agent instructions must warn clients about network:false semantics");

const apiCompatibility = readText("docs/api-compatibility.md");
assert(apiCompatibility.includes("## Discovery Split"), "API compatibility docs must describe the discovery split");
assert(apiCompatibility.includes("`discovery.compatibility` keeps older workspace tools"), "API compatibility docs must keep compatibility entries migration-only");

const minimalMcpClient = readText("examples/minimal-mcp-client.mjs");
assert(!/\?\?\s*process\.argv\[3\]/.test(minimalMcpClient), "minimal MCP client must not silently accept owner tokens as positional arguments");
assert(minimalMcpClient.includes("Do not pass the owner token as a command argument"), "minimal MCP client must reject positional token arguments with actionable guidance");
assert(minimalMcpClient.includes('op: "file.tree"'), "minimal MCP client must demonstrate a registry-consistent bounded read-only operation");
assert(minimalMcpClient.includes("maxDepth: 1") && minimalMcpClient.includes("maxEntries: 20"), "minimal MCP client must use options valid for file.tree");
assert(minimalMcpClient.includes("scope,\n      view: \"last\""), "minimal MCP client history read must pass the selected scope");

const clientSdkDocs = readText("docs/client-sdk.md");
assert(clientSdkDocs.includes("Passing an MCP URL such as `http://127.0.0.1:3939/mcp` fails immediately"), "client SDK docs must clarify MCP URL fail-fast behavior");
assert(clientSdkDocs.includes("ComputerLinkerClientOptions"), "client SDK docs must demonstrate ComputerLinker type imports");
assert(clientSdkDocs.includes("WorkspaceLinkerClient") && clientSdkDocs.includes("compatibility aliases"), "client SDK docs must explain WorkspaceLinker compatibility aliases");
assert(clientSdkDocs.includes("`recommendedWorkspace`, `discovery`"), "client SDK docs must mention connectReadiness discovery output");
assert(clientSdkDocs.includes("client.computer.file.read"), "client SDK docs must demonstrate computer-operation-first helpers");
assert(clientSdkDocs.includes("Compatibility helpers remain available"), "client SDK docs must separate legacy helper examples from primary helpers");
assert(!clientSdkDocs.includes("Common helpers are wrappers around the same envelope"), "client SDK docs must not claim legacy helpers are computer_operation wrappers");

const clientSource = readText("src/client.ts");
for (const exportedType of [
  "ComputerLinkerClientOptions",
  "ComputerLinkerComputerHelpers",
  "ComputerLinkerOperationName",
  "ComputerLinkerOperationRequest",
  "ComputerLinkerMcpClientSetup",
  "ComputerLinkerDiscovery",
  "ComputerLinkerOperationRegistryFilters",
  "ComputerLinkerClientSmokeReport",
]) {
  assert(new RegExp(`export (?:interface|type) ${exportedType}\\b`).test(clientSource), `SDK source must export ${exportedType}`);
}
assert(clientSource.includes("readonly computer: ComputerLinkerComputerHelpers"), "SDK source must expose the namespaced computer helper surface");
assert(clientSource.includes("@deprecated Prefer computer.file.read()."), "SDK source must mark legacy file helpers as deprecated compatibility methods");
assert(clientSource.includes("@deprecated Prefer computer.command.run()."), "SDK source must mark legacy command helpers as deprecated compatibility methods");

const discoveryContractSource = readText("src/discovery-contract.ts");
assert(discoveryContractSource.includes("computerLinkerDiscovery"), "discovery contract source must expose a shared discovery builder");
assert(discoveryContractSource.includes("primaryJsonApiActions"), "discovery contract source must define primary JSON API actions");
assert(discoveryContractSource.includes("compatibilityJsonApiActions"), "discovery contract source must define compatibility JSON API actions");

const sdkPackageSmokeScript = readText("scripts/package-smoke.mjs");
for (const exportedType of [
  "ComputerLinkerClientOptions",
  "ComputerLinkerComputerHelpers",
  "ComputerLinkerOperationName",
  "ComputerLinkerOperationRequest",
  "ComputerLinkerMcpClientSetup",
  "ComputerLinkerDiscovery",
  "WorkspaceLinkerClientOptions",
]) {
  assert(sdkPackageSmokeScript.includes(exportedType), `package smoke must validate ${exportedType}`);
}

const productSpec = readText("docs/product-spec.md");
assert(productSpec.includes("focused on first-run `here`,\nexplicit-path start, tunnel selection, client setup, status, and quickstart\npreview"), "product spec must match the concise default help contract");
assert(productSpec.includes("installed CLI check using a temporary config and workspace"), "product spec must describe check as the installed CLI smoke command");
assert(productSpec.includes("Self-test, smoke, repair, service/config/API, history, and\ncompatibility commands remain available through advanced or focused help topics"), "product spec must keep detailed management commands out of first-run help");
assert(!productSpec.includes("install self-test, status, repair, tunnel, and history flow"), "product spec must not require self-test/repair/history in default help");

const gettingStarted = readText("docs/getting-started.md");
assert(gettingStarted.includes("computer-linker here"), "getting started tutorial must lead with the current-folder startup shortcut");
assert(gettingStarted.includes("computer-linker start C:\\Projects\\my-app"), "getting started tutorial must document explicit-path startup");
assert(gettingStarted.includes("computer-linker client setup --show-token"), "getting started tutorial must document trusted local token reveal");
assert(gettingStarted.includes("get_computer_info") && gettingStarted.includes("computer_operation"), "getting started tutorial must explain the primary MCP tools");

const cliReference = readText("docs/cli-reference.md");
assert(cliReference.includes("computer-linker here") && cliReference.includes("computer-linker start C:\\Projects\\my-app"), "CLI reference must show current-folder and explicit-folder startup");
assert(cliReference.includes("--tunnel openai") && cliReference.includes("--tunnel tailscale") && cliReference.includes("--tunnel cloudflare"), "CLI reference must show supported tunnel shortcuts");
assert(cliReference.includes("computer-linker client setup --show-token"), "CLI reference must document trusted token reveal");

const agentPlaybook = readText("docs/agent-playbook.md");
assert(agentPlaybook.includes("First call get_computer_info") && agentPlaybook.includes("computer_operation"), "agent playbook must teach the primary MCP flow");
assert(agentPlaybook.includes('"op": "file.search"') && agentPlaybook.includes('"op": "package.run"'), "agent playbook must include read/search and verification operation recipes");
assert(agentPlaybook.includes("Do not treat `network:false` as network isolation"), "agent playbook must warn about networkAccess semantics");

const sdkQuickstart = readText("docs/sdk-quickstart.md");
assert(sdkQuickstart.includes("new ComputerLinkerClient") && sdkQuickstart.includes("client.computer.file.search"), "SDK quickstart must demonstrate the new SDK helper surface");
assert(sdkQuickstart.includes("Passing `http://127.0.0.1:3939/mcp` fails intentionally"), "SDK quickstart must clarify MCP URL vs JSON API URL");

const chatGptSetupDocs = readText("docs/chatgpt-setup.md");
assert(!/four-tool|four tool|4-tool/i.test(chatGptSetupDocs), "ChatGPT setup docs must not describe the default MCP surface as four-tool");
for (const tool of ["get_computer_info", "computer_operation", "get_operation_history"]) {
  assert(chatGptSetupDocs.includes(tool), `ChatGPT setup docs must mention default MCP tool ${tool}`);
}

assert(architecture.includes("Implementation Module Map"), "architecture docs must include the implementation module map");
assert(architecture.includes("Daily setup entrypoints are `computer-linker here`"), "architecture docs must document the here/start CLI boundary");
assert(architecture.includes("Operation contract and dispatch"), "architecture docs must describe operation contract module boundaries");
assert(architecture.includes("pushes to `main` and pull\nrequests targeting `main`"), "architecture docs must document the bounded automatic CI gate");

const releaseChecklist = readText("docs/release-checklist.md");
assert(releaseChecklist.includes("public:mirror -- --remote <github-owner>/<public-repo>"), "release checklist public mirror command must use the one-command --remote path");
assert(releaseChecklist.includes("npm run public:release-ready"), "release checklist must document the final public release readiness command");
assert(releaseChecklist.includes("npm run release:publish -- --create-tag --push --otp <code>"), "release checklist must document the local npm release publish wrapper");
assert(releaseChecklist.includes("npm run release -- --otp <code>"), "release checklist must document the one-command npm release path");
assert(releaseChecklist.includes("current shell has not inherited it"), "release checklist must document Windows user-level NODE_AUTH_TOKEN release hydration");
assert(releaseChecklist.includes("npm access-token scanning"), "release checklist must document npm token scanning");
assert(releaseChecklist.includes("third-party provenance marker scanning"), "release checklist must document third-party provenance marker scanning");
assert(releaseChecklist.includes("retired product-name marker scanning"), "release checklist must document retired product-name marker scanning");
assert(releaseChecklist.includes("release:verify"), "release checklist must document the local npm release verification wrapper");
assert(releaseChecklist.includes("push -u origin main --follow-tags"), "release checklist public mirror push command must include the release tag");
assert(releaseChecklist.includes("The default output directory is `../computer-linker-public`; pass"), "release checklist must document --output as an advanced override");
assert(releaseChecklist.includes("public:snapshot` replaces it automatically"), "release checklist must document automatic replacement of clean generated default snapshots");
assert(releaseChecklist.includes("a `v<package.version>` tag pointing at that commit"), "release checklist must document public mirror release tag creation");
assert(releaseChecklist.includes("matching changelog heading to"), "release checklist must document publishable mirror changelog dating");
assert(releaseChecklist.includes("automatic Windows/Node 22 CI"), "release checklist must document automatic bounded CI");
assert(!releaseChecklist.includes("git remote add origin <public-repo-url>"), "release checklist must not recommend adding the public snapshot remote after metadata rewriting has already been skipped");

const serviceMode = readText("docs/service-mode.md");
assert(serviceMode.includes("Installed Service Smoke Checklist"), "service mode docs must include installed service smoke checklist");

const securityPolicy = readText("SECURITY.md");
assert(securityPolicy.includes("A local-looking `Host` header alone is not trusted"), "security policy must document public MCP-only host-header trust boundaries");
assert(securityPolicy.includes("Direct owner-token authentication uses timing-safe comparison"), "security policy must document owner-token auth hardening");

const httpAuthSource = readText("src/http-auth.ts");
assert(httpAuthSource.includes("timingSafeEqual"), "HTTP auth must use timing-safe owner-token comparison");
assert(httpAuthSource.includes("AUTH_FAILURE_THROTTLE_AFTER"), "HTTP auth must keep bounded repeated-failure throttling");
assert(!httpAuthSource.includes("=== ownerToken"), "HTTP auth must not compare provided owner tokens with plain string equality");

assert(schemaJson.title === "Computer Linker computer_operation v1", "computer_operation schema title changed unexpectedly");
assert(schemaJson.$defs?.ComputerOperationRequest, "computer_operation schema must define ComputerOperationRequest");
assert(schemaJson.$defs?.ComputerOperationSuccess, "computer_operation schema must define ComputerOperationSuccess");
assert(schemaJson.$defs?.ComputerOperationFailure, "computer_operation schema must define ComputerOperationFailure");

const ciWorkflow = readText(".github/workflows/ci.yml");
assertBoundedCiActionsWorkflow(ciWorkflow, "CI");
assert(ciWorkflow.includes("npm run product:check"), "CI workflow must run npm run product:check");

const releaseWorkflow = readText(".github/workflows/release.yml");
assertManualReleaseActionsWorkflow(releaseWorkflow, "release");
assert(releaseWorkflow.includes("fetch-depth: 0"), "release workflow must fetch full history for public audit history checks");
assert(releaseWorkflow.includes("node scripts/release-validate.mjs --require-dated-changelog --require-release-tag"), "release workflow must require dated changelog and matching release tag");
assert(releaseWorkflow.includes("npm run public:repo-ready"), "release workflow must run npm run public:repo-ready before packaging");
assert(releaseWorkflow.includes("actions/upload-artifact@v4"), "release workflow must upload the packaged artifact");

const publicSnapshotScript = readText("scripts/create-public-snapshot.mjs");
assert(!publicSnapshotScript.includes('shell: process.platform === "win32"'), "public snapshot script must avoid shell: true when invoking npm on Windows");
assert(publicSnapshotScript.includes('runNpm(["run", "public:check"])'), "public snapshot creation must run npm run public:check before copying HEAD");
assert(publicSnapshotScript.includes("rewriteSnapshotPackageLinks(outputDir, remote)"), "public snapshot creation must rewrite package links when --remote points at GitHub");
assert(publicSnapshotScript.includes("rewriteSnapshotGitHubReferences"), "public snapshot creation must rewrite public-facing GitHub links when --remote points at GitHub");
assert(publicSnapshotScript.includes("--skip-audit"), "public snapshot script must keep --skip-audit for focused tests and emergency local checks");
assert(publicSnapshotScript.includes("--include-source-ref"), "public snapshot script must keep source commit references opt-in");
assert(publicSnapshotScript.includes('"Initial public snapshot"'), "public snapshot default commit message must omit private source commit references");
assert(publicSnapshotScript.includes("HEAD:package.json"), "public snapshot release tag must use the committed package version");
assert(publicSnapshotScript.includes("HEAD:CHANGELOG.md"), "public snapshot release tag gate must use the committed changelog");
assert(publicSnapshotScript.includes("blocked for real run"), "public snapshot remote dry-run must warn when changelog would block the real run");
assert(publicSnapshotScript.includes('runGit(["tag", releaseTag], outputDir)'), "public snapshot creation must create the package release tag");
assert(publicSnapshotScript.includes("snapshot release tag"), "public snapshot verification must ensure the release tag points at HEAD");
assert(publicSnapshotScript.includes(":(exclude)scripts/alpha-evidence.mjs"), "public snapshot history verification must exclude the alpha evidence secret scanner source");
assert(publicSnapshotScript.includes("normalizeRemote"), "public snapshot creation must normalize GitHub owner/repo remote shorthand");
assert(publicSnapshotScript.includes("isReplaceableGeneratedSnapshotOutput"), "public snapshot creation must safely auto-replace clean generated default mirrors");
assert(publicSnapshotScript.includes("existing output: replaced clean generated default snapshot"), "public snapshot output must report automatic default mirror replacement");
assert(publicSnapshotScript.includes("package links: unchanged because --remote was not provided"), "public snapshot output must warn when package links are not rewritten");
assert(publicSnapshotScript.includes("push -u origin ${branch} --follow-tags"), "public snapshot output must push the generated release tag");
assert(publicSnapshotScript.includes("publishable mirror: rerun with --remote <github-owner>/<public-repo>"), "public snapshot output must guide publishable mirrors to use --remote");
assert(publicSnapshotScript.includes("do not push this verification-only mirror"), "public snapshot output must prevent publishing verification-only mirrors");
const publicMirrorScript = readText("scripts/create-public-mirror.mjs");
assert(publicMirrorScript.includes("scripts/alpha-readiness-report.mjs"), "public mirror script must run readiness before creating a mirror");
assert(publicMirrorScript.includes("--accept-public-snapshot"), "public mirror script must accept preserved private history only for the mirror release path");
assert(publicMirrorScript.includes("scripts/create-public-snapshot.mjs"), "public mirror script must delegate mirror creation to the public snapshot script");
assert(publicMirrorScript.includes("--skip-audit"), "public mirror script must avoid rerunning the full public gate after readiness passes");
assert(publicMirrorScript.includes("HEAD changed while running readiness checks"), "public mirror script must refuse publishing a different HEAD than the one it checked");
assert(publicMirrorScript.includes("publishable public mirrors require --remote"), "public mirror script must require --remote for the product path");
assert(publicMirrorScript.includes('"--skip-audit"') && publicMirrorScript.includes("is intentionally not exposed"), "public mirror script must keep skip-audit out of the public product path");
assert(publicMirrorScript.includes("release tag precheck"), "public mirror script must report the publishable release tag/changelog precheck before long gates");
assert(publicMirrorScript.includes("HEAD:CHANGELOG.md"), "public mirror release tag precheck must use the committed changelog");
assert(publicMirrorScript.indexOf("precheckPublishableReleaseTag") < publicMirrorScript.indexOf('runNodeScript("scripts/alpha-readiness-report.mjs"'), "public mirror release tag precheck must run before readiness gates");
assert(!publicReleaseAuditScript.includes('shell: process.platform === "win32"'), "public audit must avoid shell: true when invoking npm on Windows");
assert(publicReleaseAuditScript.includes(":(exclude)scripts/alpha-evidence.mjs"), "public audit history scan must exclude the alpha evidence secret scanner source");
assert(publicReleaseAuditScript.includes("local dogfooding evidence and must not be tracked"), "public audit must block tracked local alpha evidence files");
assert(publicReleaseAuditScript.includes("Do not change this existing repository to public visibility with preserved history"), "strict public audit failure must tell users not to publish private dogfooding history");
assert(publicReleaseAuditScript.includes("npm run public:mirror -- --remote <github-owner>/<public-repo>"), "strict public audit failure must print the one-command public mirror command");

const alphaReadinessScript = readText("scripts/alpha-readiness-report.mjs");
assert(alphaReadinessScript.includes("product:check"), "alpha readiness must run npm run product:check by default");
assert(alphaReadinessScript.includes("public:audit"), "alpha readiness must run npm run public:audit by default");
assert(alphaReadinessScript.includes("preserved-history-audit"), "alpha readiness must report whether preserved Git history is safe for direct public visibility");
assert(alphaReadinessScript.includes("public:snapshot"), "alpha readiness must dry-run public snapshot creation by default");
assert(alphaReadinessScript.includes("--skip-gates"), "alpha readiness must keep --skip-gates for report-only local checks");
assert(alphaReadinessScript.includes("--accept-public-snapshot"), "alpha readiness must support accepting the public snapshot release path");
assert(alphaReadinessScript.includes("--require-evidence"), "alpha readiness must support requiring external alpha evidence");
assert(alphaReadinessScript.includes("--require-dated-changelog"), "alpha readiness must support release changelog enforcement");
assert(alphaReadinessScript.includes("scripts/alpha-evidence.mjs"), "alpha readiness must validate external alpha evidence when requested");
assert(alphaReadinessScript.includes("function runEvidencePreflight"), "alpha readiness must run evidence preflight when required evidence is missing");
assert(alphaReadinessScript.includes("evidencePreflight"), "alpha readiness must expose structured evidence preflight diagnostics");
assert(alphaReadinessScript.includes("alpha:evidence -- preflight"), "alpha readiness guidance must mention the preflight evidence flow");
assert(alphaReadinessScript.includes("recordCommand"), "alpha readiness guidance must mention the preflight recordCommand handoff");
assert(alphaReadinessScript.includes("alpha:evidence -- smoke"), "alpha readiness guidance must mention the one-command evidence smoke flow");
assert(alphaReadinessScript.includes("create a detached public mirror with `npm run public:mirror -- --remote <github-owner>/<public-repo>`"), "alpha readiness preserved-history warning must print the one-command public mirror command");
assert(!alphaReadinessScript.includes('alpha:evidence -- smoke \\"...\\" --client \\"ChatGPT web\\" --exposure openai --tunnel-or-url tunnel_...'), "alpha readiness guidance must not regress to the long manual evidence smoke command");
const alphaReadinessTestScript = readText("scripts/alpha-readiness-report.test.mjs");
assert(alphaReadinessTestScript.includes("tunnel_preflight123"), "alpha readiness tests must cover preflight diagnostics when evidence is missing");
assert(alphaReadinessTestScript.includes("evidencePreflight"), "alpha readiness tests must cover structured evidence preflight diagnostics");
assert(alphaReadinessTestScript.includes("alpha:evidence -- preflight"), "alpha readiness tests must cover missing-evidence preflight guidance");
assert(alphaReadinessTestScript.includes("recordCommand"), "alpha readiness tests must cover missing-evidence recordCommand guidance");
assert(alphaReadinessTestScript.includes("alpha:evidence -- smoke"), "alpha readiness tests must cover missing-evidence smoke guidance");
assert(alphaReadinessTestScript.includes("create a detached public mirror with `npm run public:mirror -- --remote <github-owner>/<public-repo>`"), "alpha readiness tests must cover the preserved-history public mirror command");
assert(alphaReadinessTestScript.includes("--skip-gates"), "alpha readiness tests must avoid running the expensive product gate");

const alphaEvidenceScript = readText("scripts/alpha-evidence.mjs");
assert(alphaEvidenceScript.includes("computer-linker-alpha-evidence"), "alpha evidence script must validate the evidence kind");
assert(alphaEvidenceScript.includes("external-mcp-tool-flow"), "alpha evidence must require external MCP tool flow proof");
assert(alphaEvidenceScript.includes("tunnel-transport"), "alpha evidence must require tunnel transport proof");
assert(alphaEvidenceScript.includes("mcp-only-public-surface"), "alpha evidence must require MCP-only public surface proof");
assert(alphaEvidenceScript.includes("operation-history-reviewed"), "alpha evidence must require history review proof");
assert(alphaEvidenceScript.includes("client-instructions-usable"), "alpha evidence must require agent instruction proof");
assert(alphaEvidenceScript.includes("redactionConfirmed"), "alpha evidence must require redaction confirmation");
assert(alphaEvidenceScript.includes("findSecretLikeValues"), "alpha evidence must scan for common secret-shaped values");
assert(alphaEvidenceScript.includes("--client"), "alpha evidence init must accept an external client name");
assert(alphaEvidenceScript.includes('DEFAULT_EXTERNAL_CLIENT_NAME = "External MCP client"'), "alpha evidence default client label must stay generic");
assert(!alphaEvidenceScript.includes('options.client ?? "ChatGPT web"'), "alpha evidence must not default release evidence to ChatGPT web");
assert(alphaEvidenceScript.includes("--exposure"), "alpha evidence init must accept an exposure provider");
assert(alphaEvidenceScript.includes("--tunnel-or-url"), "alpha evidence init must accept the tested tunnel id or public URL");
assert(alphaEvidenceScript.includes("--scope"), "alpha evidence init must accept the tested workspace scope");
assert(alphaEvidenceScript.includes("target-tunnel-or-url"), "alpha evidence must validate the tested tunnel id or public URL");
assert(alphaEvidenceScript.includes("target-mcp-path"), "alpha evidence must validate the tested MCP path");
assert(alphaEvidenceScript.includes("target-scope"), "alpha evidence must validate the tested workspace scope");
assert(alphaEvidenceScript.includes("recordEvidence"), "alpha evidence must support recording individual evidence checks without manual JSON editing");
assert(alphaEvidenceScript.includes("smokeEvidence"), "alpha evidence must support one-command evidence creation and smoke recording");
assert(alphaEvidenceScript.includes("recordSmokeEvidence"), "alpha evidence must support one-command external smoke evidence recording");
assert(alphaEvidenceScript.includes("preflightEvidence"), "alpha evidence must support history/tunnel preflight before evidence recording");
assert(alphaEvidenceScript.includes("externalClientPrompt"), "alpha evidence preflight must print a pasteable external-client smoke prompt");
assert(alphaEvidenceScript.includes("nextExternalClientPrompt"), "alpha evidence preflight must print a focused prompt for missing external-client calls");
assert(alphaEvidenceScript.includes("--redaction-confirmed"), "alpha evidence record flow must support redaction confirmation");
assert(alphaEvidenceScript.includes("init target details contain common secret-shaped values"), "alpha evidence init must reject secret-shaped target details before writing evidence");
assert(alphaEvidenceScript.includes('validateRecordNote(options.note, "record evidence note")'), "alpha evidence record must validate notes before writing evidence");
assert(alphaEvidenceScript.includes('validateRecordNote(options.note, "record-smoke evidence note")'), "alpha evidence record-smoke must validate notes before writing evidence");
assert(alphaEvidenceScript.includes("contains common secret-shaped values"), "alpha evidence note validation must reject secret-shaped notes before writing evidence");
assert(alphaEvidenceScript.includes("refreshExistingEvidence"), "alpha evidence smoke must support refreshing existing Computer Linker alpha evidence");
assert(alphaEvidenceScript.includes("isAlphaEvidenceFile"), "alpha evidence smoke refresh must verify the existing file is Computer Linker alpha evidence");
const alphaEvidenceTestScript = readText("scripts/alpha-evidence.test.mjs");
assert(alphaEvidenceTestScript.includes("tunnel_testalpha123"), "alpha evidence tests must cover a concrete OpenAI tunnel id");
assert(alphaEvidenceTestScript.includes("https://mcp.example.test"), "alpha evidence tests must cover a public HTTPS origin");
assert(alphaEvidenceTestScript.includes("placeholderJson.status"), "alpha evidence tests must cover placeholder target rejection");
assert(alphaEvidenceTestScript.includes("badUrlJson.status"), "alpha evidence tests must cover invalid public URL rejection");
assert(alphaEvidenceTestScript.includes('"smoke"'), "alpha evidence tests must cover the one-command smoke command");
assert(alphaEvidenceTestScript.includes("oneCommandRefresh"), "alpha evidence tests must cover one-command smoke refresh");
assert(alphaEvidenceTestScript.includes("nonEvidenceNoOverwrite"), "alpha evidence tests must cover unrelated file overwrite protection");
assert(alphaEvidenceTestScript.includes('"preflight"'), "alpha evidence tests must cover the preflight command");
assert(alphaEvidenceTestScript.includes("preflightConfigDir"), "alpha evidence tests must cover preflight config/audit/tunnel fixtures");
assert(alphaEvidenceTestScript.includes("externalClientPrompt"), "alpha evidence tests must cover the preflight external-client prompt");
assert(alphaEvidenceTestScript.includes("nextExternalClientPrompt"), "alpha evidence tests must cover the focused missing-call prompt");
assert(alphaEvidenceTestScript.includes('"record"'), "alpha evidence tests must cover the record command");
assert(alphaEvidenceTestScript.includes('"record-smoke"'), "alpha evidence tests must cover the record-smoke command");
assert(alphaEvidenceTestScript.includes("redactionConfirmed"), "alpha evidence tests must cover record redaction confirmation");
assert(alphaEvidenceTestScript.includes("Authorization: Bearer abcdefghijklmnop"), "alpha evidence tests must cover pre-write secret rejection");

const packageSmokeScript = readText("scripts/package-smoke.mjs");
assert(!packageSmokeScript.includes('shell: process.platform === "win32"'), "package smoke must avoid shell: true when invoking npm on Windows");
assert(packageSmokeScript.includes('"install", "--ignore-scripts", "--no-audit", "--no-fund"'), "package smoke must install the packed archive into a temporary consumer project");
assert(packageSmokeScript.includes('"exec", "--", binName'), "package smoke must execute the installed computer-linker bin");
assert(packageSmokeScript.includes("CLI --version must match package.json"), "package smoke must verify CLI --version");
assert(packageSmokeScript.includes("bare CLI invocation must print help"), "package smoke must verify bare CLI invocation prints help");
assert(packageSmokeScript.includes('"source quickstart"'), "package smoke must verify source checkout quickstart");
assert(packageSmokeScript.includes('"source absolute quickstart"'), "package smoke must verify absolute-path source checkout quickstart");
assert(packageSmokeScript.includes("source quickstart must expose commands.check"), "package smoke must verify source quickstart exposes commands.check");
assert(packageSmokeScript.includes("source quickstart must preserve selfTest as a compatibility alias"), "package smoke must verify source quickstart preserves the selfTest compatibility alias");
assert(packageSmokeScript.includes("source quickstart must explain that start keeps running"), "package smoke must verify quickstart terminal handoff guidance");
assert(packageSmokeScript.includes("source init must use the checkout node runner in token guidance"), "package smoke must verify source init token guidance");
assert(packageSmokeScript.includes('"source OpenAI quickstart"'), "package smoke must verify OpenAI quickstart prerequisite guidance");
assert(packageSmokeScript.includes("source OpenAI quickstart must surface the API key prerequisite"), "package smoke must verify OpenAI quickstart surfaces the API key prerequisite");
assert(packageSmokeScript.includes('"quickstart", installedWorkspaceDir, "--json"'), "package smoke must verify installed quickstart");
assert(packageSmokeScript.includes("installed quickstart must use the published CLI command"), "package smoke must verify installed quickstart command prefix");
assert(packageSmokeScript.includes("installed quickstart must expose the check command"), "package smoke must verify installed quickstart exposes commands.check");
assert(packageSmokeScript.includes("installed quickstart must preserve selfTest as a compatibility alias"), "package smoke must verify installed quickstart preserves the selfTest compatibility alias");
assert(packageSmokeScript.includes("installed quickstart must explain that follow-up commands run in another terminal"), "package smoke must verify installed quickstart terminal handoff guidance");
assert(packageSmokeScript.includes("default CLI help must include generic MCP client setup"), "package smoke must verify default help exposes generic client setup");
assert(packageSmokeScript.includes("default CLI help must expose the current-folder shortcut"), "package smoke must verify default help exposes the current-folder shortcut");
assert(packageSmokeScript.includes("default CLI help must expose the productized install check"), "package smoke must verify default help exposes the productized install check");
assert(packageSmokeScript.includes("default CLI help must collapse tunnel providers into one first-run command"), "package smoke must verify default help keeps tunnel setup concise");
assert(packageSmokeScript.includes("default CLI help must include the quickstart preview without exposing the full option matrix"), "package smoke must verify default help exposes quickstart as a preview");
assert(packageSmokeScript.includes("default CLI help must keep install self-test in advanced help"), "package smoke must verify default help hides install self-test");
assert(packageSmokeScript.includes("default CLI help must keep client smoke in advanced help"), "package smoke must verify default help hides client smoke");
assert(packageSmokeScript.includes("default CLI help must keep repair commands in focused help"), "package smoke must verify default help hides repair commands");
assert(packageSmokeScript.includes("advanced help must point ChatGPT users to the dedicated compatibility help"), "package smoke must verify advanced help routes ChatGPT helpers behind a dedicated topic");
assert(packageSmokeScript.includes("advanced help must not foreground ChatGPT-specific helpers"), "package smoke must verify advanced help stays generic");
assert(packageSmokeScript.includes("profile help must not advertise ChatGPT-specific shortcuts"), "package smoke must verify profile help stays generic");
assert(packageSmokeScript.includes("ChatGPT help must frame ChatGPT as a compatibility client"), "package smoke must verify ChatGPT help keeps client positioning clear");
assert(packageSmokeScript.includes("dist/client-smoke.js"), "package smoke must verify the shared client smoke runtime is packed");
assert(packageSmokeScript.includes('"check", "--json"'), "package smoke must run the productized installed check");
assert(packageSmokeScript.includes("installed check did not verify MCP tools/list"), "package smoke must verify installed check covers MCP tools/list");
assert(packageSmokeScript.includes('"self-test", "--help"'), "package smoke must verify self-test remains as a compatibility help topic");
assert(packageSmokeScript.includes('"setup", installedWorkspaceDir, "--id", "app", "--write", "--json"'), "package smoke must verify installed setup can create an isolated workspace");
assert(packageSmokeScript.includes('"status", "--json"'), "package smoke must verify installed status can read the isolated config");
assert(packageSmokeScript.includes('"client", "setup", "--json"'), "package smoke must verify installed client setup can report generic MCP client guidance");
assert(packageSmokeScript.includes('"client", "setup", "--show-token", "--json"'), "package smoke must verify installed client setup can reveal the bearer token only when explicitly requested");
assert(packageSmokeScript.includes('"diagnose", "client", "--url", "not a url", "--json"'), "package smoke must verify installed client diagnosis can report structured failures");
assert(packageSmokeScript.includes("installed client setup must include generic computer_operation agent guidance"), "package smoke must verify installed client setup includes generic agent instructions");
assert(packageSmokeScript.includes("installed client setup first prompt must point agents at computerOperationRegistry"), "package smoke must verify installed client setup first prompt points at the operation registry");
assert(packageSmokeScript.includes("installed SDK entrypoint"), "package smoke must import the installed SDK entrypoint");
assert(packageSmokeScript.includes("generic client smoke helper"), "package smoke must verify the SDK generic client smoke helper");

const chatGptSource = readText("src/chatgpt.ts");
assert(chatGptSource.includes("runWorkspaceLinkerMcpClientSmoke"), "ChatGPT smoke must wrap the generic client smoke core");
assert(!chatGptSource.includes("async function smokeMcpInitialize"), "ChatGPT smoke must not keep a separate MCP initialize implementation");
assert(!chatGptSource.includes("async function fetchWithTimeout"), "ChatGPT smoke must not keep a separate smoke timeout implementation");

const clientSmokeSource = readText("src/client-smoke.ts");
assert(clientSmokeSource.includes('"api-computer-info"'), "client smoke must include get_computer_info check coverage");
assert(clientSmokeSource.includes('"api-read-only-operation"'), "client smoke must include read-only computer_operation check coverage");
assert(clientSmokeSource.includes('"mcp-list-tools"'), "client smoke must include MCP tools/list check coverage");
assert(clientSmokeSource.includes('"mcp-get-computer-info"'), "client smoke must call get_computer_info through MCP");
assert(clientSmokeSource.includes('"mcp-read-only-operation"'), "client smoke must call computer_operation through MCP");
assert(clientSmokeSource.includes('action: "get_computer_info"'), "client smoke must call get_computer_info through /api/v1/control");
assert(clientSmokeSource.includes('action: "computer_operation"'), "client smoke must call computer_operation through /api/v1/control");
assert(clientSmokeSource.includes('op: "file.list"'), "client smoke must verify a read-only file.list computer_operation");
assert(clientSmokeSource.includes("client.listTools()"), "client smoke must use a real MCP SDK tools/list request");
assert(clientSmokeSource.includes('client.callTool({ name: "get_computer_info"'), "client smoke must use a real MCP SDK get_computer_info call");
assert(clientSmokeSource.includes("localHttpSmoke"), "generic MCP client smoke must keep JSON API checks limited to local HTTP smoke");
const computerContractSource = readText("src/computer-contract.ts");
assert(computerContractSource.includes("agentInstructions: genericAgentInstructions"), "client setup must expose copy-pasteable generic agent instructions");
assert(computerContractSource.includes("Do not call workspace_operation, read, ls, grep, glob, or create_file"), "generic agent instructions must keep compatibility tools opt-in");
const capabilityPolicySource = readText("src/capability-policy.ts");
assert(capabilityPolicySource.includes("networkAccess: operationNetworkAccessPolicy"), "operation capability policy must expose machine-readable networkAccess semantics");
assert(capabilityPolicySource.includes("networkBlockedByComputerLinker: false"), "networkAccess must avoid implying Computer Linker blocks host network access");
assert(capabilityPolicySource.includes("network:false is a legacy non-grant marker"), "capability policy notes must clarify network:false semantics");
const cliSource = readText("src/cli.ts");
assert(cliSource.includes("agent instructions:"), "client setup text output must print copy-pasteable agent instructions");
assert(!cliSource.includes('case "connect-profile"'), "CLI must not keep connect-profile as a top-level ChatGPT shortcut");
assert(!cliSource.includes('case "chatgpt"'), "CLI must not keep chatgpt as a top-level command");
assert(!cliSource.includes("computer-linker profile --chatgpt ["), "profile help must not advertise ChatGPT-specific shortcuts");

const mcpSurfaceSource = readText("src/mcp-surface.ts");
assert(mcpSurfaceSource.includes('export type McpToolSurface = "generic" | "compatibility"'), "MCP tool surface must keep explicit generic/compatibility modes");
assert(mcpSurfaceSource.includes('"get_computer_info"'), "generic MCP surface must expose get_computer_info");
assert(mcpSurfaceSource.includes('"computer_operation"'), "generic MCP surface must expose computer_operation");
assert(mcpSurfaceSource.includes('"get_operation_history"'), "generic MCP surface must expose get_operation_history");
assert(mcpSurfaceSource.includes("COMPUTER_LINKER_MCP_TOOL_SURFACE"), "MCP compatibility surface must stay opt-in through COMPUTER_LINKER_MCP_TOOL_SURFACE");
const serverSource = readText("src/server.ts");
assert(serverSource.includes('if (surface === "compatibility")'), "compatibility MCP tools must be hidden behind the compatibility surface");
assert(serverSource.includes("Compatibility workspace tools are hidden by default"), "MCP server instructions must explain that compatibility tools are hidden by default");
const computerOperationRegistrySource = readText("src/computer-operation-registry.ts");
for (const op of ["code.context", "code.search_symbols", "git.diff", "package.run", "process.start", "codex.stop"]) {
  assert(computerOperationRegistrySource.includes(`"${op}"`), `computer_operation registry must expose ${op}`);
}
assert(computerOperationRegistrySource.includes("networkAccess: backend.networkAccess"), "computer_operation registry must forward networkAccess semantics");

if (tagBuild || args.has("--require-release-tag")) {
  const expectedTag = `v${packageJson.version}`;
  assert(process.env.GITHUB_REF_NAME === expectedTag, `release tag must be ${expectedTag}, got ${process.env.GITHUB_REF_NAME ?? "unset"}`);
}

console.log(`release validation ok: ${packageJson.name}@${packageJson.version}`);
