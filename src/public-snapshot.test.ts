import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "computer-linker-public-snapshot-test-"));
const sourceRoot = join(root, "source");
const outputRoot = join(root, "snapshot");
const outputRootWithSourceRef = join(root, "snapshot-source-ref");
const outputRootWithRemoteShorthand = join(root, "snapshot-remote-shorthand");
const defaultOutputRoot = join(root, "computer-linker-public");
const snapshotScript = join(process.cwd(), "scripts", "create-public-snapshot.mjs");

try {
  await mkdir(sourceRoot, { recursive: true });
  await git(["init"]);
  await git(["config", "user.name", "Computer Linker Test"]);
  await git(["config", "user.email", "computer-linker-test@example.com"]);
  await writeFile(join(sourceRoot, "README.md"), "clean\n", "utf8");
  await writeFile(join(sourceRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.1.0 - 2026-06-24\n", "utf8");
  await mkdir(join(sourceRoot, "scripts"), { recursive: true });
  await mkdir(join(sourceRoot, ".github", "ISSUE_TEMPLATE"), { recursive: true });
  await mkdir(join(sourceRoot, "docs"), { recursive: true });
  const privateKeyScannerSource = [
    "-----BEGIN ",
    "[A-Z ]*",
    "PRIVATE KEY-----",
  ].join("");
  await writeFile(
    join(sourceRoot, "scripts", "alpha-evidence.mjs"),
    `const scanner = /${privateKeyScannerSource}/g;\n`,
    "utf8",
  );
  await writeFile(join(sourceRoot, "package.json"), JSON.stringify({
    name: "@easonwumac/computer-linker",
    version: "0.1.0",
    repository: {
      type: "git",
      url: "git+https://github.com/easonwumac/computer-linker.git",
    },
    bugs: {
      url: "https://github.com/easonwumac/computer-linker/issues",
    },
    homepage: "https://github.com/easonwumac/computer-linker#readme",
  }, null, 2), "utf8");
  await writeFile(
    join(sourceRoot, ".github", "ISSUE_TEMPLATE", "config.yml"),
    [
      "contact_links:",
      "  - name: Security policy",
      "    url: https://github.com/easonwumac/computer-linker/security/policy",
      "  - name: README",
      "    url: https://github.com/easonwumac/computer-linker#readme",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "docs", "computer-operation-v1.schema.json"),
    JSON.stringify({
      $id: "https://github.com/easonwumac/computer-linker/schemas/computer-operation-v1.schema.json",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "docs", "config.schema.json"),
    JSON.stringify({
      $id: "https://github.com/easonwumac/computer-linker/schemas/config.schema.json",
    }, null, 2),
    "utf8",
  );
  await git(["add", "-A"]);
  await git(["commit", "--no-verify", "-m", "Initial"]);
  const sourceHead = (await gitOutput(sourceRoot, ["rev-parse", "--short=12", "HEAD"])).trim();

  await writeFile(join(sourceRoot, "README.md"), "dirty\n", "utf8");

  const createFromDirty = await runSnapshot(["--allow-dirty", "--skip-audit", "--output", outputRoot]);
  assert.notEqual(createFromDirty.code, 0);
  assert.match(createFromDirty.stderr, /--allow-dirty is only supported with --dry-run/);

  const dryRunFromDirty = await runSnapshot(["--dry-run", "--allow-dirty", "--skip-audit", "--output", outputRoot]);
  assert.equal(dryRunFromDirty.code, 0);
  assert.match(dryRunFromDirty.stdout, /public snapshot dry run ok/);
  assert.match(dryRunFromDirty.stdout, /release tag: v0\.1\.0/);
  assert.doesNotMatch(dryRunFromDirty.stdout, new RegExp(sourceHead));
  assert.doesNotMatch(dryRunFromDirty.stdout, /source HEAD:/);

  await writeFile(join(sourceRoot, "README.md"), "clean\n", "utf8");
  const createCleanSnapshot = await runSnapshot([
    "--skip-audit",
    "--output",
    outputRoot,
    "--remote",
    "https://github.com/example/computer-linker-public.git",
  ]);
  assert.equal(createCleanSnapshot.code, 0, createCleanSnapshot.stderr);
  assert.match(createCleanSnapshot.stdout, /verification: one clean commit, strict history fingerprints clean/);
  assert.match(createCleanSnapshot.stdout, /release tag: v0\.1\.0/);
  assert.match(createCleanSnapshot.stdout, /release tag check: dated changelog/);
  assert.match(createCleanSnapshot.stdout, /snapshot mode: publishable/);
  assert.match(createCleanSnapshot.stdout, /package links: rewritten for https:\/\/github\.com\/example\/computer-linker-public/);
  assert.match(createCleanSnapshot.stdout, /push with: git -C ".+" push -u origin main --follow-tags/);
  assert.doesNotMatch(createCleanSnapshot.stdout, new RegExp(sourceHead));
  assert.doesNotMatch(createCleanSnapshot.stdout, /source HEAD:/);
  assert.equal((await gitOutput(outputRoot, ["rev-list", "--count", "HEAD"])).trim(), "1");
  assert.equal((await gitOutput(outputRoot, ["log", "-1", "--pretty=%s"])).trim(), "Initial public snapshot");
  assert.equal(
    (await gitOutput(outputRoot, ["rev-list", "-n", "1", "v0.1.0"])).trim(),
    (await gitOutput(outputRoot, ["rev-parse", "HEAD"])).trim(),
  );
  const packageJson = JSON.parse(await readFile(join(outputRoot, "package.json"), "utf8"));
  assert.equal(packageJson.repository.url, "git+https://github.com/example/computer-linker-public.git");
  assert.equal(packageJson.bugs.url, "https://github.com/example/computer-linker-public/issues");
  assert.equal(packageJson.homepage, "https://github.com/example/computer-linker-public#readme");
  const issueConfig = await readFile(join(outputRoot, ".github", "ISSUE_TEMPLATE", "config.yml"), "utf8");
  assert.match(issueConfig, /https:\/\/github\.com\/example\/computer-linker-public\/security\/policy/);
  assert.doesNotMatch(issueConfig, /easonwumac\/computer-linker/);
  const schemaJson = JSON.parse(await readFile(join(outputRoot, "docs", "computer-operation-v1.schema.json"), "utf8"));
  assert.equal(schemaJson.$id, "https://github.com/example/computer-linker-public/schemas/computer-operation-v1.schema.json");
  const configSchemaJson = JSON.parse(await readFile(join(outputRoot, "docs", "config.schema.json"), "utf8"));
  assert.equal(configSchemaJson.$id, "https://github.com/example/computer-linker-public/schemas/config.schema.json");

  const dryRunWithExistingOutput = await runSnapshot(["--dry-run", "--skip-audit", "--output", outputRoot]);
  assert.equal(dryRunWithExistingOutput.code, 0, dryRunWithExistingOutput.stderr);
  assert.match(dryRunWithExistingOutput.stdout, /public snapshot dry run ok/);
  assert.match(dryRunWithExistingOutput.stdout, /existing output: dry run did not modify it/);

  const replaceWithoutForce = await runSnapshot(["--skip-audit", "--output", outputRoot]);
  assert.notEqual(replaceWithoutForce.code, 0);
  assert.match(replaceWithoutForce.stderr, /output directory is not empty/);
  assert.match(replaceWithoutForce.stderr, /Pass --force to replace it/);

  const createDefaultSnapshot = await runSnapshot([
    "--skip-audit",
    "--remote",
    "example/computer-linker-default",
  ]);
  assert.equal(createDefaultSnapshot.code, 0, createDefaultSnapshot.stderr);
  assert.match(createDefaultSnapshot.stdout, /public snapshot created:/);
  assert.match(createDefaultSnapshot.stdout, /snapshot mode: publishable/);
  assert.equal(
    (await gitOutput(defaultOutputRoot, ["remote", "get-url", "origin"])).trim(),
    "https://github.com/example/computer-linker-default.git",
  );

  const dryRunWithGeneratedDefaultOutput = await runSnapshot([
    "--dry-run",
    "--skip-audit",
    "--remote",
    "example/computer-linker-default",
  ]);
  assert.equal(dryRunWithGeneratedDefaultOutput.code, 0, dryRunWithGeneratedDefaultOutput.stderr);
  assert.match(dryRunWithGeneratedDefaultOutput.stdout, /real run will replace this clean generated default snapshot/);

  const replaceDefaultSnapshot = await runSnapshot([
    "--skip-audit",
    "--remote",
    "example/computer-linker-default",
  ]);
  assert.equal(replaceDefaultSnapshot.code, 0, replaceDefaultSnapshot.stderr);
  assert.match(replaceDefaultSnapshot.stdout, /existing output: replaced clean generated default snapshot/);

  await writeFile(join(defaultOutputRoot, "LOCAL.txt"), "manual change\n", "utf8");
  const replaceDirtyDefaultSnapshot = await runSnapshot([
    "--skip-audit",
    "--remote",
    "example/computer-linker-default",
  ]);
  assert.notEqual(replaceDirtyDefaultSnapshot.code, 0);
  assert.match(replaceDirtyDefaultSnapshot.stderr, /output directory is not empty/);
  assert.match(replaceDirtyDefaultSnapshot.stderr, /Pass --force to replace it/);

  const createSnapshotWithSourceRef = await runSnapshot([
    "--skip-audit",
    "--output",
    outputRootWithSourceRef,
    "--include-source-ref",
  ]);
  assert.equal(createSnapshotWithSourceRef.code, 0, createSnapshotWithSourceRef.stderr);
  assert.match(createSnapshotWithSourceRef.stdout, new RegExp(`source HEAD: ${sourceHead}`));
  assert.match(createSnapshotWithSourceRef.stdout, /snapshot mode: verification-only \(not publishable\)/);
  assert.match(createSnapshotWithSourceRef.stdout, /package links: unchanged because --remote was not provided/);
  assert.match(createSnapshotWithSourceRef.stdout, /publishable mirror: rerun with --remote <github-owner>\/<public-repo>/);
  assert.match(createSnapshotWithSourceRef.stdout, /do not push this verification-only mirror/);
  assert.equal(
    (await gitOutput(outputRootWithSourceRef, ["log", "-1", "--pretty=%s"])).trim(),
    `Initial public snapshot from ${sourceHead}`,
  );

  const createSnapshotWithRemoteShorthand = await runSnapshot([
    "--skip-audit",
    "--output",
    outputRootWithRemoteShorthand,
    "--remote",
    "example/computer-linker-public",
  ]);
  assert.equal(createSnapshotWithRemoteShorthand.code, 0, createSnapshotWithRemoteShorthand.stderr);
  assert.match(createSnapshotWithRemoteShorthand.stdout, /remote: https:\/\/github\.com\/example\/computer-linker-public\.git/);
  assert.match(createSnapshotWithRemoteShorthand.stdout, /snapshot mode: publishable/);
  assert.match(createSnapshotWithRemoteShorthand.stdout, /package links: rewritten for https:\/\/github\.com\/example\/computer-linker-public/);
  assert.equal(
    (await gitOutput(outputRootWithRemoteShorthand, ["remote", "get-url", "origin"])).trim(),
    "https://github.com/example/computer-linker-public.git",
  );
  const shorthandPackageJson = JSON.parse(await readFile(join(outputRootWithRemoteShorthand, "package.json"), "utf8"));
  assert.equal(shorthandPackageJson.repository.url, "git+https://github.com/example/computer-linker-public.git");

  await writeFile(join(sourceRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.1.0 - Unreleased\n", "utf8");
  await git(["add", "CHANGELOG.md"]);
  await git(["commit", "--no-verify", "-m", "Mark changelog unreleased"]);
  const unreleasedDryRun = await runSnapshot([
    "--dry-run",
    "--skip-audit",
    "--output",
    join(root, "snapshot-unreleased-dry-run"),
    "--remote",
    "example/computer-linker-unreleased",
  ]);
  assert.equal(unreleasedDryRun.code, 0, unreleasedDryRun.stderr);
  assert.match(unreleasedDryRun.stdout, /release tag check: blocked for real run:/);
  const unreleasedSnapshot = await runSnapshot([
    "--skip-audit",
    "--output",
    join(root, "snapshot-unreleased"),
    "--remote",
    "example/computer-linker-unreleased",
  ]);
  assert.notEqual(unreleasedSnapshot.code, 0);
  assert.match(unreleasedSnapshot.stderr, /heading for 0\.1\.0 must be dated before creating publishable release tag v0\.1\.0/);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd: sourceRoot,
    windowsHide: true,
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  });
  return result.stdout;
}

async function runSnapshot(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [snapshotScript, ...args], {
      cwd: sourceRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Computer Linker Test",
        GIT_AUTHOR_EMAIL: "computer-linker-test@example.com",
        GIT_COMMITTER_NAME: "Computer Linker Test",
        GIT_COMMITTER_EMAIL: "computer-linker-test@example.com",
      },
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}
