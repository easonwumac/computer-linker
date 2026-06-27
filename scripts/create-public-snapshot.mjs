#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--") && !arg.includes("=")));

function fail(message) {
  console.error(`public snapshot failed: ${message}`);
  process.exit(1);
}

function readOption(name, fallback) {
  const equalsPrefix = `${name}=`;
  const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) return equalsArg.slice(equalsPrefix.length);
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1] ?? fallback;
  return fallback;
}

function git(gitArgs, options = {}) {
  return execFileSync("git", gitArgs, {
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    cwd: options.cwd,
  });
}

function runGit(gitArgs, cwd, options = {}) {
  try {
    return execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (options.allowFailure) return error.stdout?.toString() ?? "";
    fail(`git -C ${cwd} ${gitArgs.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function safeGitOutput(gitArgs, cwd) {
  try {
    return execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function runNpm(npmArgs) {
  if (process.env.npm_execpath) {
    execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    return;
  }

  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...npmArgs] : npmArgs;
  execFileSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function validateBranchName(branch) {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..") || branch.startsWith("-") || branch.endsWith("/")) {
    fail(`invalid branch name: ${branch}`);
  }
}

function validateRemote(remote) {
  if (remote && /[\r\n]/.test(remote)) fail("remote URL must be a single line");
}

function normalizeRemote(remote) {
  const trimmed = remote.trim();
  const shorthandRepo = githubRepoFromShorthand(trimmed);
  if (shorthandRepo) return `https://github.com/${shorthandRepo}.git`;
  return trimmed;
}

function parseTreeEntries(output) {
  return output.split("\0")
    .filter(Boolean)
    .map((line) => {
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1) fail(`unexpected git ls-tree output: ${line}`);
      const metadata = line.slice(0, tabIndex).split(" ");
      const path = line.slice(tabIndex + 1);
      return {
        mode: metadata[0],
        type: metadata[1],
        object: metadata[2],
        path,
      };
    })
    .filter((entry) => entry.type === "blob");
}

function assertSafeRelativePath(path) {
  const parts = path.split("/");
  if (path.startsWith("/") || parts.some((part) => part === ".." || part === "")) {
    fail(`unsafe repository path in HEAD: ${path}`);
  }
}

function assertSafeOutput(repoRoot, outputDir, { force, dryRun, allowGeneratedSnapshotReplace }) {
  if (isInside(repoRoot, outputDir)) {
    fail(`output directory must be outside this checkout: ${outputDir}`);
  }

  if (dirname(outputDir) === outputDir || outputDir.length < 8) {
    fail(`refusing unsafe output directory: ${outputDir}`);
  }

  if (!existsSync(outputDir)) return { removeExisting: false, generatedSnapshotReplace: false };
  if (!statSync(outputDir).isDirectory()) {
    fail(`output path exists and is not a directory: ${outputDir}`);
  }

  const entries = readdirSync(outputDir);
  if (entries.length === 0) return { removeExisting: false, generatedSnapshotReplace: false };
  if (dryRun) return { removeExisting: false, generatedSnapshotReplace: false };
  if (force) return { removeExisting: true, generatedSnapshotReplace: false };
  if (allowGeneratedSnapshotReplace && isReplaceableGeneratedSnapshotOutput(outputDir)) {
    return { removeExisting: true, generatedSnapshotReplace: true };
  }
  fail(`output directory is not empty: ${outputDir}. Pass --force to replace it.`);
}

function isReplaceableGeneratedSnapshotOutput(outputDir) {
  if (!existsSync(join(outputDir, ".git"))) return false;
  const packagePath = join(outputDir, "package.json");
  if (!existsSync(packagePath)) return false;
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    if (!isGeneratedComputerLinkerPackageName(packageJson.name)) return false;
  } catch {
    return false;
  }

  const revisionCount = safeGitOutput(["rev-list", "--count", "HEAD"], outputDir);
  const subject = safeGitOutput(["log", "-1", "--pretty=%s"], outputDir);
  const status = safeGitOutput(["status", "--porcelain"], outputDir);
  if (revisionCount !== "1" || status !== "") return false;
  return subject === "Initial public snapshot" || subject?.startsWith("Initial public snapshot from ") === true;
}

