import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { readAuditEvents } from "./audit.js";
import { normalizeConfig } from "./permissions.js";
import {
  buildWorkspaceOperationRegistry,
  normalizeWorkspaceOperationInput,
  runWorkspaceOperation,
  workspaceOperationCatalog,
  workspaceOperationAuditFields,
  workspaceOperationEntry,
  workspaceOperationNames,
  workspaceOperationRegistry,
  workspaceOperationSafety,
  type ProcessResult,
} from "./workspace-operations.js";
import { WorkspaceRegistry } from "./workspaces.js";

const originalPath = process.env.PATH;
const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "localport-operations-test-"));
const binDir = join(root, "bin");
const emptyPathDir = join(root, "empty-path");
const configRoot = join(root, "config");
const workspaceRoot = join(root, "workspace");
const missingWorkspaceRoot = join(root, "missing-workspace-root");

try {
  assert.deepEqual(
    workspaceOperationSafety.map((entry) => entry.operation),
    [...workspaceOperationNames],
  );
  assert.deepEqual(
    workspaceOperationRegistry.map((entry) => entry.operation),
    [...workspaceOperationNames],
  );
  assert.deepEqual(
    buildWorkspaceOperationRegistry(workspaceOperationCatalog).map((entry) => entry.operation),
    [...workspaceOperationNames],
  );
  assert.equal(workspaceOperationEntry("read").name, "read");
  assert.throws(
    () => buildWorkspaceOperationRegistry(workspaceOperationCatalog.slice(1)),
    /Missing registered operations: stat/,
  );
  assert.throws(
    () => buildWorkspaceOperationRegistry([...workspaceOperationCatalog, workspaceOperationCatalog[0]]),
    /Duplicate operation registered in catalog: stat/,
  );
  assert.throws(
    () => buildWorkspaceOperationRegistry([
      ...workspaceOperationCatalog.slice(1),
      {
        ...workspaceOperationCatalog[0],
        operation: "not_real",
      },
    ] as typeof workspaceOperationCatalog),
    /Unknown operation registered in catalog: not_real/,
  );
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.category, "search");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.name, "search_text");
  assert.deepEqual(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.schema.requiredFields, ["query"]);
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.run.handler, "runFileSearchOperation");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "write")?.run.handler, "runFileSearchOperation");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "create_file")?.run.handler, "runFileSearchOperation");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "create_file")?.permission, "write");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "history_insight")?.run.handler, "runMetadataOperation");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "explain_operation")?.run.handler, "runMetadataOperation");
  assert.equal(typeof workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.run.execute, "function");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.audit.fields, "workspaceOperationAuditFields");
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.audit.redactions.includes("write payloads"));
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "codex")?.category, "codex");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "codex")?.run.handler, "runCodexOperation");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "codex_review")?.run.handler, "runCodexOperation");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "screen_list")?.category, "screen");
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "screen_list")?.run.handler, "runScreenOperation");
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "screen_capture")?.audit.redactions.includes("screenshot pixels"));
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "search_text")?.capabilities.includes("search:read"));
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "create_file")?.capabilities.includes("fs:write"));
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "git_commit")?.capabilities.includes("git:write"));
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "codex_review")?.capabilities.includes("codex:readOnly"));
  assert.ok(workspaceOperationRegistry.find((entry) => entry.operation === "screen_list")?.capabilities.includes("screen:capture"));
  assert.equal(workspaceOperationRegistry.find((entry) => entry.operation === "command")?.limits?.maxRuntimeSeconds, 3600);
  assert.equal(workspaceOperationSafety.find((entry) => entry.operation === "read")?.boundary, "workspace-path-enforced");
  assert.equal(workspaceOperationSafety.find((entry) => entry.operation === "command")?.boundary, "workspace-cwd-only");
  assert.equal(workspaceOperationSafety.find((entry) => entry.operation === "codex")?.boundary, "workspace-cwd-only");
  assert.equal(workspaceOperationSafety.find((entry) => entry.operation === "codex_start")?.boundary, "workspace-cwd-only");
  assert.equal(workspaceOperationSafety.find((entry) => entry.operation === "batch")?.boundary, "mixed");
  assert.deepEqual(normalizeWorkspaceOperationInput({
    op: "search_text",
    target: "src",
    input: { query: "value" },
    options: { maxResults: 3 },
  }), {
    operation: "search_text",
    path: "src",
    query: "value",
    fixedStrings: undefined,
    caseSensitive: undefined,
    maxResults: 3,
    view: undefined,
    beforeContext: undefined,
    afterContext: undefined,
    recursive: undefined,
    includeFiles: undefined,
    maxDepth: undefined,
    maxEntries: undefined,
    startLine: undefined,
    lineCount: undefined,
    maxBytes: undefined,
    includeDiff: undefined,
    staged: undefined,
    continueOnError: undefined,
    operationName: undefined,
    paths: undefined,
    content: undefined,
    encoding: undefined,
    createParents: undefined,
    patch: undefined,
    oldText: undefined,
    newText: undefined,
    fromPath: undefined,
    toPath: undefined,
    pattern: undefined,
    glob: undefined,
    expectedSha256: undefined,
    message: undefined,
    ref: undefined,
    script: undefined,
    scriptArgs: undefined,
    branch: undefined,
    startPoint: undefined,
    command: undefined,
    processId: undefined,
    signal: undefined,
    prompt: undefined,
    workflowId: undefined,
    format: undefined,
    returnMode: undefined,
    maxWidth: undefined,
    maxHeight: undefined,
    workingDirectory: undefined,
    timeoutSeconds: undefined,
    maxOutputBytes: undefined,
    operations: undefined,
  });

  process.env.LOCALPORT_CONFIG_DIR = configRoot;
  await mkdir(binDir, { recursive: true });
  await mkdir(emptyPathDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, ".codex", "skills", "refactor"), { recursive: true });
  await mkdir(join(workspaceRoot, ".claude", "skills", "review"), { recursive: true });
  await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({
    name: "overview-app",
    type: "module",
    packageManager: "pnpm@9.0.0",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "node --test",
      deploy: "node deploy.js",
    },
  }, null, 2), "utf8");
  await writeFile(join(workspaceRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(join(workspaceRoot, "tsconfig.json"), "{}\n", "utf8");
  await writeFile(join(workspaceRoot, "src/app.ts"), [
    "export interface WorkspaceHandle {",
    "  id: string;",
    "}",
    "export class WorkspaceRunner {}",
    "export function openWorkspace(id: string): WorkspaceHandle {",
    "  return { id };",
    "}",
    "export const value: number = 1;",
    "",
  ].join("\n"), "utf8");
  const binaryFixture = Buffer.from([0, 159, 146, 150, 255]);
  await writeFile(join(workspaceRoot, "binary.bin"), binaryFixture);
  await writeFile(join(workspaceRoot, "src/lines.ts"), "line1\nline2\nline3\nline4\n", "utf8");
  await writeFile(join(workspaceRoot, ".env"), "HIDDEN_SETTING=blocked-value\n", "utf8");
  await writeFile(join(workspaceRoot, ".env.example"), "EXAMPLE_SETTING=example\n", "utf8");
  await mkdir(join(workspaceRoot, ".ssh"), { recursive: true });
  await writeFile(join(workspaceRoot, ".ssh", "id_rsa"), "private-key\n", "utf8");
  await mkdir(join(workspaceRoot, "sensitive-parent"), { recursive: true });
  await writeFile(join(workspaceRoot, "sensitive-parent", ".env"), "nested-secret\n", "utf8");
  await writeFile(join(workspaceRoot, "AGENTS.md"), "test guidance\n", "utf8");
  await writeFile(join(workspaceRoot, ".codex", "skills", "refactor", "SKILL.md"), [
    "---",
    "description: Refactor TypeScript modules safely.",
    "---",
    "# Refactor Skill",
    "",
    "Use this skill for targeted refactors.",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, ".claude", "skills", "review", "SKILL.md"), [
    "# Review Skill",
    "",
    "Find correctness issues before merge.",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, "child-signal.js"), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync('child-ready.txt', 'ready');",
    "process.on('SIGTERM', () => {",
    "  writeFileSync('child-signal.txt', 'term');",
    "  process.exit(0);",
    "});",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, "process-output.js"), [
    "process.stdout.write('process-out');",
    "process.stderr.write('process-err');",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, "command-output.js"), [
    "process.stdout.write('abcdefghi');",
    "process.stderr.write('stderr-output');",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(workspaceRoot, "child-ignore-term.js"), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync('child-ignore-ready.txt', String(process.pid));",
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), "utf8");
  const resolvedWorkspaceRoot = await realpath(workspaceRoot);

  await writeFakeTool(binDir, "codex", [
    "const args = process.argv.slice(2).join(' ');",
    "process.stdout.write(`args=${args}\\n`);",
    "process.stdout.write(`cwd=${process.cwd()}\\n`);",
    "process.stdout.write('stdin=');",
    "let stdin = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { stdin += chunk; });",
    "process.stdin.on('end', () => {",
    "  process.stdout.write(`${stdin}\\n`);",
    "  process.stderr.write('codex-err');",
    "  process.exitCode = 9;",
    "});",
    "",
  ]);
  await writeFakeTool(binDir, "pnpm", [
    "const args = process.argv.slice(2).join(' ');",
    "process.stdout.write(`pnpm-args=${args}\\n`);",
    "process.stdout.write(`pnpm-cwd=${process.cwd()}\\n`);",
    "process.stderr.write('pnpm-err');",
    "process.exitCode = 3;",
    "",
  ]);
  await writeFakeTool(binDir, "npm", [
    "const args = process.argv.slice(2).join(' ');",
    "process.stdout.write(`npm-args=${args}\\n`);",
    "process.stdout.write(`npm-cwd=${process.cwd()}\\n`);",
    "",
  ]);
  await writeFakeTool(binDir, "git", [
    "const args = process.argv.slice(2).join(' ');",
    "switch (args) {",
    "  case 'status':",
    "    process.stdout.write('on branch main\\n');",
    "    break;",
    "  case 'worktree list --porcelain':",
    "    process.stdout.write('worktree /repo/main\\nHEAD abc123\\nbranch refs/heads/main\\n\\nworktree /repo/feature\\nHEAD def456\\nbranch refs/heads/feature-a\\n');",
    "    break;",
    "  case args.startsWith('worktree add -b feature-a ') && args.endsWith(' HEAD') ? args : undefined:",
    "    process.stdout.write(`created ${args}\\n`);",
    "    break;",
    "  case 'status --porcelain=v1 --branch':",
    "    process.stdout.write('## main...origin/main [ahead 1]\\n M src/app.ts\\nM  staged.ts\\n?? notes.md\\nR  old-name.ts -> new-name.ts\\n');",
    "    break;",
    "  case 'status --short --branch':",
    "    process.stdout.write('## main\\n M src/app.ts\\n?? notes.md\\n');",
    "    break;",
    "  case 'rev-parse --is-inside-work-tree':",
    "    process.stdout.write('true\\n');",
    "    break;",
    "  case 'rev-parse --show-toplevel':",
    `    process.stdout.write(${JSON.stringify(`${resolvedWorkspaceRoot}\n`)});`,
    "    break;",
    "  case 'add -- src/app.ts':",
    "    process.stdout.write(`staged ${args}\\n`);",
    "    break;",
    "  case 'restore --staged -- staged.ts':",
    "    process.stdout.write(`unstaged ${args}\\n`);",
    "    break;",
    "  case 'diff --cached --name-only -z':",
    "    process.stdout.write('src/app.ts\\0staged.ts\\0');",
    "    break;",
    "  case 'commit -m localport test commit':",
    "    process.stdout.write('[main abc123] localport test commit\\n 2 files changed\\n');",
    "    break;",
    "  case 'diff --stat':",
    "    process.stdout.write(' src/app.ts | 2 +-\\n');",
    "    break;",
    "  case 'diff --cached --stat':",
    "    process.stdout.write(' staged.ts | 1 +\\n');",
    "    break;",
    "  case 'diff -- src/app.ts':",
    "    process.stdout.write('diff --git a/src/app.ts b/src/app.ts\\n+path-specific\\n');",
    "    break;",
    "  case 'diff -- .env':",
    "    process.stdout.write('diff --git a/.env b/.env\\n--- a/.env\\n+++ b/.env\\n+WORKSPACE_LINKER_SECRET=path-secret\\n');",
    "    break;",
    "  case 'diff -- app.ts':",
    "    process.stdout.write('diff --git a/app.ts b/app.ts\\n+subdir-relative\\n');",
    "    break;",
    "  case 'diff --cached -- staged.ts':",
    "    process.stdout.write('diff --git a/staged.ts b/staged.ts\\n+staged-specific\\n');",
    "    break;",
    "  case 'log --max-count=2 --date=iso-strict --pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e --':",
    "    process.stdout.write('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\x1faaaaaaa\\x1fAlice\\x1falice@example.com\\x1f2026-01-02T03:04:05+00:00\\x1fInitial app\\x1e');",
    "    process.stdout.write('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\x1fbbbbbbb\\x1fBob\\x1fbob@example.com\\x1f2026-01-03T04:05:06+00:00\\x1fUpdate app\\x1e');",
    "    break;",
    "  case 'log --max-count=1 --date=iso-strict --pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e -- src/app.ts':",
    "    process.stdout.write('cccccccccccccccccccccccccccccccccccccccc\\x1fccccccc\\x1fCarol\\x1fcarol@example.com\\x1f2026-01-04T05:06:07+00:00\\x1fTouch src app\\x1e');",
    "    break;",
    "  case 'show --stat --patch --format=fuller HEAD --':",
    "    process.stdout.write('commit aaaaaaa\\nAuthor: Alice <alice@example.com>\\n\\n src/app.ts | 1 +\\n .env | 1 +\\n\\ndiff --git a/src/app.ts b/src/app.ts\\n+path-specific-show\\n\\ndiff --git a/.env b/.env\\n--- a/.env\\n+++ b/.env\\n+WORKSPACE_LINKER_SECRET=show-secret\\n');",
    "    break;",
    "  case 'show --stat --patch --format=fuller abc123 -- src/app.ts':",
    "    process.stdout.write('commit abc123\\nAuthor: Bob <bob@example.com>\\n\\ndiff --git a/src/app.ts b/src/app.ts\\n+filtered-show\\n');",
    "    break;",
    "  case 'diff --':",
    "    process.stdout.write('diff --git a/src/app.ts b/src/app.ts\\n+changed\\n\\ndiff --git a/.env b/.env\\n--- a/.env\\n+++ b/.env\\n+WORKSPACE_LINKER_SECRET=repo-secret\\n');",
    "    break;",
    "  case 'diff --cached --':",
    "    process.stdout.write('diff --git a/staged.ts b/staged.ts\\n+staged\\n');",
    "    break;",
    "  default:",
    "    process.stderr.write(`unexpected git args: ${args}`);",
    "    process.exitCode = 2;",
    "}",
    "",
  ]);
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

  const config = normalizeConfig({
    machineName: "operations-test",
    workspaces: [
      {
        id: "codex-enabled",
        name: "Codex enabled",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: true, codex: true },
      },
      {
        id: "codex-disabled",
        name: "Codex disabled",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
      {
        id: "codex-only",
        name: "Codex only",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: true },
      },
      {
        id: "worktree-enabled",
        name: "Worktree enabled",
        path: workspaceRoot,
        permissions: { read: true, write: true, shell: false, codex: false },
      },
      {
        id: "sensitive-opt-in",
        name: "Sensitive opt in",
        path: workspaceRoot,
        permissions: { read: true, write: true, shell: false, codex: false },
        policy: {
          allowSensitivePathMetadata: true,
          allowSensitivePathWrites: true,
        },
      },
      {
        id: "policy-limited",
        name: "Policy limited",
        path: workspaceRoot,
        permissions: { read: true, write: false, shell: true, codex: false },
        policy: {
          allowedCommands: ["node *", "npm *", "pnpm *", "git *"],
          deniedCommands: ["node blocked*"],
          allowedPackageScripts: ["test", "build"],
          deniedPackageScripts: ["deploy"],
          maxRuntimeSeconds: 5,
          maxOutputBytes: 5,
        },
      },
      {
        id: "missing-root",
        name: "Missing root",
        path: missingWorkspaceRoot,
        permissions: { read: true, write: false, shell: false, codex: false },
      },
    ],
  });
  const registry = new WorkspaceRegistry(config);
  await assert.rejects(
    () => registry.openWorkspace("missing-root"),
    /Configured workspace root does not exist or is not a directory/,
  );
  assert.equal(existsSync(missingWorkspaceRoot), false);
  const codexEnabled = await registry.openWorkspace("codex-enabled");
  const codexOnly = await registry.openWorkspace("codex-only");
  const worktreeEnabled = await registry.openWorkspace("worktree-enabled");
  const sensitiveOptIn = await registry.openWorkspace("sensitive-opt-in");
  const policyLimited = await registry.openWorkspace("policy-limited");

  const writeExplanation = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "explain_operation",
    operationName: "write",
  }) as {
    operation: string;
    allowed: boolean;
    requiredPermission: string;
    missingPermission: string;
    requiredCapabilities: string[];
    missingCapabilities: string[];
    workspace: { capabilityPolicy: { capabilities: string[] } };
    safety: { boundary: string };
    catalog: { operation: string };
    registry: { name: string; run: { handler: string } };
  };
  assert.equal(writeExplanation.operation, "write");
  assert.equal(writeExplanation.allowed, false);
  assert.equal(writeExplanation.requiredPermission, "write");
  assert.equal(writeExplanation.missingPermission, "write");
  assert.ok(writeExplanation.requiredCapabilities.includes("fs:write"));
  assert.ok(writeExplanation.missingCapabilities.includes("fs:write"));
  assert.ok(writeExplanation.workspace.capabilityPolicy.capabilities.includes("fs:read"));
  assert.equal(writeExplanation.workspace.capabilityPolicy.capabilities.includes("fs:write"), false);
  assert.equal(writeExplanation.safety.boundary, "workspace-path-enforced");
  assert.equal(writeExplanation.catalog.operation, "write");
  assert.equal(writeExplanation.registry.name, "write");
  assert.equal(writeExplanation.registry.run.handler, "runFileSearchOperation");

  const codexExplanation = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "explain_operation",
    operationName: "codex",
  }) as { allowed: boolean; missingPermission?: string; requiredCapabilities: string[]; missingCapabilities: string[] };
  assert.equal(codexExplanation.allowed, true);
  assert.equal(codexExplanation.missingPermission, undefined);
  assert.ok(codexExplanation.requiredCapabilities.includes("codex:write"));
  assert.deepEqual(codexExplanation.missingCapabilities, []);

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "explain_operation",
      operationName: "not_real",
    }),
    /operationName must be one of/,
  );

  const result = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex",
    prompt: "review",
    timeoutSeconds: 5,
  }) as ProcessResult;

  assert.equal(result.exitCode, 9);
  assert.match(result.stdout, /args=exec -/);
  assert.match(result.stdout, new RegExp(`cwd=${escapeRegExp(resolvedWorkspaceRoot)}`));
  assert.match(result.stdout, /stdin=review/);
  assert.equal(result.stderr, "codex-err");
  assert.equal(result.timedOut, false);

  const codexPlan = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex_plan",
    prompt: "plan operation registry cleanup",
    timeoutSeconds: 5,
  }) as {
    workflow: { id: string; type: string; promptPreview: string };
    result: ProcessResult;
    preRunChangeSummary: { isGitRepository: boolean };
    postRunChangeSummary: { isGitRepository: boolean };
    runRecord: {
      workflowId: string;
      workflowType: string;
      exitCode: number | null;
      stdoutPreview: string;
      stderrPreview: string;
      preRunChangeSummary: { isGitRepository: boolean };
      postRunChangeSummary: { isGitRepository: boolean };
    };
  };
  assert.match(codexPlan.workflow.id, /^codex_plan_/);
  assert.equal(codexPlan.workflow.type, "codex_plan");
  assert.equal(codexPlan.preRunChangeSummary.isGitRepository, true);
  assert.equal(codexPlan.postRunChangeSummary.isGitRepository, true);
  assert.equal(codexPlan.runRecord.workflowId, codexPlan.workflow.id);
  assert.equal(codexPlan.runRecord.workflowType, "codex_plan");
  assert.equal(codexPlan.runRecord.exitCode, 9);
  assert.equal(codexPlan.runRecord.preRunChangeSummary.isGitRepository, true);
  assert.equal(codexPlan.runRecord.postRunChangeSummary.isGitRepository, true);
  assert.equal(codexPlan.result.exitCode, 9);
  assert.match(codexPlan.result.stdout, /Computer Linker Codex workflow: codex_plan/);
  assert.match(codexPlan.result.stdout, /plan operation registry cleanup/);
  assert.match(codexPlan.result.stdout, /Do not edit files/);
  assert.match(codexPlan.runRecord.stdoutPreview, /Computer Linker Codex workflow: codex_plan/);
  assert.equal(codexPlan.runRecord.stderrPreview, "codex-err");

  const codexRuns = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex_runs",
    workflowId: codexPlan.workflow.id,
    maxResults: 5,
  }) as {
    runs: Array<{
      workflowId: string;
      workflowType: string;
      exitCode: number | null;
      stdoutPreview: string;
      stderrPreview: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      preRunChangeSummary: { isGitRepository: boolean };
      postRunChangeSummary: { isGitRepository: boolean };
    }>;
  };
  assert.equal(codexRuns.runs.length, 1);
  assert.equal(codexRuns.runs[0].workflowId, codexPlan.workflow.id);
  assert.equal(codexRuns.runs[0].workflowType, "codex_plan");
  assert.equal(codexRuns.runs[0].exitCode, 9);
  assert.match(codexRuns.runs[0].stdoutPreview, /plan operation registry cleanup/);
  assert.equal(codexRuns.runs[0].stderrPreview, "codex-err");
  assert.equal(codexRuns.runs[0].stdoutTruncated, false);
  assert.ok(codexRuns.runs[0].stdoutBytes > 0);
  assert.equal(codexRuns.runs[0].preRunChangeSummary.isGitRepository, true);
  assert.equal(codexRuns.runs[0].postRunChangeSummary.isGitRepository, true);

  const codexReview = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex_review",
    timeoutSeconds: 5,
  }) as { workflow: { type: string }; result: ProcessResult };
  assert.equal(codexReview.workflow.type, "codex_review");
  assert.match(codexReview.result.stdout, /Review as a code reviewer/);

  const codexFix = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex_fix",
    prompt: "fix the failing smoke test",
    timeoutSeconds: 5,
  }) as { workflow: { type: string }; result: ProcessResult };
  assert.equal(codexFix.workflow.type, "codex_fix");
  assert.match(codexFix.result.stdout, /Implement the requested fix/);

  const codexTest = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex_test",
    script: "test",
    timeoutSeconds: 5,
  }) as { workflow: { type: string }; result: ProcessResult };
  assert.equal(codexTest.workflow.type, "codex_test");
  assert.match(codexTest.result.stdout, /Prefer package script: test/);

  const codexContinue = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "codex_continue",
    workflowId: "codex_fix_previous",
    prompt: "continue from last failure",
    timeoutSeconds: 5,
  }) as { workflow: { type: string; continuedFromWorkflowId?: string }; result: ProcessResult; historyInsight: { view: string } };
  assert.equal(codexContinue.workflow.type, "codex_continue");
  assert.equal(codexContinue.workflow.continuedFromWorkflowId, "codex_fix_previous");
  assert.equal(codexContinue.historyInsight.view, "debug_bundle");
  assert.match(codexContinue.result.stdout, /Recent Computer Linker history\/debug bundle/);

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "codex_plan",
    }),
    /prompt is required/,
  );

  const packageRun = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "package_run",
    path: "src/app.ts",
    script: "test",
    scriptArgs: ["--runInBand"],
    timeoutSeconds: 5,
  }) as { packageRoot: string; packageManager: string; script: string; scriptArgs: string[]; process: ProcessResult };
  assert.equal(packageRun.packageRoot, ".");
  assert.equal(packageRun.packageManager, "pnpm");
  assert.equal(packageRun.script, "test");
  assert.deepEqual(packageRun.scriptArgs, ["--runInBand"]);
  assert.equal(packageRun.process.exitCode, 3);
  assert.match(packageRun.process.stdout, /pnpm-args=run test -- --runInBand/);
  assert.match(packageRun.process.stdout, new RegExp(`pnpm-cwd=${escapeRegExp(resolvedWorkspaceRoot)}`));
  assert.equal(packageRun.process.stderr, "pnpm-err");

  const packageStarted = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "package_start",
    path: ".",
    script: "build",
    scriptArgs: ["--production"],
    timeoutSeconds: 5,
  }) as { packageRoot: string; packageManager: string; script: string; scriptArgs: string[]; process: { processId: string; kind: string; commandPreview: string } };
  assert.equal(packageStarted.packageRoot, ".");
  assert.equal(packageStarted.packageManager, "pnpm");
  assert.equal(packageStarted.script, "build");
  assert.deepEqual(packageStarted.scriptArgs, ["--production"]);
  assert.equal(packageStarted.process.kind, "shell");
  assert.match(packageStarted.process.commandPreview, /pnpm run build -- --production/);
  const packageStartedRead = await waitForManagedProcessOutput(registry, codexEnabled, packageStarted.process.processId, "pnpm-args=run build -- --production", "pnpm-err");
  assert.equal(packageStartedRead.process.kind, "shell");
  assert.match(packageStartedRead.process.stdout, new RegExp(`pnpm-cwd=${escapeRegExp(resolvedWorkspaceRoot)}`));

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "package_run",
      script: "missing",
    }),
    /Unknown package script/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "package_run",
      script: "test",
    }),
    /shell permission is disabled/,
  );

  const policyCommand = await runWorkspaceOperation(registry, policyLimited, {
    operation: "command",
    command: "node command-output.js",
    maxOutputBytes: 50,
  }) as ProcessResult;
  assert.equal(policyCommand.exitCode, 0);
  assert.equal(policyCommand.stdout, "abcde");
  assert.equal(policyCommand.stderr, "stder");
  assert.equal(policyCommand.stdoutTruncated, true);
  assert.equal(policyCommand.stderrTruncated, true);

  const policyPackageManagerCommand = await runWorkspaceOperation(registry, policyLimited, {
    operation: "command",
    command: "pnpm test",
    maxOutputBytes: 50,
  }) as ProcessResult;
  assert.equal(policyPackageManagerCommand.exitCode, 3);
  assert.equal(policyPackageManagerCommand.stdout, "pnpm-");
  assert.equal(policyPackageManagerCommand.stdoutTruncated, true);

  const policyPackageRun = await runWorkspaceOperation(registry, policyLimited, {
    operation: "package_run",
    script: "test",
    maxOutputBytes: 80,
  }) as { packageManager: string; script: string; process: ProcessResult };
  assert.equal(policyPackageRun.packageManager, "pnpm");
  assert.equal(policyPackageRun.script, "test");
  assert.equal(policyPackageRun.process.exitCode, 3);
  assert.equal(policyPackageRun.process.stdout, "pnpm-");
  assert.equal(policyPackageRun.process.stdoutTruncated, true);

  await assert.rejects(
    () => runWorkspaceOperation(registry, policyLimited, {
      operation: "package_run",
      script: "deploy",
    }),
    /Package script denied by workspace policy \(deploy\): deploy/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, policyLimited, {
      operation: "package_start",
      script: "deploy",
    }),
    /Package script denied by workspace policy \(deploy\): deploy/,
  );

  const policyGitCommand = await runWorkspaceOperation(registry, policyLimited, {
    operation: "command",
    command: "git status",
    maxOutputBytes: 50,
  }) as ProcessResult;
  assert.equal(policyGitCommand.exitCode, 0);
  assert.equal(policyGitCommand.stdout, "on br");
  assert.equal(policyGitCommand.stdoutTruncated, true);

  await assert.rejects(
    () => runWorkspaceOperation(registry, policyLimited, {
      operation: "command",
      command: "node blocked-task.js",
    }),
    /Command permission denied by workspace policy \(node blocked\*\)/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, policyLimited, {
      operation: "command",
      command: "python -V",
    }),
    /Command permission denied by workspace policy: python -V/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, policyLimited, {
      operation: "command",
      command: "npm test && echo unsafe",
    }),
    /shell metacharacters are disabled/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, policyLimited, {
      operation: "command",
      command: "git status; echo unsafe",
    }),
    /shell metacharacters are disabled/,
  );

  const startedCodex = await runWorkspaceOperation(registry, codexOnly, {
    operation: "codex_start",
    prompt: "background review",
    timeoutSeconds: 5,
  }) as {
    process: {
      processId: string;
      kind: string;
      commandPreview: string;
    };
  };
  assert.match(startedCodex.process.processId, /^proc_/);
  assert.equal(startedCodex.process.kind, "codex");
  assert.match(startedCodex.process.commandPreview, /background review/);

  const codexProcessRead = await waitForManagedProcessOutput(
    registry,
    codexOnly,
    startedCodex.process.processId,
    "stdin=background review",
    "codex-err",
  );
  assert.equal(codexProcessRead.process.kind, "codex");
  assert.match(codexProcessRead.process.stdout, /args=exec -/);
  assert.match(codexProcessRead.process.stdout, /stdin=background review/);
  assert.equal(codexProcessRead.process.stderr, "codex-err");

  const codexProcessList = await runWorkspaceOperation(registry, codexOnly, {
    operation: "process_list",
  }) as { processes: Array<{ processId: string; kind: string }> };
  assert.ok(codexProcessList.processes.some((process) => (
    process.processId === startedCodex.process.processId &&
    process.kind === "codex"
  )));

  const pathWithFakeTools = process.env.PATH;
  process.env.PATH = emptyPathDir;
  try {
    const missingCodexStarted = await runWorkspaceOperation(registry, codexOnly, {
      operation: "codex_start",
      prompt: "missing codex",
      timeoutSeconds: 5,
    }) as { process: { processId: string; kind: string } };
    assert.match(missingCodexStarted.process.processId, /^proc_/);
    assert.equal(missingCodexStarted.process.kind, "codex");

    const missingCodexRead = await waitForManagedProcessStatus(
      registry,
      codexOnly,
      missingCodexStarted.process.processId,
      "exited",
    );
    assert.equal(missingCodexRead.process.kind, "codex");
    assert.equal(missingCodexRead.process.exitCode, null);
    assert.match(missingCodexRead.process.stderr, /process failed to start/);
    assert.match(missingCodexRead.process.stderr, /codex|ENOENT|not found/i);

    const missingPackageStarted = await runWorkspaceOperation(registry, codexEnabled, {
      operation: "package_start",
      script: "build",
      timeoutSeconds: 5,
    }) as { process: { processId: string; kind: string } };
    assert.match(missingPackageStarted.process.processId, /^proc_/);
    assert.equal(missingPackageStarted.process.kind, "shell");

    const missingPackageRead = await waitForManagedProcessStatus(
      registry,
      codexEnabled,
      missingPackageStarted.process.processId,
      "exited",
    );
    assert.equal(missingPackageRead.process.kind, "shell");
    assert.equal(missingPackageRead.process.exitCode, null);
    assert.match(missingPackageRead.process.stderr, /process failed to start/);
    assert.match(missingPackageRead.process.stderr, /pnpm|ENOENT|not found/i);
  } finally {
    if (pathWithFakeTools === undefined) delete process.env.PATH;
    else process.env.PATH = pathWithFakeTools;
  }

  const repoStatus = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "repo_status",
    includeDiff: true,
    maxBytes: 32,
  }) as {
    isGitRepository: boolean;
    status: string;
    diffStat: string;
    stagedDiffStat: string;
    diff: string;
    diffTruncated: boolean;
    diffRedacted: boolean;
    diffRedactedPaths: string[];
    stagedDiff: string;
    stagedDiffTruncated: boolean;
    stagedDiffRedacted: boolean;
    stagedDiffRedactedPaths: string[];
  };

  assert.equal(repoStatus.isGitRepository, true);
  assert.match(repoStatus.status, /## main/);
  assert.match(repoStatus.diffStat, /src\/app\.ts/);
  assert.match(repoStatus.stagedDiffStat, /staged\.ts/);
  assert.equal(repoStatus.diff.length, 32);
  assert.equal(repoStatus.diffTruncated, true);
  assert.equal(repoStatus.diffRedacted, true);
  assert.deepEqual(repoStatus.diffRedactedPaths, [".env"]);
  assert.match(repoStatus.stagedDiff, /staged/);
  assert.equal(repoStatus.stagedDiffTruncated, true);
  assert.equal(repoStatus.stagedDiffRedacted, false);
  assert.deepEqual(repoStatus.stagedDiffRedactedPaths, []);

  const summary = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "change_summary",
    maxBytes: 10,
  }) as {
    isGitRepository: boolean;
    branchLine: string;
    clean: boolean;
    counts: { total: number; staged: number; unstaged: number; untracked: number; ignored: number };
    entries: Array<{ path: string; staged: boolean; unstaged: boolean; untracked: boolean }>;
    diffStat: string;
    stagedDiffStat: string;
    diffStatTruncated: boolean;
    stagedDiffStatTruncated: boolean;
  };
  assert.equal(summary.isGitRepository, true);
  assert.equal(summary.branchLine, "main...origin/main [ahead 1]");
  assert.equal(summary.clean, false);
  assert.deepEqual(summary.counts, { total: 4, staged: 2, unstaged: 1, untracked: 1, ignored: 0 });
  assert.ok(summary.entries.some((entry) => entry.path === "src/app.ts" && entry.unstaged));
  assert.ok(summary.entries.some((entry) => entry.path === "notes.md" && entry.untracked));
  assert.equal(summary.diffStat.length, 10);
  assert.equal(summary.stagedDiffStat.length, 10);
  assert.equal(summary.diffStatTruncated, true);
  assert.equal(summary.stagedDiffStatTruncated, true);

  const gitChanges = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_changes",
  }) as {
    isGitRepository: boolean;
    branchLine: string;
    clean: boolean;
    counts: { total: number; staged: number; unstaged: number; untracked: number; ignored: number };
    entries: Array<{
      path: string;
      originalPath?: string;
      rawStatus: string;
      indexStatus?: string;
      workingTreeStatus?: string;
      staged: boolean;
      unstaged: boolean;
      untracked: boolean;
      ignored: boolean;
    }>;
  };
  assert.equal(gitChanges.isGitRepository, true);
  assert.equal(gitChanges.branchLine, "main...origin/main [ahead 1]");
  assert.equal(gitChanges.clean, false);
  assert.deepEqual(gitChanges.counts, { total: 4, staged: 2, unstaged: 1, untracked: 1, ignored: 0 });
  assert.ok(gitChanges.entries.some((entry) => (
    entry.path === "src/app.ts" &&
    entry.rawStatus === " M" &&
    entry.workingTreeStatus === "modified" &&
    entry.unstaged
  )));
  assert.ok(gitChanges.entries.some((entry) => (
    entry.path === "staged.ts" &&
    entry.rawStatus === "M " &&
    entry.indexStatus === "modified" &&
    entry.staged
  )));
  assert.ok(gitChanges.entries.some((entry) => entry.path === "notes.md" && entry.untracked));
  assert.ok(gitChanges.entries.some((entry) => (
    entry.path === "new-name.ts" &&
    entry.originalPath === "old-name.ts" &&
    entry.indexStatus === "renamed"
  )));

  const gitDiff = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_diff",
    paths: ["src/app.ts"],
    maxBytes: 20,
  }) as { isGitRepository: boolean; staged: boolean; paths: string[]; pathspecs: string[]; diff: string; sizeBytes: number; truncated: boolean };
  assert.equal(gitDiff.isGitRepository, true);
  assert.equal(gitDiff.staged, false);
  assert.deepEqual(gitDiff.paths, ["src/app.ts"]);
  assert.deepEqual(gitDiff.pathspecs, ["src/app.ts"]);
  assert.equal(gitDiff.diff.length, 20);
  assert.equal(gitDiff.truncated, true);
  assert.ok(gitDiff.sizeBytes > 20);

  const subdirGitDiff = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_diff",
    path: "src",
    paths: ["src/app.ts"],
  }) as { paths: string[]; pathspecs: string[]; diff: string };
  assert.deepEqual(subdirGitDiff.paths, ["src/app.ts"]);
  assert.deepEqual(subdirGitDiff.pathspecs, ["app.ts"]);
  assert.match(subdirGitDiff.diff, /subdir-relative/);

  const repositoryGitDiff = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_diff",
    maxBytes: 4096,
  }) as { diff: string; redacted: boolean; redactedPaths: string[] };
  assert.match(repositoryGitDiff.diff, /changed/);
  assert.equal(repositoryGitDiff.redacted, true);
  assert.deepEqual(repositoryGitDiff.redactedPaths, [".env"]);
  assert.match(repositoryGitDiff.diff, /redacted this Git diff block/);
  assert.doesNotMatch(repositoryGitDiff.diff, /repo-secret/);

  const sensitivePathGitDiff = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_diff",
    paths: [".env"],
    maxBytes: 4096,
  }) as { diff: string; redacted: boolean; redactedPaths: string[] };
  assert.equal(sensitivePathGitDiff.redacted, true);
  assert.deepEqual(sensitivePathGitDiff.redactedPaths, [".env"]);
  assert.match(sensitivePathGitDiff.diff, /diff --git a\/.env b\/.env/);
  assert.doesNotMatch(sensitivePathGitDiff.diff, /path-secret/);

  const stagedGitDiff = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_diff",
    paths: ["staged.ts"],
    staged: true,
  }) as { isGitRepository: boolean; staged: boolean; diff: string; truncated: boolean };
  assert.equal(stagedGitDiff.isGitRepository, true);
  assert.equal(stagedGitDiff.staged, true);
  assert.match(stagedGitDiff.diff, /staged-specific/);
  assert.equal(stagedGitDiff.truncated, false);

  const gitLog = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_log",
    maxResults: 2,
  }) as {
    isGitRepository: boolean;
    commits: Array<{ hash: string; shortHash: string; authorName: string; authorEmail: string; authoredAt: string; subject: string }>;
  };
  assert.equal(gitLog.isGitRepository, true);
  assert.equal(gitLog.commits.length, 2);
  assert.equal(gitLog.commits[0].hash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(gitLog.commits[0].shortHash, "aaaaaaa");
  assert.equal(gitLog.commits[0].authorName, "Alice");
  assert.equal(gitLog.commits[0].authorEmail, "alice@example.com");
  assert.equal(gitLog.commits[0].authoredAt, "2026-01-02T03:04:05+00:00");
  assert.equal(gitLog.commits[0].subject, "Initial app");

  const filteredGitLog = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_log",
    paths: ["src/app.ts"],
    maxResults: 1,
  }) as { paths: string[]; pathspecs: string[]; commits: Array<{ subject: string }> };
  assert.deepEqual(filteredGitLog.paths, ["src/app.ts"]);
  assert.deepEqual(filteredGitLog.pathspecs, ["src/app.ts"]);
  assert.deepEqual(filteredGitLog.commits.map((commit) => commit.subject), ["Touch src app"]);

  const gitShow = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_show",
    maxBytes: 30,
  }) as { isGitRepository: boolean; ref: string; output: string; sizeBytes: number; truncated: boolean };
  assert.equal(gitShow.isGitRepository, true);
  assert.equal(gitShow.ref, "HEAD");
  assert.equal(gitShow.output.length, 30);
  assert.equal(gitShow.truncated, true);
  assert.ok(gitShow.sizeBytes > 30);

  const fullGitShow = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_show",
    maxBytes: 4096,
  }) as { output: string; redacted: boolean; redactedPaths: string[] };
  assert.match(fullGitShow.output, /path-specific-show/);
  assert.equal(fullGitShow.redacted, true);
  assert.deepEqual(fullGitShow.redactedPaths, [".env"]);
  assert.doesNotMatch(fullGitShow.output, /show-secret/);

  const filteredGitShow = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_show",
    ref: "abc123",
    paths: ["src/app.ts"],
  }) as { ref: string; paths: string[]; pathspecs: string[]; output: string; truncated: boolean };
  assert.equal(filteredGitShow.ref, "abc123");
  assert.deepEqual(filteredGitShow.paths, ["src/app.ts"]);
  assert.deepEqual(filteredGitShow.pathspecs, ["src/app.ts"]);
  assert.match(filteredGitShow.output, /filtered-show/);
  assert.equal(filteredGitShow.truncated, false);

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_show",
      ref: "-bad",
    }),
    /ref is not allowed/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_show",
      ref: "HEAD:.env",
    }),
    /ref is not allowed/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_diff",
      paths: ["../outside.ts"],
    }),
    /outside workspace/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_log",
      paths: ["../outside.ts"],
    }),
    /outside workspace/,
  );

  const stagedPath = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "git_stage",
    paths: ["src/app.ts"],
  }) as { isGitRepository: boolean; action: string; paths: string[]; pathspecs: string[]; updated: boolean; process: ProcessResult };
  assert.equal(stagedPath.isGitRepository, true);
  assert.equal(stagedPath.action, "stage");
  assert.deepEqual(stagedPath.paths, ["src/app.ts"]);
  assert.deepEqual(stagedPath.pathspecs, ["src/app.ts"]);
  assert.equal(stagedPath.updated, true);
  assert.match(stagedPath.process.stdout, /staged add -- src\/app\.ts/);

  const unstagedPath = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "git_unstage",
    paths: ["staged.ts"],
  }) as { isGitRepository: boolean; action: string; paths: string[]; pathspecs: string[]; updated: boolean; process: ProcessResult };
  assert.equal(unstagedPath.isGitRepository, true);
  assert.equal(unstagedPath.action, "unstage");
  assert.deepEqual(unstagedPath.paths, ["staged.ts"]);
  assert.deepEqual(unstagedPath.pathspecs, ["staged.ts"]);
  assert.equal(unstagedPath.updated, true);
  assert.match(unstagedPath.process.stdout, /unstaged restore --staged -- staged\.ts/);

  const committed = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "git_commit",
    message: "localport test commit",
  }) as { isGitRepository: boolean; committed: boolean; repositoryRoot: string; stagedPaths: string[]; process: ProcessResult };
  assert.equal(committed.isGitRepository, true);
  assert.equal(committed.committed, true);
  assert.equal(committed.repositoryRoot, resolvedWorkspaceRoot);
  assert.deepEqual(committed.stagedPaths, ["src/app.ts", "staged.ts"]);
  assert.match(committed.process.stdout, /localport test commit/);

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_commit",
      message: "blocked",
    }),
    /write permission is disabled/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_stage",
      paths: ["src/app.ts"],
    }),
    /write permission is disabled/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "git_stage",
      paths: [],
    }),
    /paths is required/,
  );

  const writableRead = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "read",
    path: "src/lines.ts",
    maxBytes: 5,
  }) as { content: string; encoding: string; sha256: string; truncated: boolean };
  assert.equal(writableRead.content, "line1");
  assert.equal(writableRead.encoding, "utf8");
  assert.equal(writableRead.truncated, true);
  assert.match(writableRead.sha256, /^[a-f0-9]{64}$/);
  assert.equal(writableRead.sha256, sha256("line1\nline2\nline3\nline4\n"));

  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "read",
      path: "binary.bin",
    }),
    /not valid UTF-8/,
  );
  const binaryRead = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "read",
    path: "binary.bin",
    encoding: "base64",
    maxBytes: 3,
  }) as { content: string; encoding: string; sizeBytes: number; sha256: string; truncated: boolean };
  assert.equal(binaryRead.encoding, "base64");
  assert.equal(binaryRead.content, binaryFixture.subarray(0, 3).toString("base64"));
  assert.equal(binaryRead.sizeBytes, binaryFixture.length);
  assert.equal(binaryRead.sha256, sha256(binaryFixture));
  assert.equal(binaryRead.truncated, true);
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "read",
      path: "binary.bin",
      encoding: "base64",
      startLine: 1,
    }),
    /startLine and lineCount/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "read",
      path: "src/lines.ts",
      encoding: "hex",
    }),
    /encoding must be one of/,
  );
  const binaryReadMany = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "read_many",
    paths: ["binary.bin"],
    encoding: "base64",
    maxBytes: 2,
  }) as { files: Array<{ content: string; encoding: string; sizeBytes: number; sha256: string; truncated: boolean }> };
  assert.equal(binaryReadMany.files[0]?.encoding, "base64");
  assert.equal(binaryReadMany.files[0]?.content, binaryFixture.subarray(0, 2).toString("base64"));
  assert.equal(binaryReadMany.files[0]?.sizeBytes, binaryFixture.length);
  assert.equal(binaryReadMany.files[0]?.sha256, sha256(binaryFixture));
  assert.equal(binaryReadMany.files[0]?.truncated, true);

  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "read",
      path: ".env",
    }),
    /Sensitive file read is blocked by default/,
  );
  const sensitiveList = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "list_details",
    path: ".",
  }) as { entries: Array<{ path: string; name: string }> };
  assert.equal(sensitiveList.entries.some((entry) => entry.name === ".env"), false);
  assert.equal(sensitiveList.entries.some((entry) => entry.name === ".ssh"), false);
  assert.ok(sensitiveList.entries.some((entry) => entry.name === ".env.example"));
  const sensitiveTree = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "tree",
    path: ".",
    maxDepth: 3,
    maxEntries: 100,
  }) as { entries: Array<{ path: string }> };
  assert.equal(sensitiveTree.entries.some((entry) => entry.path === ".env"), false);
  assert.equal(sensitiveTree.entries.some((entry) => entry.path.startsWith(".ssh")), false);
  assert.ok(sensitiveTree.entries.some((entry) => entry.path === ".env.example"));
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "stat",
      path: ".env",
    }),
    /Sensitive path stat metadata is hidden by default/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "list_details",
      path: ".ssh",
    }),
    /Sensitive path list metadata is hidden by default/,
  );
  const envExampleRead = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "read",
    path: ".env.example",
  }) as { content: string };
  assert.equal(envExampleRead.content, "EXAMPLE_SETTING=example\n");
  const envExampleWrite = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "write",
    path: ".env.example",
    content: "EXAMPLE_SETTING=updated\n",
  }) as { path: string };
  assert.equal(envExampleWrite.path, ".env.example");
  assert.equal(await readFile(join(workspaceRoot, ".env.example"), "utf8"), "EXAMPLE_SETTING=updated\n");
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "write",
      path: "missing-parent/write.txt",
      content: "no implicit parents\n",
    }),
    /Parent directory does not exist/,
  );
  const parentWrite = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "write",
    path: "missing-parent/write.txt",
    content: "explicit parents\n",
    createParents: true,
  }) as { path: string };
  assert.equal(parentWrite.path, "missing-parent/write.txt");
  assert.equal(await readFile(join(workspaceRoot, "missing-parent", "write.txt"), "utf8"), "explicit parents\n");
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "write",
      path: ".env",
      content: "SECRET=leak\n",
    }),
    /Sensitive path write is blocked by default/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "create_file",
      path: "credentials.json",
      content: "{}\n",
    }),
    /Sensitive path create is blocked by default/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "write_if_unchanged",
      path: ".env",
      content: "SECRET=changed\n",
      expectedSha256: "0".repeat(64),
    }),
    /Sensitive path write is blocked by default/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "patch",
      patch: [
        "diff --git a/.env b/.env",
        "--- a/.env",
        "+++ b/.env",
        "@@ -1 +1 @@",
        "-HIDDEN_SETTING=blocked-value",
        "+HIDDEN_SETTING=changed",
        "",
      ].join("\n"),
    }),
    /Sensitive path patch is blocked by default/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "delete",
      path: "sensitive-parent",
      recursive: true,
    }),
    /contains sensitive-parent\/\.env/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "move",
      fromPath: "sensitive-parent",
      toPath: "moved-sensitive-parent",
    }),
    /contains sensitive-parent\/\.env/,
  );
  assert.equal(await readFile(join(workspaceRoot, "sensitive-parent", ".env"), "utf8"), "nested-secret\n");
  const optInSensitiveList = await runWorkspaceOperation(registry, sensitiveOptIn, {
    operation: "list_details",
    path: ".",
  }) as { entries: Array<{ name: string }> };
  assert.ok(optInSensitiveList.entries.some((entry) => entry.name === ".env"));
  assert.ok(optInSensitiveList.entries.some((entry) => entry.name === ".ssh"));
  const optInWrite = await runWorkspaceOperation(registry, sensitiveOptIn, {
    operation: "write",
    path: ".env",
    content: "HIDDEN_SETTING=updated\n",
  }) as { path: string };
  assert.equal(optInWrite.path, ".env");
  assert.equal(await readFile(join(workspaceRoot, ".env"), "utf8"), "HIDDEN_SETTING=updated\n");
  const optInReadForHash = await runWorkspaceOperation(registry, sensitiveOptIn, {
    operation: "write_if_unchanged",
    path: ".env",
    content: "HIDDEN_SETTING=changed-again\n",
    expectedSha256: sha256("HIDDEN_SETTING=updated\n"),
  }) as { written: boolean; conflict: boolean };
  assert.equal(optInReadForHash.written, true);
  assert.equal(optInReadForHash.conflict, false);
  assert.equal(await readFile(join(workspaceRoot, ".env"), "utf8"), "HIDDEN_SETTING=changed-again\n");

  const createdFile = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "create_file",
    path: "created-by-create-file.txt",
    content: "created once\n",
  }) as { path: string; created: boolean; sizeBytes: number; sha256: string };
  assert.equal(createdFile.path, "created-by-create-file.txt");
  assert.equal(createdFile.created, true);
  assert.equal(createdFile.sizeBytes, "created once\n".length);
  assert.match(createdFile.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(workspaceRoot, "created-by-create-file.txt"), "utf8"), "created once\n");
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "create_file",
      path: "missing-create/created.txt",
      content: "no implicit parents\n",
    }),
    /Parent directory does not exist/,
  );
  const parentCreate = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "create_file",
    path: "missing-create/created.txt",
    content: "explicit create parents\n",
    createParents: true,
  }) as { path: string; created: boolean };
  assert.equal(parentCreate.path, "missing-create/created.txt");
  assert.equal(parentCreate.created, true);
  assert.equal(await readFile(join(workspaceRoot, "missing-create", "created.txt"), "utf8"), "explicit create parents\n");
  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "create_file",
      path: "created-by-create-file.txt",
      content: "do not overwrite\n",
    }),
    /File already exists/,
  );
  assert.equal(await readFile(join(workspaceRoot, "created-by-create-file.txt"), "utf8"), "created once\n");

  const compareWrite = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "write_if_unchanged",
    path: "src/lines.ts",
    content: "updated\n",
    expectedSha256: writableRead.sha256,
  }) as { written: boolean; conflict: boolean; previousSha256: string; sha256: string };
  assert.equal(compareWrite.written, true);
  assert.equal(compareWrite.conflict, false);
  assert.equal(compareWrite.previousSha256, writableRead.sha256);
  assert.match(compareWrite.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(workspaceRoot, "src/lines.ts"), "utf8"), "updated\n");

  const staleCompareWrite = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "write_if_unchanged",
    path: "src/lines.ts",
    content: "should-not-write\n",
    expectedSha256: writableRead.sha256,
  }) as { written: boolean; conflict: boolean; currentSha256: string; expectedSha256: string };
  assert.equal(staleCompareWrite.written, false);
  assert.equal(staleCompareWrite.conflict, true);
  assert.notEqual(staleCompareWrite.currentSha256, staleCompareWrite.expectedSha256);
  assert.equal(await readFile(join(workspaceRoot, "src/lines.ts"), "utf8"), "updated\n");
  await writeFile(join(workspaceRoot, "src/lines.ts"), "line1\nline2\nline3\nline4\n", "utf8");

  const context = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "coding_context",
    path: "src/app.ts",
    maxDepth: 2,
    maxEntries: 50,
    maxResults: 10,
    maxBytes: 128,
  }) as {
    path: string;
    overview: { packageName: string; suggestedNextOperations: string[] };
    instructions: Array<{ path: string; content: string }>;
    tree: Array<{ path: string; type: string }>;
    agentSkills: { skills: Array<{ name: string; path: string }> };
    changeSummary: { isGitRepository: boolean; counts: { total: number } };
  };
  assert.equal(context.path, "src");
  assert.equal(context.overview.packageName, "overview-app");
  assert.ok(context.overview.suggestedNextOperations.includes("coding_context"));
  assert.deepEqual(context.instructions.map((entry) => entry.path), ["AGENTS.md"]);
  assert.equal(context.instructions[0].content, "test guidance\n");
  assert.ok(context.tree.some((entry) => entry.path === "src/app.ts" && entry.type === "file"));
  assert.ok(context.agentSkills.skills.some((skill) => skill.name === "refactor" && skill.path === ".codex/skills/refactor/SKILL.md"));
  assert.equal(context.changeSummary.isGitRepository, true);
  assert.equal(context.changeSummary.counts.total, 4);

  const agentSkills = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "agent_skills",
    maxResults: 10,
  }) as {
    scope: string;
    searchedRoots: string[];
    skills: Array<{ name: string; path: string; title: string; description?: string; truncated: boolean }>;
  };
  assert.equal(agentSkills.scope, "workspace");
  assert.deepEqual(agentSkills.searchedRoots, [".codex/skills", ".claude/skills"]);
  assert.ok(agentSkills.skills.some((skill) => (
    skill.name === "refactor" &&
    skill.path === ".codex/skills/refactor/SKILL.md" &&
    skill.title === "Refactor Skill" &&
    skill.description === "Refactor TypeScript modules safely." &&
    skill.truncated === false
  )));
  assert.ok(agentSkills.skills.some((skill) => (
    skill.name === "review" &&
    skill.path === ".claude/skills/review/SKILL.md" &&
    skill.title === "Review Skill" &&
    skill.description === "Find correctness issues before merge."
  )));

  const limitedAgentSkills = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "agent_skills",
    maxResults: 1,
  }) as { skills: Array<{ name: string }> };
  assert.equal(limitedAgentSkills.skills.length, 1);

  const worktreeList = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "git_worktree_list",
  }) as { isGitRepository: boolean; worktrees: Array<{ path: string; head: string; branch: string }> };
  assert.equal(worktreeList.isGitRepository, true);
  assert.deepEqual(worktreeList.worktrees, [
    { path: "/repo/main", head: "abc123", branch: "refs/heads/main" },
    { path: "/repo/feature", head: "def456", branch: "refs/heads/feature-a" },
  ]);

  const createdWorktree = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "git_worktree_create",
    toPath: "feature-a-worktree",
    branch: "feature-a",
    startPoint: "HEAD",
  }) as { created: boolean; targetPath: string; branch: string; startPoint: string; process: ProcessResult };
  assert.equal(createdWorktree.created, true);
  assert.equal(createdWorktree.targetPath, "feature-a-worktree");
  assert.equal(createdWorktree.branch, "feature-a");
  assert.equal(createdWorktree.startPoint, "HEAD");
  assert.match(createdWorktree.process.stdout, /worktree add -b feature-a/);
  assert.match(createdWorktree.process.stdout, /feature-a-worktree/);

  await assert.rejects(
    () => runWorkspaceOperation(registry, codexEnabled, {
      operation: "git_worktree_create",
      toPath: "blocked-worktree",
      branch: "blocked",
      startPoint: "HEAD",
    }),
    /write permission is disabled/,
  );

  await assert.rejects(
    () => runWorkspaceOperation(registry, worktreeEnabled, {
      operation: "git_worktree_create",
      toPath: "../outside-worktree",
      branch: "bad",
      startPoint: "HEAD",
    }),
    /outside workspace/,
  );

  const overview = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "project_overview",
    maxDepth: 2,
    maxEntries: 50,
  }) as {
    path: string;
    projectRoot: string;
    packageName: string;
    packageType: string;
    packageManagers: string[];
    packageScripts: string[];
    configFiles: string[];
    instructionFiles: string[];
    languages: Array<{ language: string; files: number }>;
    git: { detected: boolean };
    suggestedNextOperations: string[];
  };

  assert.equal(overview.path, ".");
  assert.equal(overview.projectRoot, ".");
  assert.equal(overview.packageName, "overview-app");
  assert.equal(overview.packageType, "module");
  assert.deepEqual(overview.packageManagers, ["pnpm"]);
  assert.deepEqual(overview.packageScripts, ["build", "deploy", "test"]);
  assert.ok(overview.configFiles.includes("package.json"));
  assert.ok(overview.configFiles.includes("tsconfig.json"));
  assert.deepEqual(overview.instructionFiles, ["AGENTS.md"]);
  assert.ok(overview.languages.some((language) => language.language === "TypeScript" && language.files === 2));
  assert.equal(overview.git.detected, false);
  assert.ok(overview.suggestedNextOperations.includes("agent_skills"));
  assert.ok(overview.suggestedNextOperations.includes("codex_review"));
  assert.ok(overview.suggestedNextOperations.includes("codex_fix"));
  assert.ok(overview.suggestedNextOperations.includes("codex"));
  assert.ok(overview.suggestedNextOperations.includes("process_start"));
  assert.ok(overview.suggestedNextOperations.includes("search_symbols"));

  const symbols = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "search_symbols",
    path: ".",
    query: "Workspace",
    glob: "*.ts",
    maxResults: 10,
  }) as {
    symbols: Array<{ path: string; line: number; column: number; name: string; kind: string; signature: string }>;
  };
  assert.ok(symbols.symbols.some((symbol) => (
    symbol.path === "src/app.ts" &&
    symbol.name === "WorkspaceRunner" &&
    symbol.kind === "class" &&
    symbol.signature === "export class WorkspaceRunner {}"
  )));
  assert.ok(symbols.symbols.some((symbol) => (
    symbol.path === "src/app.ts" &&
    symbol.name === "openWorkspace" &&
    symbol.kind === "function"
  )));

  const rangedRead = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "read",
    path: "src/lines.ts",
    startLine: 2,
    lineCount: 2,
  }) as {
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    truncated: boolean;
  };
  assert.equal(rangedRead.content, "line2\nline3");
  assert.equal(rangedRead.startLine, 2);
  assert.equal(rangedRead.endLine, 3);
  assert.equal(rangedRead.totalLines, 5);
  assert.equal(rangedRead.truncated, false);

  const batch = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "batch",
    continueOnError: true,
    operations: [
      { operation: "read", path: "src/lines.ts", startLine: 1, lineCount: 1 },
      { operation: "write", path: "blocked.txt", content: "blocked" },
      { operation: "search_text", query: "value", glob: "src/app.ts", maxResults: 5 },
    ],
  }) as {
    completed: boolean;
    attempted: number;
    succeeded: number;
    failed: number;
    stoppedOnError: boolean;
    continueOnError: boolean;
    nonAtomic: boolean;
    sideEffects: string;
    retryGuidance: string;
    results: Array<{ index: number; operation: string; ok: boolean; data?: any; error?: string }>;
  };
  assert.equal(batch.completed, false);
  assert.equal(batch.attempted, 3);
  assert.equal(batch.succeeded, 2);
  assert.equal(batch.failed, 1);
  assert.equal(batch.stoppedOnError, false);
  assert.equal(batch.continueOnError, true);
  assert.equal(batch.nonAtomic, true);
  assert.equal(batch.sideEffects, "ordered-non-atomic");
  assert.match(batch.retryGuidance, /not atomic/i);
  assert.equal(batch.results.length, 3);
  assert.equal(batch.results[0].ok, true);
  assert.equal(batch.results[0].data.content, "line1");
  assert.equal(batch.results[1].ok, false);
  assert.match(batch.results[1].error ?? "", /write permission is disabled/);
  assert.equal(batch.results[2].ok, true);
  assert.match(batch.results[2].data.matches.join("\n"), /src\/app\.ts/);
  const batchAuditEvents = readAuditEvents({ tool: "workspace_operation.batch_item" });
  assert.equal(batchAuditEvents.length, 3);
  assert.ok(batchAuditEvents.some((event) => (
    event.success === true &&
    event.workspaceId === "codex-enabled" &&
    event.path === "src/lines.ts" &&
    event.detail === "batch[0]: read"
  )));
  assert.ok(batchAuditEvents.some((event) => (
    event.success === false &&
    event.path === "blocked.txt" &&
    event.detail === "batch[1]: write" &&
    event.error?.includes("write permission is disabled")
  )));
  assert.ok(batchAuditEvents.some((event) => (
    event.success === true &&
    event.detail === "batch[2]: search_text"
  )));

  const stoppedBatch = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "batch",
    operations: [
      { operation: "write", path: "blocked.txt", content: "blocked" },
      { operation: "read", path: "src/lines.ts" },
    ],
  }) as { completed: boolean; attempted: number; succeeded: number; failed: number; stoppedOnError: boolean; continueOnError: boolean; results: Array<{ ok: boolean }> };
  assert.equal(stoppedBatch.completed, false);
  assert.equal(stoppedBatch.attempted, 1);
  assert.equal(stoppedBatch.succeeded, 0);
  assert.equal(stoppedBatch.failed, 1);
  assert.equal(stoppedBatch.stoppedOnError, true);
  assert.equal(stoppedBatch.continueOnError, false);
  assert.equal(stoppedBatch.results.length, 1);

  const sideEffectBatch = await runWorkspaceOperation(registry, worktreeEnabled, {
    operation: "batch",
    operations: [
      { operation: "write", path: "batch-side-effect.txt", content: "written before failure\n" },
      { operation: "read", path: "../outside.txt" },
      { operation: "write", path: "batch-side-effect-skipped.txt", content: "should not run\n" },
    ],
  }) as { completed: boolean; attempted: number; succeeded: number; failed: number; stoppedOnError: boolean; results: Array<{ ok: boolean; error?: string }> };
  assert.equal(sideEffectBatch.completed, false);
  assert.equal(sideEffectBatch.attempted, 2);
  assert.equal(sideEffectBatch.succeeded, 1);
  assert.equal(sideEffectBatch.failed, 1);
  assert.equal(sideEffectBatch.stoppedOnError, true);
  assert.equal(sideEffectBatch.results[0].ok, true);
  assert.equal(sideEffectBatch.results[1].ok, false);
  assert.match(sideEffectBatch.results[1].error ?? "", /outside workspace/);
  assert.equal(await readFile(join(workspaceRoot, "batch-side-effect.txt"), "utf8"), "written before failure\n");
  assert.equal(existsSync(join(workspaceRoot, "batch-side-effect-skipped.txt")), false);
  const batchReplay = workspaceOperationAuditFields({
    operation: "batch",
    operations: [
      { operation: "write", path: "batch-side-effect.txt", content: "written before failure\n" },
      { operation: "read", path: "../outside.txt" },
    ],
  }).replay;
  assert.equal(batchReplay?.replayable, false);
  assert.match(batchReplay?.reason ?? "", /non-atomic/i);
  assert.deepEqual(batchReplay?.requiresInput, ["operations", "userConfirmation"]);

  const processCommand = "node process-output.js";
  const started = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "process_start",
    command: processCommand,
  }) as {
    process: {
      processId: string;
      status: string;
      commandPreview: string;
    };
  };
  assert.match(started.process.processId, /^proc_/);
  assert.equal(started.process.status, "running");
  assert.equal(started.process.commandPreview, processCommand);

  const processRead = await waitForProcessOutput(registry, codexEnabled, started.process.processId);
  assert.equal(processRead.process.status, "running");
  assert.equal(processRead.process.stdout, "process-out");
  assert.equal(processRead.process.stderr, "process-err");

  const missingShellStarted = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "process_start",
    command: "computer-linker-missing-command-for-test",
    timeoutSeconds: 5,
  }) as { process: { processId: string; status: string; commandPreview: string } };
  assert.match(missingShellStarted.process.processId, /^proc_/);
  assert.equal(missingShellStarted.process.status, "running");
  assert.equal(missingShellStarted.process.commandPreview, "computer-linker-missing-command-for-test");
  const missingShellRead = await waitForManagedProcessStatus(
    registry,
    codexEnabled,
    missingShellStarted.process.processId,
    "exited",
  );
  assert.notEqual(missingShellRead.process.exitCode, 0);
  assert.match(`${missingShellRead.process.stdout}\n${missingShellRead.process.stderr}`, /computer-linker-missing-command-for-test|not found|not recognized/i);

  const processList = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "process_list",
  }) as { processes: Array<{ processId: string }> };
  assert.ok(processList.processes.some((process) => process.processId === started.process.processId));

  const stopped = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "process_stop",
    processId: started.process.processId,
  }) as { process: { status: string; signal?: string } };
  assert.equal(stopped.process.status, "exited");
  if (process.platform !== "win32") {
    assert.equal(stopped.process.signal, "SIGTERM");
  }

  if (process.platform !== "win32") {
    const childStarted = await runWorkspaceOperation(registry, codexEnabled, {
      operation: "process_start",
      command: "node child-signal.js",
    }) as { process: { processId: string } };
    await waitForFile(join(workspaceRoot, "child-ready.txt"), "ready");
    await runWorkspaceOperation(registry, codexEnabled, {
      operation: "process_stop",
      processId: childStarted.process.processId,
    });
    await waitForFile(join(workspaceRoot, "child-signal.txt"), "term");
  }

  const stubbornStarted = await runWorkspaceOperation(registry, codexEnabled, {
    operation: "process_start",
    command: "node child-ignore-term.js",
  }) as { process: { processId: string } };
  const stubbornPid = Number(await waitForFileContent(join(workspaceRoot, "child-ignore-ready.txt")));
  assert.equal(Number.isInteger(stubbornPid) && stubbornPid > 0, true);
  await runWorkspaceOperation(registry, codexEnabled, {
    operation: "process_stop",
    processId: stubbornStarted.process.processId,
  });
  await waitForProcessGone(stubbornPid);

  const codexDisabled = await registry.openWorkspace("codex-disabled");
  await assert.rejects(
    () => runWorkspaceOperation(registry, codexDisabled, { operation: "codex", prompt: "blocked" }),
    /codex permission is disabled/,
  );
  await assert.rejects(
    () => runWorkspaceOperation(registry, codexDisabled, { operation: "codex_fix", prompt: "blocked" }),
    /codex permission is disabled/,
  );
} finally {
  process.env.PATH = originalPath;
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;
  await rm(root, { recursive: true, force: true });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeFakeTool(binDir: string, name: string, lines: string[]): Promise<void> {
  const source = lines.join("\n");
  if (process.platform === "win32") {
    const scriptPath = join(binDir, `${name}.cjs`);
    const commandPath = join(binDir, `${name}.cmd`);
    await writeFile(scriptPath, source, "utf8");
    await writeFile(commandPath, [
      "@echo off",
      `"${process.execPath}" "%~dp0\\${name}.cjs" %*`,
      "exit /b %ERRORLEVEL%",
      "",
    ].join("\r\n"), "utf8");
    return;
  }

  const executablePath = join(binDir, name);
  await writeFile(executablePath, [
    "#!/usr/bin/env node",
    source,
  ].join("\n"), "utf8");
  await chmod(executablePath, 0o755);
}

async function waitForProcessOutput(
  registry: WorkspaceRegistry,
  workspace: Awaited<ReturnType<WorkspaceRegistry["openWorkspace"]>>,
  processId: string,
): Promise<{ process: { status: string; stdout: string; stderr: string } }> {
  return waitForManagedProcessOutput(registry, workspace, processId, "process-out", "process-err");
}

async function waitForManagedProcessOutput(
  registry: WorkspaceRegistry,
  workspace: Awaited<ReturnType<WorkspaceRegistry["openWorkspace"]>>,
  processId: string,
  stdoutNeedle: string,
  stderrNeedle?: string,
): Promise<{ process: { kind: string; status: string; stdout: string; stderr: string } }> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await runWorkspaceOperation(registry, workspace, {
      operation: "process_read",
      processId,
    }) as { process: { kind: string; status: string; stdout: string; stderr: string } };
    if (
      result.process.stdout.includes(stdoutNeedle) &&
      (!stderrNeedle || result.process.stderr.includes(stderrNeedle))
    ) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("process output did not become available");
}

async function waitForManagedProcessStatus(
  registry: WorkspaceRegistry,
  workspace: Awaited<ReturnType<WorkspaceRegistry["openWorkspace"]>>,
  processId: string,
  status: string,
): Promise<{ process: { kind: string; status: string; stdout: string; stderr: string; exitCode: number | null } }> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await runWorkspaceOperation(registry, workspace, {
      operation: "process_read",
      processId,
    }) as { process: { kind: string; status: string; stdout: string; stderr: string; exitCode: number | null } };
    if (result.process.status === status) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`process status did not become ${status}`);
}

async function waitForFile(path: string, expected: string): Promise<void> {
  const content = await waitForFileContent(path);
  if (content === expected) return;
  throw new Error(`file content did not match: ${path}`);
}

async function waitForFileContent(path: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return await readFile(path, "utf8");
    } catch {
      // File is created asynchronously by the managed process.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`file did not become available: ${path}`);
}

async function waitForProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`process did not exit: ${pid}`);
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
