#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const valueOptions = new Set(["--remote", "--output", "--branch"]);
const booleanOptions = new Set(["--dry-run", "--force", "--include-source-ref"]);
const blockedOptions = new Set(["--allow-dirty", "--skip-audit", "--skip-ready"]);

function fail(message) {
  console.error(`public mirror failed: ${message}`);
  process.exit(1);
}

function usage() {
  console.log([
    "Usage: npm run public:mirror -- --remote <github-owner>/<public-repo>",
    "",
    "Runs public readiness once, then creates or updates the detached one-commit public mirror.",
    "",
    "Options:",
    "  --remote <repo>          Required. GitHub owner/repo or full GitHub URL.",
    "  --output <path>          Advanced. Disposable mirror directory; default is ../workspace-linker-public.",
    "  --branch <name>          Advanced. Mirror branch name; default is main.",
    "  --dry-run                Verify the full flow without writing the mirror.",
    "  --force                  Replace a non-default disposable output directory.",
    "  --include-source-ref     Include the private source HEAD in the mirror commit message.",
  ].join("\n"));
}

function git(gitArgs) {
  try {
    return execFileSync("git", gitArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail(`git ${gitArgs.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function runNodeScript(script, scriptArgs) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`${script} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${script} exited with status ${result.status}`);
  }
}

function readPackageVersionFromHead() {
  let packageJson;
  try {
    packageJson = JSON.parse(git(["show", "HEAD:package.json"]));
  } catch (error) {
    fail(`HEAD:package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const version = packageJson.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`HEAD:package.json version is not semver-like: ${version ?? "missing"}`);
  }
  return version;
}

function changelogReleaseState(version, releaseTag) {
  let changelog;
  try {
    changelog = git(["show", "HEAD:CHANGELOG.md"]);
  } catch (error) {
    return {
      ready: false,
      message: `HEAD:CHANGELOG.md must be readable before creating publishable release tag ${releaseTag}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")} - (.+)$`, "m").exec(changelog);
  if (!heading) {
    return {
      ready: false,
      message: `HEAD:CHANGELOG.md must contain a heading for ${version} before creating publishable release tag ${releaseTag}`,
    };
  }
  if (heading[1]?.trim() === "Unreleased") {
    return {
      ready: false,
      message: `HEAD:CHANGELOG.md heading for ${version} must be dated before creating publishable release tag ${releaseTag}`,
    };
  }
  return {
    ready: true,
    message: `HEAD:CHANGELOG.md heading for ${version} is dated`,
  };
}

function precheckPublishableReleaseTag({ dryRun }) {
  const version = readPackageVersionFromHead();
  const releaseTag = `v${version}`;
  const releaseTagCheck = changelogReleaseState(version, releaseTag);

  if (dryRun) {
    console.log(`release tag precheck: ${releaseTagCheck.ready ? "dated changelog" : `blocked for real run: ${releaseTagCheck.message}`}`);
    return;
  }

  if (!releaseTagCheck.ready) {
    fail(releaseTagCheck.message);
  }
}

function parseArgs() {
  let remote = "";
  let dryRun = false;
  const forwarded = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (!arg.startsWith("--")) fail(`unexpected positional argument: ${arg}`);

    const equalsIndex = arg.indexOf("=");
    const name = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);

    if (blockedOptions.has(name)) {
      fail(`${name} is intentionally not exposed by public:mirror; run the lower-level command only for local debugging`);
    }

    if (valueOptions.has(name)) {
      const value = inlineValue ?? args[index + 1];
      if (!value || value.startsWith("--")) fail(`${name} requires a value`);
      if (inlineValue === undefined) index += 1;
      if (name === "--remote") remote = value;
      forwarded.push(name, value);
      continue;
    }

    if (booleanOptions.has(name)) {
      if (inlineValue !== undefined) fail(`${name} does not accept a value`);
      if (name === "--dry-run") dryRun = true;
      forwarded.push(name);
      continue;
    }

    fail(`unknown option: ${name}`);
  }

  if (!remote) {
    fail("publishable public mirrors require --remote <github-owner>/<public-repo>");
  }

  return { dryRun, forwarded };
}

const repoRoot = resolve(git(["rev-parse", "--show-toplevel"]));
process.chdir(repoRoot);

const { dryRun, forwarded: snapshotArgs } = parseArgs();
const headBeforeReady = git(["rev-parse", "HEAD"]);

precheckPublishableReleaseTag({ dryRun });

runNodeScript("scripts/alpha-readiness-report.mjs", ["--accept-public-snapshot"]);

const headAfterReady = git(["rev-parse", "HEAD"]);
if (headAfterReady !== headBeforeReady) {
  fail("HEAD changed while running readiness checks; rerun public:mirror after reviewing the new commit");
}

runNodeScript("scripts/create-public-snapshot.mjs", ["--skip-audit", ...snapshotArgs]);
