#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`publish guard failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      shell: options.shell ?? false,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    fail(`${command} ${args.join(" ")} failed${stderr || stdout ? `:\n${stderr || stdout}` : ""}`);
  }
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], options);
  }

  if (process.platform === "win32") {
    return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...args], options);
  }
  return run("npm", args, options);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertCleanWorktree(stage) {
  const status = run("git", ["status", "--porcelain"]).trim();
  if (status) {
    fail(`worktree must be clean ${stage} npm publish:\n${status}`);
  }
}

function assertReleaseTag(packageVersion) {
  const expectedTag = `v${packageVersion}`;
  const tags = run("git", ["tag", "--points-at", "HEAD"])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!tags.includes(expectedTag)) {
    fail(`HEAD must be tagged ${expectedTag} before npm publish`);
  }
}

const packageJson = readJson("package.json");

assertCleanWorktree("before");
assertReleaseTag(packageJson.version);

run(process.execPath, ["scripts/release-validate.mjs", "--require-dated-changelog"], {
  stdio: "inherit",
});
runNpm(["run", "public:check"], {
  stdio: "inherit",
});
runNpm(["run", "public:audit", "--", "--strict-history", "--skip-npm-audit"], {
  stdio: "inherit",
});

assertCleanWorktree("after");
console.log(`publish guard ok: ${packageJson.name}@${packageJson.version}`);
