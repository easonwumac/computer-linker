#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const tsxCliPath = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

function tsx(label, path) {
  return { label, path, command: process.execPath, args: [tsxCliPath, path] };
}

function node(label, path) {
  return { label, path, command: process.execPath, args: [path] };
}

const tests = [
  tsx("permissions", "src/permissions.test.ts"),
  tsx("command policy", "src/command-policy.test.ts"),
  tsx("config", "src/config.test.ts"),
  tsx("platform shell", "src/platform-shell.test.ts"),
  tsx("search", "src/search.test.ts"),
  tsx("workspace operations", "src/workspace-operations.test.ts"),
  tsx("oauth provider", "src/oauth-provider.test.ts"),
  tsx("audit", "src/audit.test.ts"),
  tsx("tunnels", "src/tunnels.test.ts"),
  tsx("sessions", "src/sessions.test.ts"),
  tsx("security", "src/security.test.ts"),
  tsx("computer contract", "src/computer-contract.test.ts"),
  tsx("api", "src/api.test.ts"),
  tsx("process cli", "src/process-cli.test.ts"),
  tsx("public mcp only", "src/public-mcp-only.test.ts"),
  tsx("public snapshot", "src/public-snapshot.test.ts"),
  tsx("screenshot", "src/screenshot.test.ts"),
  tsx("client", "src/client.test.ts"),
  tsx("chatgpt", "src/chatgpt.test.ts"),
  tsx("chatgpt smoke", "src/chatgpt-smoke.test.ts"),
  tsx("server process cleanup", "src/server-process-cleanup.test.ts"),
  tsx("mcp", "src/mcp.test.ts"),
  tsx("cli", "src/cli.test.ts"),
  node("alpha evidence", "scripts/alpha-evidence.test.mjs"),
  node("alpha readiness report", "scripts/alpha-readiness-report.test.mjs"),
];

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Usage: node scripts/run-tests.mjs [--list] [filter...]",
    "",
    "Runs the Computer Linker test suite with per-file progress output.",
    "When filters are provided, exact label/path matches are preferred.",
    "If there is no exact match, a test runs if its label or path contains any filter.",
  ].join("\n"));
  process.exit(0);
}

if (args.includes("--list")) {
  for (const test of tests) {
    console.log(`${test.label}: ${test.path}`);
  }
  process.exit(0);
}

const unknownOptions = args.filter((arg) => arg.startsWith("-"));
if (unknownOptions.length > 0) {
  fail(`unknown option: ${unknownOptions[0]}`);
}

const filters = args.map((arg) => arg.toLowerCase());
const exactMatches = filters.length === 0 ? [] : tests.filter((test) => filters.some((filter) => exactTestMatch(test, filter)));
const selected = filters.length === 0
  ? tests
  : exactMatches.length > 0
    ? exactMatches
    : tests.filter((test) => filters.some((filter) => `${test.label} ${test.path}`.toLowerCase().includes(filter)));

if (selected.length === 0) {
  fail(`no tests matched: ${args.join(", ")}`);
}

const suiteStarted = Date.now();
console.error(`test suite: ${selected.length}/${tests.length} files`);
for (const [index, test] of selected.entries()) {
  const prefix = `[${index + 1}/${selected.length}] ${test.label}`;
  const started = Date.now();
  console.error(`${prefix}: ${test.path}`);
  const result = spawnSync(test.command, test.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${test.path} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (result.signal) {
      fail(`${test.path} terminated by ${result.signal}`);
    }
    process.exit(result.status ?? 1);
  }
  console.error(`${prefix}: ok (${formatDuration(Date.now() - started)})`);
}
console.error(`test suite ok (${formatDuration(Date.now() - suiteStarted)})`);

function fail(message) {
  console.error(`test runner failed: ${message}`);
  process.exit(1);
}

function exactTestMatch(test, filter) {
  return test.label.toLowerCase() === filter || test.path.toLowerCase() === filter;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
