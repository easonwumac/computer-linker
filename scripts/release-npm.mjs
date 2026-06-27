#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const argSet = new Set(args);

function fail(message) {
  console.error(`release failed: ${message}`);
  process.exit(1);
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function modeFromArgs() {
  const requested = ["--check", "--dry-run", "--publish"].filter((flag) => argSet.has(flag));
  if (requested.length > 1) fail(`choose only one release mode: ${requested.join(", ")}`);
  if (argSet.has("--publish")) return "publish";
  if (argSet.has("--dry-run")) return "dry-run";
  return "check";
}

function run(command, commandArgs, options = {}) {
  const display = options.display ?? `${command} ${commandArgs.join(" ")}`;
  console.log(`> ${display}`);
  try {
    return execFileSync(command, commandArgs, {
      encoding: "utf8",
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    fail(`${display} failed${stderr || stdout ? `:\n${stderr || stdout}` : ""}`);
  }
}

function capture(command, commandArgs, options = {}) {
  return run(command, commandArgs, { ...options, capture: true }).trim();
}

function maybeCapture(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function runNpm(npmArgs, options = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...npmArgs], {
      ...options,
      display: `npm ${npmArgs.join(" ")}`,
    });
  }

  if (process.platform === "win32") {
    return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...npmArgs], {
      ...options,
      display: `npm ${npmArgs.join(" ")}`,
    });
  }
  return run("npm", npmArgs, options);
}

function captureNpm(npmArgs) {
  if (process.env.npm_execpath) {
    return capture(process.execPath, [process.env.npm_execpath, ...npmArgs], {
      display: `npm ${npmArgs.join(" ")}`,
    });
  }

  if (process.platform === "win32") {
    return capture(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...npmArgs], {
      display: `npm ${npmArgs.join(" ")}`,
    });
  }
  return capture("npm", npmArgs);
}

function hydrateNpmAuthTokenFromWindowsUserEnv() {
  if (process.env.NODE_AUTH_TOKEN || process.platform !== "win32") return;
  const token = maybeCapture("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Environment]::GetEnvironmentVariable('NODE_AUTH_TOKEN','User')",
  ]);
  if (!token) return;
  process.env.NODE_AUTH_TOKEN = token;
  console.log("npm auth: loaded NODE_AUTH_TOKEN from Windows user environment for this release process");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertCleanWorktree(stage) {
  const status = capture("git", ["status", "--porcelain"]);
  if (status) fail(`worktree must be clean ${stage}:\n${status}`);
}

function currentBranch() {
  return capture("git", ["branch", "--show-current"]);
}

function commitOf(rev) {
  return maybeCapture("git", ["rev-parse", `${rev}^{commit}`]);
}

function tagExists(tag) {
  return Boolean(commitOf(`refs/tags/${tag}`));
}

function assertReleaseBranch() {
  if (argSet.has("--allow-branch")) return;
  const branch = currentBranch();
  if (branch !== "main" && branch !== "master") {
    fail(`release publish must run from main/master; current branch is ${branch || "detached"}. Pass --allow-branch only for a deliberate private release.`);
  }
}

function ensureReleaseTag(expectedTag, { mode }) {
  const head = commitOf("HEAD");
  const existing = commitOf(`refs/tags/${expectedTag}`);
  if (existing && existing !== head) {
    fail(`${expectedTag} already exists but does not point at HEAD. Bump package.json before releasing a new commit.`);
  }
  if (existing === head) return { temporary: false };

  if (mode === "dry-run") {
    run("git", ["tag", expectedTag]);
    console.log(`temporary release tag created for dry-run: ${expectedTag}`);
    return { temporary: true };
  }

  if (argSet.has("--create-tag")) {
    run("git", ["tag", expectedTag]);
    console.log(`release tag created: ${expectedTag}`);
    return { temporary: false };
  }

  fail(`HEAD is not tagged ${expectedTag}. Rerun with --create-tag, or create the tag manually after preparing the release commit.`);
}