function isGeneratedComputerLinkerPackageName(value) {
  if (value === "computer-linker" || value === "@easonwumac/computer-linker") return true;
  return typeof value === "string" && /^@[a-z0-9._-]+\/computer-linker[a-z0-9._-]*$/.test(value);
}

function existingOutputDryRunMessage(outputDir, allowGeneratedSnapshotReplace) {
  if (allowGeneratedSnapshotReplace && isReplaceableGeneratedSnapshotOutput(outputDir)) {
    return "existing output: dry run did not modify it; real run will replace this clean generated default snapshot";
  }
  return "existing output: dry run did not modify it; pass --force when replacing this snapshot directory";
}

function copyHeadTree(entries, outputDir) {
  for (const entry of entries) {
    assertSafeRelativePath(entry.path);
    const destination = resolve(outputDir, ...entry.path.split("/"));
    if (!isInside(outputDir, destination)) {
      fail(`repository path resolves outside output directory: ${entry.path}`);
    }

    mkdirSync(dirname(destination), { recursive: true });
    const blob = git(["cat-file", "blob", entry.object], { encoding: "buffer" });
    writeFileSync(destination, blob, { mode: Number.parseInt(entry.mode, 8) & 0o777 });
  }
}

function githubRepoFromRemote(remote) {
  const trimmed = remote.trim();
  if (!trimmed) return undefined;

  const shorthandRepo = githubRepoFromShorthand(trimmed);
  if (shorthandRepo) return shorthandRepo;

  const scpLike = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
  if (scpLike) return `${scpLike[1]}/${scpLike[2].replace(/\.git$/i, "")}`;

  try {
    const url = new URL(trimmed.replace(/\.git$/i, ""));
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
  } catch {
    return undefined;
  }
}

function githubRepoFromShorthand(remote) {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i.exec(remote);
  if (!match) return undefined;
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

function rewriteSnapshotPackageLinks(outputDir, remote) {
  const repo = githubRepoFromRemote(remote);
  if (!repo) return;

  const packagePath = join(outputDir, "package.json");
  if (!existsSync(packagePath)) return;

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    fail(`snapshot package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sourceRepo = githubRepoFromRemote(packageJson.repository?.url ?? packageJson.homepage ?? "");

  const githubUrl = `https://github.com/${repo}`;
  packageJson.repository = {
    type: "git",
    url: `git+${githubUrl}.git`,
  };
  packageJson.bugs = {
    url: `${githubUrl}/issues`,
  };
  packageJson.homepage = `${githubUrl}#readme`;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  rewriteSnapshotGitHubReferences(outputDir, sourceRepo, repo);
}

function rewriteSnapshotGitHubReferences(outputDir, sourceRepo, targetRepo) {
  if (!sourceRepo || sourceRepo === targetRepo) return;
  const sourceUrl = `https://github.com/${sourceRepo}`;
  const targetUrl = `https://github.com/${targetRepo}`;
  const replacements = [
    [sourceUrl, targetUrl],
    [`git@github.com:${sourceRepo}`, `git@github.com:${targetRepo}`],
    [sourceRepo, targetRepo],
  ];

  for (const path of listSnapshotTextFiles(outputDir)) {
    const original = readFileSync(path, "utf8");
    let updated = original;
    for (const [from, to] of replacements) {
      updated = updated.split(from).join(to);
    }
    if (updated !== original) writeFileSync(path, updated, "utf8");
  }
}

function listSnapshotTextFiles(root) {
  const results = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name === ".git") continue;
    if (entry.isDirectory()) {
      results.push(...listSnapshotTextFiles(path));
      continue;
    }
    if (!entry.isFile() || !isTextSnapshotPath(path)) continue;
    results.push(path);
  }
  return results;
}

