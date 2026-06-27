#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const argSet = new Set(args);

function fail(message) {
  console.error(`release verification failed: ${message}`);
  process.exit(1);
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function usage() {
  console.log([
    "Usage:",
    "  npm run release:verify",
    "  node scripts/verify-npm-release.mjs --version 0.1.2 --tag latest",
    "",
    "Options:",
    "  --package <name>       Package name. Defaults to package.json name.",
    "  --version <version>    Package version. Defaults to package.json version.",
    "  --tag <tag>            npm dist-tag to verify. Default: latest.",
    "  --bin <name>           CLI bin to smoke test. Defaults to the first package.json bin.",
    "  --registry <url>       npm registry. Default: https://registry.npmjs.org/.",
    "  --timeout-ms <ms>      Maximum registry wait. Default: 180000.",
    "  --interval-ms <ms>     Retry interval. Default: 5000.",
  ].join("\n"));
}

if (argSet.has("--help") || argSet.has("-h")) {
  usage();
  process.exit(0);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

function normalizeRegistry(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`${label} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function commandErrorMessage(error) {
  const stderr = error.stderr?.toString().trim();
  const stdout = error.stdout?.toString().trim();
  const message = stderr || stdout || error.message || String(error);
  return message.split(/\r?\n/).slice(0, 8).join("\n");
}

function runNpm(npmArgs, options = {}) {
  const command = process.env.npm_execpath
    ? process.execPath
    : process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : "npm";
  const commandArgs = process.env.npm_execpath
    ? [process.env.npm_execpath, ...npmArgs]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", ...npmArgs]
      : npmArgs;

  return execFileSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function retry(label, fn, { timeoutMs, intervalMs }) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError;

  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    try {
      const result = fn();
      console.log(`${label}: ok${attempts > 1 ? ` after ${attempts} attempts` : ""}`);
      return result;
    } catch (error) {
      lastError = error;
      if (Date.now() - startedAt + intervalMs > timeoutMs) break;
      if (attempts === 1) console.log(`${label}: waiting for npm registry propagation`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  fail(`${label} did not become ready within ${timeoutMs}ms:\n${commandErrorMessage(lastError)}`);
}

function parseDistTags(output) {
  const tags = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^:\s]+):\s+(.+)$/.exec(line.trim());
    if (match) tags.set(match[1], match[2]);
  }
  return tags;
}

const packageJson = readJson("package.json");
const packageName = readOption("--package") ?? packageJson.name;
const packageVersion = readOption("--version") ?? packageJson.version;
const npmTag = readOption("--tag") ?? "latest";
const binName = readOption("--bin") ?? Object.keys(packageJson.bin ?? {})[0];
const registry = normalizeRegistry(readOption("--registry") ?? "https://registry.npmjs.org/");
const timeoutMs = Number(readOption("--timeout-ms") ?? process.env.COMPUTER_LINKER_RELEASE_VERIFY_TIMEOUT_MS ?? "180000");
const intervalMs = Number(readOption("--interval-ms") ?? "5000");
const packageSpec = `${packageName}@${packageVersion}`;

if (!packageName) fail("package name is required");
if (!packageVersion) fail("package version is required");
if (!binName) fail("package.json must define at least one bin, or pass --bin <name>");
assertPositiveInteger(timeoutMs, "--timeout-ms");
assertPositiveInteger(intervalMs, "--interval-ms");

const view = await retry("registry version metadata", () => {
  const output = runNpm([
    "--registry",
    registry,
    "view",
    packageSpec,
    "name",
    "version",
    "bin",
    "dist.tarball",
    "--json",
  ]);
  const metadata = parseJson(output, `npm view ${packageSpec}`);
  if (metadata.name !== packageName) {
    throw new Error(`expected name ${packageName}, got ${metadata.name}`);
  }
  if (metadata.version !== packageVersion) {
    throw new Error(`expected version ${packageVersion}, got ${metadata.version}`);
  }
  if (!metadata["dist.tarball"]) {
    throw new Error("published package metadata did not include dist.tarball");
  }
  if (metadata.bin?.[binName] !== packageJson.bin?.[binName]) {
    throw new Error(`published bin ${binName} did not match package.json`);
  }
  return metadata;
}, { timeoutMs, intervalMs });

await retry("registry dist-tag", () => {
  const output = runNpm(["--registry", registry, "dist-tag", "ls", packageName]);
  const tags = parseDistTags(output);
  const actual = tags.get(npmTag);
  if (actual !== packageVersion) {
    throw new Error(`expected dist-tag ${npmTag}: ${packageVersion}, got ${actual || "<missing>"}`);
  }
  return actual;
}, { timeoutMs, intervalMs });

const smokeDir = mkdtempSync(join(tmpdir(), "computer-linker-published-smoke-"));
try {
  await retry("published CLI smoke", () => {
    const output = runNpm([
      "--registry",
      registry,
      "exec",
      "--yes",
      `--package=${packageSpec}`,
      "--",
      binName,
      "--version",
    ], { cwd: smokeDir });
    const trimmed = output.trim();
    if (!trimmed.includes(packageVersion)) {
      throw new Error(`expected ${binName} --version to include ${packageVersion}, got ${trimmed || "<empty>"}`);
    }
    return trimmed;
  }, { timeoutMs, intervalMs });
} finally {
  rmSync(smokeDir, { recursive: true, force: true });
}

console.log(`release verification ok: ${packageSpec} (${npmTag}), ${view["dist.tarball"]}`);