function deleteTemporaryTag(expectedTag) {
  if (!tagExists(expectedTag)) return;
  run("git", ["tag", "-d", expectedTag]);
  console.log(`temporary release tag removed: ${expectedTag}`);
}

function publishArgs({ mode, access, otp, npmTag }) {
  const commandArgs = ["publish", "--access", access];
  if (mode === "dry-run") commandArgs.push("--dry-run");
  if (npmTag) commandArgs.push("--tag", npmTag);
  if (otp) commandArgs.push("--otp", otp);
  return commandArgs;
}

function verifyPublishedPackage({ packageJson, npmTag }) {
  const commandArgs = [
    "scripts/verify-npm-release.mjs",
    "--version",
    packageJson.version,
    "--tag",
    npmTag ?? "latest",
  ];
  run(process.execPath, commandArgs, {
    display: `node ${commandArgs.join(" ")}`,
  });
}

function printUsage() {
  console.log([
    "Usage:",
    "  npm run release -- --otp 123456",
    "  npm run release:check",
    "  npm run release:dry-run",
    "  npm run release:publish -- --create-tag --push --otp 123456",
    "  npm run release:verify",
    "",
    "Options:",
    "  --check             Run local release gates without publishing. Default mode.",
    "  --dry-run           Run npm publish --dry-run. Creates and removes a temporary local release tag when needed.",
    "  --publish           Publish to npm. Requires a clean main/master worktree and release tag.",
    "  --create-tag        Create v<package.version> on HEAD before real publish when missing.",
    "  --otp <code>        Pass an npm 2FA one-time password to npm publish.",
    "  --npm-tag <tag>     Publish with an npm dist-tag such as alpha or latest.",
    "  --access <level>    npm package access. Default: public.",
    "  --push              After successful real publish and verification, push HEAD and the release tag to origin.",
    "  --allow-branch      Allow real publish outside main/master.",
  ].join("\n"));
}

if (argSet.has("--help") || argSet.has("-h")) {
  printUsage();
  process.exit(0);
}

const mode = modeFromArgs();
const packageJson = readJson("package.json");
const expectedTag = `v${packageJson.version}`;
const access = readOption("--access") ?? "public";
const otp = readOption("--otp");
const npmTag = readOption("--npm-tag");
let temporaryTag = false;

try {
  if (mode === "check") {
    runNpm(["run", "public:check"]);
    runNpm(["pack", "--dry-run", "--json"]);
    console.log(`release check ok: ${packageJson.name}@${packageJson.version}`);
    console.log(`next one-command publish: npm run release -- --otp <code>`);
    console.log(`optional dry-run only: npm run release:dry-run`);
    process.exit(0);
  }

  assertCleanWorktree("before release");
  assertReleaseBranch();
  const tagState = ensureReleaseTag(expectedTag, { mode });
  temporaryTag = tagState.temporary;

  run(process.execPath, ["scripts/release-validate.mjs", "--require-dated-changelog"], {
    display: "node scripts/release-validate.mjs --require-dated-changelog",
  });

  hydrateNpmAuthTokenFromWindowsUserEnv();

  if (mode === "publish") {
    const user = captureNpm(["whoami"]);
    console.log(`npm auth: logged in as ${user}`);
  }

  runNpm(publishArgs({ mode, access, otp, npmTag }));
  assertCleanWorktree("after release");

  if (mode === "publish") {
    verifyPublishedPackage({ packageJson, npmTag });
    assertCleanWorktree("after registry verification");
  }

  if (mode === "publish" && argSet.has("--push")) {
    run("git", ["push", "origin", "HEAD"]);
    run("git", ["push", "origin", expectedTag]);
  }

  console.log(`${mode === "publish" ? "release publish" : "release dry-run"} ok: ${packageJson.name}@${packageJson.version}`);
} finally {
  if (temporaryTag) deleteTemporaryTag(expectedTag);
}