function isTextSnapshotPath(path) {
  return /\.(cjs|js|json|md|mjs|ts|txt|yaml|yml)$/i.test(path);
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

function verifySnapshot(outputDir, branch, releaseTag) {
  const revisionCount = runGit(["rev-list", "--count", "HEAD"], outputDir).trim();
  if (revisionCount !== "1") {
    fail(`snapshot repository must contain exactly one commit, got ${revisionCount}`);
  }

  const actualBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], outputDir).trim();
  if (actualBranch !== branch) {
    fail(`snapshot branch must be ${branch}, got ${actualBranch}`);
  }

  const status = runGit(["status", "--porcelain"], outputDir).trim();
  if (status) {
    fail(`snapshot repository must be clean after creation:\n${status}`);
  }

  const tagCommit = runGit(["rev-list", "-n", "1", releaseTag], outputDir, { allowFailure: true }).trim();
  const headCommit = runGit(["rev-parse", "HEAD"], outputDir).trim();
  if (tagCommit !== headCommit) {
    fail(`snapshot release tag ${releaseTag} must point at HEAD`);
  }

  const highRiskHistoryRegex = [
    "sk-[A-Za-z0-9_-]{20,}",
    "ghp_[A-Za-z0-9_]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "AKIA[0-9A-Z]{16}",
    "-----BEGIN .*PRIVATE KEY-----",
    "Bearer [A-Za-z0-9._~+/=-]{24,}",
    "tunnel_[A-Za-z0-9_-]{20,}",
  ].join("|");
  const highRiskHits = runGit([
    "log",
    "-G",
    highRiskHistoryRegex,
    "--all",
    "--oneline",
    "--",
    ".",
    ":(exclude)scripts/alpha-evidence.mjs",
    ":(exclude)scripts/public-release-audit.mjs",
    ":(exclude)scripts/create-public-snapshot.mjs",
  ], outputDir, { allowFailure: true }).trim();
  if (highRiskHits) {
    fail(`snapshot history contains high-risk secret-shaped changes:\n${highRiskHits}`);
  }

  const historyFingerprintRegex = "[A-Z]:\\\\(Users|code|workspaces)\\\\|[a-z0-9-]+\\.[a-z0-9-]+\\.ts\\.net";
  const fingerprintOutput = runGit([
    "grep",
    "-n",
    "-I",
    "-E",
    historyFingerprintRegex,
    "HEAD",
    "--",
    ".",
  ], outputDir, { allowFailure: true });
  const fingerprintHits = fingerprintOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.includes("C:\\Projects\\my-app"))
    .filter((line) => !line.includes("C:\\Windows\\System32"))
    .filter((line) => !line.includes("example.ts.net"));
  if (fingerprintHits.length > 0) {
    fail(`snapshot contains local fingerprints:\n${fingerprintHits.slice(0, 20).join("\n")}`);
  }
}

const defaultOutputArg = "../computer-linker-public";
const outputArg = readOption("--output", defaultOutputArg);
const branch = readOption("--branch", "main");
const remote = normalizeRemote(readOption("--remote", ""));
const remoteRepo = remote ? githubRepoFromRemote(remote) : undefined;
const dryRun = flags.has("--dry-run");
const force = flags.has("--force");
const allowDirty = flags.has("--allow-dirty");
const skipAudit = flags.has("--skip-audit");
const includeSourceRef = flags.has("--include-source-ref");

validateBranchName(branch);
validateRemote(remote);

const repoRoot = resolve(git(["rev-parse", "--show-toplevel"]).trim());
process.chdir(repoRoot);
const packageVersion = readPackageVersionFromHead();
const releaseTag = `v${packageVersion}`;
const releaseTagCheck = remote ? changelogReleaseState(packageVersion, releaseTag) : { ready: true, message: "not required without --remote" };

const status = git(["status", "--porcelain"]).trim();
if (status && allowDirty && !dryRun) {
  fail("--allow-dirty is only supported with --dry-run. Commit changes before creating a public snapshot.");
}
if (status && !allowDirty) {
  fail("worktree must be clean so the snapshot matches committed HEAD. Commit changes first, or use --allow-dirty for dry-run checks.");
}
if (remote && !dryRun && !releaseTagCheck.ready) {
  fail(releaseTagCheck.message);
}

if (!skipAudit) {
  runNpm(["run", "public:check"]);
}

const outputDir = resolve(repoRoot, outputArg);
const defaultOutputDir = resolve(repoRoot, defaultOutputArg);
const allowGeneratedSnapshotReplace = outputDir === defaultOutputDir;
const headSha = git(["rev-parse", "--short=12", "HEAD"]).trim();
const treeEntries = parseTreeEntries(git(["ls-tree", "-r", "-z", "HEAD"]));

const replacePlan = assertSafeOutput(repoRoot, outputDir, { force, dryRun, allowGeneratedSnapshotReplace });

if (dryRun) {
  const sourceSuffix = includeSourceRef ? ` from HEAD ${headSha}` : " from committed HEAD";
  console.log(`public snapshot dry run ok: ${treeEntries.length} files${sourceSuffix}`);
  console.log(`output: ${outputDir}`);
  console.log(`release tag: ${releaseTag}`);
  if (remote) console.log(`release tag check: ${releaseTagCheck.ready ? "dated changelog" : `blocked for real run: ${releaseTagCheck.message}`}`);
  console.log(remoteRepo ? "snapshot mode: publishable" : remote ? "snapshot mode: remote-configured" : "snapshot mode: verification-only (not publishable without --remote)");
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    console.log(existingOutputDryRunMessage(outputDir, allowGeneratedSnapshotReplace));
  }
  if (remote) console.log(`remote: ${remote}`);
  if (includeSourceRef) console.log(`source HEAD: ${headSha}`);
  process.exit(0);
}

if (existsSync(outputDir) && replacePlan.removeExisting) {
  rmSync(outputDir, { recursive: true, force: true });
}

mkdirSync(outputDir, { recursive: true });
copyHeadTree(treeEntries, outputDir);
rewriteSnapshotPackageLinks(outputDir, remote);

runGit(["init"], outputDir);
runGit(["checkout", "-B", branch], outputDir);
runGit(["add", "-A"], outputDir);
const commitMessage = includeSourceRef ? `Initial public snapshot from ${headSha}` : "Initial public snapshot";
runGit(["commit", "--no-verify", "-m", commitMessage], outputDir);
runGit(["tag", releaseTag], outputDir);
verifySnapshot(outputDir, branch, releaseTag);

if (remote) {
  runGit(["remote", "add", "origin", remote], outputDir);
}

console.log(`public snapshot created: ${outputDir}`);
if (replacePlan.generatedSnapshotReplace) {
  console.log("existing output: replaced clean generated default snapshot");
}
console.log(`branch: ${branch}`);
console.log(`release tag: ${releaseTag}`);
if (remote) console.log("release tag check: dated changelog");
if (remote) console.log(`remote: ${remote}`);
console.log(remoteRepo ? "snapshot mode: publishable" : remote ? "snapshot mode: remote-configured" : "snapshot mode: verification-only (not publishable)");
if (includeSourceRef) {
  console.log(`source HEAD: ${headSha}`);
} else {
  console.log("source reference: omitted by default; pass --include-source-ref when traceability is required");
}
console.log("verification: one clean commit, strict history fingerprints clean");
if (remote) {
  if (remoteRepo) {
    console.log(`package links: rewritten for https://github.com/${remoteRepo}`);
  } else {
    console.log("package links: unchanged because --remote is not a GitHub repo URL");
  }
  console.log(`push with: git -C "${outputDir}" push -u origin ${branch} --follow-tags`);
} else {
  console.log("package links: unchanged because --remote was not provided");
  console.log("publishable mirror: rerun with --remote <github-owner>/<public-repo> so package metadata points at the public repo");
  console.log("do not push this verification-only mirror; recreate it with --remote before publishing");
}
