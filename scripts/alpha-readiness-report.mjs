#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const rawArgs = process.argv.slice(2);
const booleanFlags = new Set([
  "--json",
  "--skip-gates",
  "--skip-public-audit",
  "--skip-snapshot",
  "--allow-dirty",
  "--accept-public-snapshot",
  "--require-evidence",
  "--allow-evidence-head-mismatch",
  "--allow-local-evidence",
  "--require-dated-changelog",
  "--help",
]);
const valueFlags = new Set([
  "--evidence",
  "--max-evidence-age-days",
]);
const flags = new Set();
const flagValues = new Map();

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (booleanFlags.has(arg)) {
    flags.add(arg);
    continue;
  }
  if (valueFlags.has(arg)) {
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      console.error(`alpha readiness failed: missing value for ${arg}`);
      process.exit(1);
    }
    flagValues.set(arg, value);
    index += 1;
    continue;
  }
  console.error(`alpha readiness failed: unknown option ${arg}`);
  process.exit(1);
}

if (flags.has("--help")) {
  console.log([
    "Computer Linker alpha readiness report",
    "",
    "Usage:",
    "  npm run alpha:check",
    "  npm run alpha:check -- --require-evidence",
    "  node scripts/alpha-readiness-report.mjs [--json]",
    "",
    "Options:",
    "  --json               Print the final report as JSON.",
    "  --skip-gates         Do not run product:check, public:audit, preserved-history audit, or snapshot dry-run.",
    "  --skip-public-audit  Skip public:audit only.",
    "  --skip-snapshot      Skip public snapshot dry-run only.",
    "  --allow-dirty        Report a dirty worktree as a warning instead of a blocker.",
    "  --accept-public-snapshot",
    "                       Treat preserved private history fingerprints as acceptable when publishing via public:mirror.",
    "  --evidence path      Validate external alpha evidence from this JSON file.",
    "  --require-evidence   Fail when external alpha evidence is missing or invalid.",
    "  --max-evidence-age-days days",
    "                       Maximum accepted external evidence age. Default: 14.",
    "  --allow-evidence-head-mismatch",
    "                       Allow evidence for a different git HEAD.",
    "  --allow-local-evidence",
    "                       Allow local-only evidence instead of a public tunnel.",
    "  --require-dated-changelog",
    "                       Fail while CHANGELOG.md still marks the package version as Unreleased.",
    "",
    "Notes:",
    "  External evidence is checked only when --require-evidence, --evidence,",
    "  or COMPUTER_LINKER_ALPHA_EVIDENCE is set.",
    "  --require-evidence uses .computer-linker-alpha-evidence.json when it exists.",
  ].join("\n"));
  process.exit(0);
}

const jsonOutput = flags.has("--json");
const skipGates = flags.has("--skip-gates");
const skipPublicAudit = skipGates || flags.has("--skip-public-audit");
const skipSnapshot = skipGates || flags.has("--skip-snapshot");
const allowDirty = flags.has("--allow-dirty");
const acceptPublicSnapshot = flags.has("--accept-public-snapshot");
const requireEvidence = flags.has("--require-evidence");
const requireDatedChangelog = flags.has("--require-dated-changelog");
const explicitEvidencePath = flagValues.has("--evidence");
const environmentEvidencePathSet = Object.hasOwn(process.env, "COMPUTER_LINKER_ALPHA_EVIDENCE");
const environmentEvidencePath = environmentEvidencePathSet ? process.env.COMPUTER_LINKER_ALPHA_EVIDENCE || undefined : undefined;
const defaultEvidencePath = requireEvidence && !environmentEvidencePathSet && existsSync(".computer-linker-alpha-evidence.json") ? ".computer-linker-alpha-evidence.json" : undefined;
const evidencePath = explicitEvidencePath ? flagValues.get("--evidence") : environmentEvidencePath ?? defaultEvidencePath;
const maxEvidenceAgeDays = readPositiveIntegerFlag("--max-evidence-age-days", 14);
const evidenceRequested = requireEvidence || explicitEvidencePath || environmentEvidencePathSet;
const rerunReadinessCommand = evidenceRequested && requireDatedChangelog && acceptPublicSnapshot
  ? "npm run public:release-ready"
  : evidenceRequested ? "npm run alpha:check -- --require-evidence" : "npm run alpha:check";
const externalEvidenceGuidance = "Run `npm run alpha:evidence -- preflight`, complete its printed next actions, then run the printed `recordCommand` and rerun with `--require-evidence`.";
const refreshExternalEvidenceAction = "Refresh the external MCP smoke evidence: run `npm run alpha:evidence -- preflight`, complete the printed external-client action, run its `recordCommand` (`npm run alpha:evidence -- smoke --redaction-confirmed`), then rerun `npm run alpha:check -- --require-evidence`.";

const checks = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    addCheck({
      id: "package-metadata",
      status: "fail",
      message: `${path} is not valid JSON.`,
      detail: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    void error;
    return "";
  }
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    if (options.allowFailure) return "";
    addCheck({
      id: "git",
      status: "fail",
      message: `git ${args.join(" ")} failed.`,
      detail: error.stderr?.toString().trim() || error.message,
    });
    return "";
  }
}

function addCheck(check) {
  checks.push({
    id: check.id,
    status: check.status,
    message: check.message,
    ...(check.command ? { command: check.command } : {}),
    ...(typeof check.durationMs === "number" ? { durationMs: check.durationMs } : {}),
    ...(check.detail ? { detail: check.detail } : {}),
    ...(check.nextAction ? { nextAction: check.nextAction } : {}),
    ...(check.evidencePreflight ? { evidencePreflight: check.evidencePreflight } : {}),
    ...(check.stdoutTail ? { stdoutTail: check.stdoutTail } : {}),
    ...(check.stderrTail ? { stderrTail: check.stderrTail } : {}),
  });
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function evidenceRecoveryAction(evidenceReport, evidenceStatus) {
  if (evidenceStatus !== "fail") return undefined;
  const failedIds = new Set(
    (Array.isArray(evidenceReport?.checks) ? evidenceReport.checks : [])
      .filter((check) => check?.status === "fail")
      .map((check) => String(check.id ?? "")),
  );

  if (failedIds.has("git-head")) {
    return `Fresh external MCP evidence is required for the current commit. ${refreshExternalEvidenceAction}`;
  }
  if (failedIds.has("tested-at")) {
    return `External MCP evidence is stale or has an invalid timestamp. ${refreshExternalEvidenceAction}`;
  }
  if (failedIds.has("redaction") || failedIds.has("secret-scan")) {
    return `External MCP evidence must be free of secrets and sensitive payloads. ${refreshExternalEvidenceAction}`;
  }
  if ([...failedIds].some((id) => id === "checks-array" || id.startsWith("check:"))) {
    return `External MCP evidence is incomplete. ${refreshExternalEvidenceAction}`;
  }
  return refreshExternalEvidenceAction;
}

function npmInvocation(npmArgs) {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...npmArgs],
      display: `npm ${npmArgs.join(" ")}`,
    };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: npmArgs,
    display: `npm ${npmArgs.join(" ")}`,
  };
}

function runNpmCheck(id, npmArgs, message) {
  const invocation = npmInvocation(npmArgs);
  const started = Date.now();
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    stdio: jsonOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  const durationMs = Date.now() - started;
  const passed = result.status === 0;
  addCheck({
    id,
    status: passed ? "pass" : "fail",
    message: passed ? message.pass : message.fail,
    command: invocation.display,
    durationMs,
    stdoutTail: jsonOutput ? tail(result.stdout) : undefined,
    stderrTail: jsonOutput ? tail(result.stderr) : undefined,
    detail: !passed && result.error ? result.error.message : undefined,
  });
  return passed;
}

function runPreservedHistoryAudit() {
  const npmArgs = ["run", "public:audit", "--", "--strict-history", "--skip-npm-audit"];
  const invocation = npmInvocation(npmArgs);
  const started = Date.now();
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const durationMs = Date.now() - started;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const failureCount = (output.match(/public audit failed:/g) ?? []).length;
  const localHistoryFingerprint = result.status !== 0 &&
    failureCount === 1 &&
    output.includes("public audit failed: Git history contains local fingerprints.") &&
    output.includes("npm run public:mirror");
  if (result.status === 0) {
    addCheck({
      id: "preserved-history-audit",
      status: "pass",
      message: "Preserved Git history is safe for direct public repository visibility.",
      command: invocation.display,
      durationMs,
      stdoutTail: jsonOutput ? tail(result.stdout) : undefined,
      stderrTail: jsonOutput ? tail(result.stderr) : undefined,
    });
    return true;
  }
  addCheck({
    id: "preserved-history-audit",
    status: localHistoryFingerprint && acceptPublicSnapshot ? "pass" : localHistoryFingerprint ? "warn" : "fail",
    message: localHistoryFingerprint
      ? acceptPublicSnapshot
        ? "Preserved Git history contains local fingerprints; public mirror release path is accepted."
        : "Preserved Git history contains local fingerprints; publish a fresh public mirror instead of making this repository public."
      : "Strict preserved-history public audit failed.",
    command: invocation.display,
    durationMs,
    detail: localHistoryFingerprint
      ? acceptPublicSnapshot
        ? "Do not make this private repository public with preserved history; publish the detached one-commit public mirror produced by `npm run public:mirror -- --remote <github-owner>/<public-repo>`."
        : "Use `npm run public:mirror -- --remote <github-owner>/<public-repo>` for a detached one-commit public mirror."
      : result.error?.message,
    stdoutTail: jsonOutput ? tail(result.stdout) : undefined,
    stderrTail: jsonOutput ? tail(result.stderr) : undefined,
  });
  return localHistoryFingerprint;
}

function tail(value, maxLength = 4000) {
  if (!value) return undefined;
  const text = String(value).replace(/\s+$/g, "");
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(text.length - maxLength) : text;
}

function readPositiveIntegerFlag(flag, fallback) {
  const raw = flagValues.get(flag);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`alpha readiness failed: ${flag} must be a positive integer`);
    process.exit(1);
  }
  return value;
}

function runEvidenceCheck() {
  if (!evidencePath) {
    if (requireEvidence) {
      const preflight = runEvidencePreflight();
      addCheck({
        id: "external-alpha-evidence",
        status: "fail",
        message: "External alpha evidence is required but no evidence file was provided.",
        command: preflight.command,
        durationMs: preflight.durationMs,
        detail: [
          "No evidence file was provided.",
          preflight.detail,
          externalEvidenceGuidance,
        ].filter(Boolean).join("; "),
        evidencePreflight: preflight.evidencePreflight,
        stdoutTail: jsonOutput ? tail(preflight.stdout) : undefined,
        stderrTail: jsonOutput ? tail(preflight.stderr) : undefined,
      });
    }
    return;
  }

  const args = [
    "scripts/alpha-evidence.mjs",
    "check",
    "--file",
    evidencePath,
    "--max-age-days",
    String(maxEvidenceAgeDays),
    "--json",
  ];
  if (flags.has("--allow-evidence-head-mismatch")) args.push("--allow-head-mismatch");
  if (flags.has("--allow-local-evidence")) args.push("--allow-local-only");
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const durationMs = Date.now() - started;
  let evidenceReport;
  try {
    evidenceReport = result.stdout ? JSON.parse(result.stdout) : undefined;
  } catch {
    evidenceReport = undefined;
  }
  const passed = result.status === 0 && evidenceReport?.status !== "fail";
  const evidenceStatus = passed && evidenceReport?.status === "warn" ? "warn" : passed ? "pass" : "fail";
  const evidenceMessage = evidenceStatus === "pass"
    ? "External alpha client/tunnel evidence passed."
    : evidenceStatus === "warn"
      ? "External alpha client/tunnel evidence passed with warnings."
      : "External alpha client/tunnel evidence failed.";
  const failureDetail = evidenceReport?.checks
    ?.filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.message}${check.detail ? ` (${check.detail})` : ""}`)
    .join("; ") || result.stderr?.trim() || result.error?.message;
  const evidenceNextAction = evidenceRecoveryAction(evidenceReport, evidenceStatus);
  const evidenceGuidance = evidenceStatus === "fail"
    ? evidenceNextAction ?? externalEvidenceGuidance
    : undefined;
  const preflight = evidenceStatus === "fail" ? runEvidencePreflight() : undefined;
  addCheck({
    id: "external-alpha-evidence",
    status: evidenceStatus,
    message: evidenceMessage,
    command: `node ${args.join(" ")}`,
    durationMs: preflight ? durationMs + preflight.durationMs : durationMs,
    detail: [failureDetail, preflight?.detail, evidenceGuidance].filter(Boolean).join("; ") || undefined,
    nextAction: evidenceNextAction,
    evidencePreflight: preflight?.evidencePreflight,
    stdoutTail: jsonOutput ? tail(result.stdout) : undefined,
    stderrTail: jsonOutput ? tail(result.stderr) : undefined,
    preflightStdoutTail: jsonOutput && preflight ? tail(preflight.stdout) : undefined,
    preflightStderrTail: jsonOutput && preflight ? tail(preflight.stderr) : undefined,
  });
}

function runEvidencePreflight() {
  const args = [
    "scripts/alpha-evidence.mjs",
    "preflight",
    "--json",
  ];
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const durationMs = Date.now() - started;
  let preflightReport;
  try {
    preflightReport = result.stdout ? JSON.parse(result.stdout) : undefined;
  } catch {
    preflightReport = undefined;
  }
  const summary = summarizeEvidencePreflight(preflightReport, result);
  return {
    command: `node ${args.join(" ")}`,
    durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    detail: summary.detail,
    evidencePreflight: summary.evidencePreflight,
  };
}

function summarizeEvidencePreflight(preflightReport, result) {
  if (!preflightReport) {
    return {
      detail: result.stderr?.trim() || result.error?.message || "Evidence preflight did not return JSON.",
    };
  }
  const tools = preflightReport.observed?.tools ?? {};
  const observedToolsObject = {
    get_computer_info: Boolean(tools.get_computer_info),
    computer_operation: Boolean(tools.computer_operation),
    get_operation_history: Boolean(tools.get_operation_history),
  };
  const observedTools = [
    `get_computer_info=${observedToolsObject.get_computer_info ? "yes" : "no"}`,
    `computer_operation=${observedToolsObject.computer_operation ? "yes" : "no"}`,
    `get_operation_history=${observedToolsObject.get_operation_history ? "yes" : "no"}`,
  ].join(" ");
  const missingTools = Object.entries(observedToolsObject)
    .filter(([, observed]) => !observed)
    .map(([tool]) => tool);
  const failedChecks = Array.isArray(preflightReport.checks)
    ? preflightReport.checks
      .filter((check) => check?.status === "fail")
      .map(summarizePreflightFailedCheck)
    : [];
  const freshnessDetail = preflightFreshnessDetail(preflightReport.checks);
  const detail = [
    `preflight status=${preflightReport.status ?? "unknown"}`,
    `observed ${observedTools}`,
    missingTools.length > 0
      ? `missing tools: ${missingTools.join(", ")}`
      : failedChecks.length > 0
        ? `failed checks: ${failedChecks.join(", ")}`
        : undefined,
    freshnessDetail ? `current-HEAD freshness: ${freshnessDetail}` : undefined,
  ].filter(Boolean).join("; ");
  return {
    detail,
    evidencePreflight: {
      status: preflightReport.status ?? "unknown",
      observedTools: observedToolsObject,
      currentHeadFresh: preflightReport.observed?.currentHeadFresh === true,
      currentHead: preflightReport.observed?.currentHead,
      freshnessDetail,
      missingChecks: failedChecks,
      nextExternalClientPrompt: preflightReport.nextExternalClientPrompt,
      recordCommand: preflightReport.recordCommand,
      nextActions: Array.isArray(preflightReport.nextActions) ? preflightReport.nextActions : [],
    },
  };
}

function summarizePreflightFailedCheck(check) {
  const label = preflightCheckLabel(check?.id);
  if (check?.id === "current-head-observations") return label;
  const detail = preflightCheckDetail(check);
  return detail ? `${label}: ${detail}` : label;
}

function preflightCheckLabel(id) {
  if (id === "current-head-observations") return "current-HEAD external smoke";
  if (id === "external-mcp-tool-flow") return "required MCP tool calls";
  if (id === "tunnel-transport") return "tunnel traffic";
  if (id === "mcp-only-public-surface") return "MCP-only public surface";
  if (id === "evidence-target") return "tunnel target";
  if (id === "operation-history-reviewed") return "get_operation_history";
  return id ?? "unknown preflight check";
}

function preflightCheckDetail(check) {
  const detail = typeof check?.detail === "string" ? check.detail.replace(/\s+/g, " ").trim() : "";
  if (!detail) return undefined;
  if (check.id === "current-head-observations") {
    return detail
      .replace(/^Missing /, "missing ")
      .replace(/\. Rerun the external smoke prompt.*$/i, ".");
  }
  return detail;
}

function preflightFreshnessDetail(checks) {
  if (!Array.isArray(checks)) return undefined;
  const check = checks.find((item) => item?.id === "current-head-observations");
  if (!check?.detail) return undefined;
  return check.status === "pass" ? check.detail : preflightCheckDetail(check);
}

function releaseChangelogCheck(version) {
  const changelog = readText("CHANGELOG.md");
  if (!changelog) {
    return {
      id: "release-changelog",
      status: "fail",
      message: "CHANGELOG.md must be readable before publishing a release.",
    };
  }
  const heading = new RegExp(`^## ${escapeRegex(version)} - (.+)$`, "m").exec(changelog);
  if (!heading) {
    return {
      id: "release-changelog",
      status: "fail",
      message: `CHANGELOG.md must contain a heading for ${version}.`,
      detail: `Expected: ## ${version} - YYYY-MM-DD`,
    };
  }
  const releaseLabel = heading[1]?.trim() ?? "";
  if (releaseLabel === "Unreleased") {
    return {
      id: "release-changelog",
      status: "fail",
      message: `CHANGELOG.md heading for ${version} must be dated before publishing.`,
      detail: `Replace "## ${version} - Unreleased" with "## ${version} - YYYY-MM-DD" when cutting the release.`,
    };
  }
  return {
    id: "release-changelog",
    status: "pass",
    message: `CHANGELOG.md heading for ${version} is dated.`,
  };
}

function workflowBudgetCheck(path, label) {
  if (!existsSync(path)) {
    return {
      id: `${label}-workflow-budget`,
      status: "fail",
      message: `${path} is missing.`,
    };
  }
  const text = readFileSync(path, "utf8");
  const failures = [];
  if (!text.includes("workflow_dispatch")) failures.push("not manual workflow_dispatch");
  for (const trigger of ["push:", "pull_request:", "schedule:", "workflow_run:", "tags:"]) {
    if (text.includes(trigger)) failures.push(`contains ${trigger}`);
  }
  if (/\bstrategy:/i.test(text) || /\bmatrix:/i.test(text)) failures.push("contains a strategy matrix");
  if (/\bubuntu-[a-z0-9.-]+/i.test(text)) failures.push("contains a Linux runner");
  if (/\bmacos-[a-z0-9.-]+/i.test(text)) failures.push("contains a macOS runner");
  if ((text.match(/\bruns-on:/g) ?? []).length !== 1) failures.push("does not have exactly one runner");
  if ((text.match(/\bnode-version:/g) ?? []).length !== 1) failures.push("does not have exactly one Node version");
  if (!text.includes("runs-on: windows-latest")) failures.push("runner is not windows-latest");
  if (!text.includes('node-version: "22.x"')) failures.push("Node version is not 22.x");

  return {
    id: `${label}-workflow-budget`,
    status: failures.length > 0 ? "fail" : "pass",
    message: failures.length > 0
      ? `${label} workflow is not cost-capped for the current Actions budget.`
      : `${label} workflow is manual, Windows-only, and Node 22 only.`,
    detail: failures.join("; ") || undefined,
  };
}

function skippedCheck(id, command, message) {
  addCheck({
    id,
    status: "skipped",
    message,
    command,
  });
}

function gitStatusEntries() {
  const text = git(["status", "--porcelain"], { allowFailure: true });
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

const packageJson = readJson("package.json");
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || "unknown";
const head = git(["rev-parse", "--short=12", "HEAD"], { allowFailure: true }) || "unknown";
let dirtyEntries = gitStatusEntries();

if (packageJson.scripts?.["alpha:check"] !== "node scripts/alpha-readiness-report.mjs") {
  addCheck({
    id: "alpha-script",
    status: "fail",
    message: "package.json must expose npm run alpha:check.",
  });
} else {
  addCheck({
    id: "alpha-script",
    status: "pass",
    message: "package.json exposes npm run alpha:check.",
  });
}

addCheck(workflowBudgetCheck(".github/workflows/ci.yml", "ci"));
addCheck(workflowBudgetCheck(".github/workflows/release.yml", "release"));
if (requireDatedChangelog) {
  addCheck(releaseChangelogCheck(packageJson.version));
}

if (dirtyEntries.length > 0) {
  addCheck({
    id: "git-clean",
    status: allowDirty ? "warn" : "fail",
    message: allowDirty
      ? "Worktree is dirty; report is for local WIP only."
      : "Worktree must be clean before sharing an alpha build or creating a public snapshot.",
    detail: dirtyEntries.slice(0, 20).join("\n"),
  });
} else {
  addCheck({
    id: "git-clean",
    status: "pass",
    message: "Worktree is clean.",
  });
}

runEvidenceCheck();

let canContinueGates = true;
if (skipGates) {
  skippedCheck("product-check", "npm run product:check", "Skipped by --skip-gates.");
  skippedCheck("public-audit", "npm run public:audit", "Skipped by --skip-gates.");
  skippedCheck("preserved-history-audit", "npm run public:audit -- --strict-history --skip-npm-audit", "Skipped by --skip-gates.");
  skippedCheck("public-snapshot-dry-run", "npm run public:snapshot -- --dry-run --skip-audit", "Skipped by --skip-gates.");
  canContinueGates = false;
}

if (canContinueGates) {
  canContinueGates = runNpmCheck("product-check", ["run", "product:check"], {
    pass: "Product gate passed.",
    fail: "Product gate failed.",
  });
}

if (canContinueGates && skipPublicAudit) {
  skippedCheck("public-audit", "npm run public:audit", "Skipped by --skip-public-audit.");
  skippedCheck("preserved-history-audit", "npm run public:audit -- --strict-history --skip-npm-audit", "Skipped by --skip-public-audit.");
} else if (canContinueGates) {
  canContinueGates = runNpmCheck("public-audit", ["run", "public:audit"], {
    pass: "Public release audit passed.",
    fail: "Public release audit failed.",
  });
  if (canContinueGates) {
    canContinueGates = runPreservedHistoryAudit();
  }
}

if (canContinueGates && skipSnapshot) {
  skippedCheck("public-snapshot-dry-run", "npm run public:snapshot -- --dry-run --skip-audit", "Skipped by --skip-snapshot.");
} else if (canContinueGates) {
  runNpmCheck("public-snapshot-dry-run", ["run", "public:snapshot", "--", "--dry-run", "--skip-audit"], {
    pass: "Public snapshot dry-run passed.",
    fail: "Public snapshot dry-run failed.",
  });
}

const finalDirtyEntries = gitStatusEntries();
if (dirtyEntries.length === 0 && finalDirtyEntries.length > 0) {
  addCheck({
    id: "git-clean-after-gates",
    status: allowDirty ? "warn" : "fail",
    message: allowDirty
      ? "Worktree became dirty after running gates; report is for local WIP only."
      : "Worktree became dirty after running gates.",
    detail: finalDirtyEntries.slice(0, 20).join("\n"),
  });
}
dirtyEntries = finalDirtyEntries;

const failures = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn" || check.status === "skipped");
const overallStatus = failures.length > 0 ? "blocked" : warnings.length > 0 ? "needs_attention" : "ready";
const nextActions = [];

if (failures.length > 0) {
  nextActions.push("Resolve the items marked needs action before sharing an alpha build or publishing a public snapshot.");
}
if (failures.some((check) => check.id === "release-changelog")) {
  nextActions.push(`Date the CHANGELOG.md heading for ${packageJson.version} before creating the public mirror or release tag.`);
}
const failedEvidenceCheck = checks.find((check) => check.id === "external-alpha-evidence" && check.status === "fail");
const failedEvidencePreflight = failedEvidenceCheck?.evidencePreflight;
if (failedEvidencePreflight) {
  if (failedEvidencePreflight.nextExternalClientPrompt) {
    nextActions.push("Paste the prompt shown in the external evidence section into the external MCP client, then rerun: npm run alpha:evidence -- preflight");
  } else if (failedEvidencePreflight.status === "fail") {
    nextActions.push("Run: npm run alpha:evidence -- preflight");
  }
} else if (failedEvidenceCheck?.nextAction) {
  nextActions.push(failedEvidenceCheck.nextAction);
}
for (const action of failedEvidencePreflight?.nextActions ?? []) {
  if (action.startsWith("Paste the prompt")) continue;
  if (action.startsWith("When this preflight no longer fails")) continue;
  nextActions.push(action);
}
if (failedEvidencePreflight?.recordCommand && failedEvidencePreflight.status === "fail") {
  nextActions.push(`After preflight is ready, run: ${failedEvidencePreflight.recordCommand}`);
  nextActions.push(`Then rerun: ${rerunReadinessCommand}`);
}
if (dirtyEntries.length > 0 && !allowDirty) {
  nextActions.push(`Commit or discard local changes, then rerun ${rerunReadinessCommand}.`);
}
if (warnings.some((check) => check.status === "skipped")) {
  nextActions.push("Run without skip flags before using this as release evidence.");
}
if (warnings.some((check) => check.id === "preserved-history-audit" && check.status === "warn")) {
  nextActions.push("Do not make the current private GitHub repository public with preserved history; create a detached public mirror with `npm run public:mirror -- --remote <github-owner>/<public-repo>` instead.");
}
if (checks.some((check) => check.id === "preserved-history-audit" && check.status === "pass" && check.message.includes("public mirror release path is accepted"))) {
  nextActions.push("Create or update the public mirror with `npm run public:mirror -- --remote <github-owner>/<public-repo>`.");
}
if (failures.length === 0 && !warnings.some((check) => check.status === "skipped")) {
  nextActions.push("Run the manual Windows/Node 22 GitHub workflow from the public snapshot repo only when Actions budget is available.");
  if (!checks.some((check) => check.id === "external-alpha-evidence" && check.status === "pass")) {
    nextActions.push("Run the manual external MCP client/tunnel test plan with `npm run alpha:evidence -- preflight`, complete any printed external-client action, run its `recordCommand` (`npm run alpha:evidence -- smoke --redaction-confirmed`), then rerun `npm run alpha:check -- --require-evidence` before announcing a public alpha.");
  }
}

const report = {
  kind: "computer-linker-alpha-readiness",
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: overallStatus,
  package: {
    name: packageJson.name,
    version: packageJson.version,
  },
  git: {
    branch,
    head,
    clean: dirtyEntries.length === 0,
    dirtyEntries: dirtyEntries.slice(0, 50),
  },
  checks,
  nextActions,
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printTextReport(report);
}

if (overallStatus === "blocked") {
  process.exitCode = 1;
}

function printTextReport(report) {
  console.log("");
  console.log("Computer Linker alpha readiness");
  console.log(`status: ${readinessStatusLabel(report.status)}`);
  console.log(`package: ${report.package.name}@${report.package.version}`);
  console.log(`git: ${report.git.branch} ${report.git.head} clean=${report.git.clean ? "yes" : "no"}`);
  console.log("readiness checks:");
  for (const check of report.checks) {
    const duration = typeof check.durationMs === "number" ? ` (${Math.round(check.durationMs / 1000)}s)` : "";
    console.log(`  [${checkStatusLabel(check.status)}] ${checkLabel(check.id)}${duration}: ${check.message}`);
    if (check.command) console.log(`    command: ${check.command}`);
    const detail = printableCheckDetail(check);
    if (detail) console.log(`    detail: ${detail}`);
    if (check.evidencePreflight) {
      if (check.evidencePreflight.status) {
        console.log(`    evidence preflight status: ${check.evidencePreflight.status}`);
      }
      const observed = check.evidencePreflight.observedTools;
      if (observed) {
        console.log(`    evidence preflight: get_computer_info=${observed.get_computer_info ? "yes" : "no"} computer_operation=${observed.computer_operation ? "yes" : "no"} get_operation_history=${observed.get_operation_history ? "yes" : "no"}`);
      }
      if (typeof check.evidencePreflight.currentHeadFresh === "boolean") {
        console.log(`    current HEAD observations: ${check.evidencePreflight.currentHeadFresh ? "yes" : "no"}`);
      }
      const headSummary = preflightHeadSummary(check.evidencePreflight.currentHead);
      if (headSummary) {
        console.log(`    current HEAD: ${headSummary}`);
      }
      if (check.evidencePreflight.freshnessDetail) {
        console.log(`    freshness: ${check.evidencePreflight.freshnessDetail}`);
      }
      if (check.evidencePreflight.nextExternalClientPrompt) {
        console.log("    prompt for external MCP client:");
        console.log(indentBlock(check.evidencePreflight.nextExternalClientPrompt, "      "));
      }
      if (check.evidencePreflight.recordCommand) {
        console.log(`    record command: ${check.evidencePreflight.recordCommand}`);
      }
    }
  }
  if (report.nextActions.length > 0) {
    console.log("next actions:");
    for (const action of report.nextActions) console.log(`  - ${action}`);
  }
}

function printableCheckDetail(check) {
  if (!check.detail) return undefined;
  const detail = check.detail.replace(/\r?\n/g, "; ");
  if (check.id !== "external-alpha-evidence" || !check.evidencePreflight) return detail;
  const primary = detail
    .split("; ")
    .find((part) => (
      part.startsWith("git-head:") ||
      part.startsWith("file:") ||
      part.startsWith("json:") ||
      part.startsWith("kind:") ||
      part.startsWith("No evidence file")
    ));
  return primary ?? "External evidence preflight needs action.";
}

function readinessStatusLabel(status) {
  if (status === "ready") return "ready";
  if (status === "blocked") return "needs action";
  return status;
}

function preflightHeadSummary(currentHead) {
  if (!currentHead || typeof currentHead !== "object") return undefined;
  const shortHead = currentHead.shortHead && currentHead.shortHead !== "unknown"
    ? currentHead.shortHead
    : currentHead.head && currentHead.head !== "unknown" ? String(currentHead.head).slice(0, 12) : undefined;
  if (!shortHead) return undefined;
  return currentHead.committedAt ? `${shortHead} committed ${currentHead.committedAt}` : shortHead;
}

function checkStatusLabel(status) {
  switch (status) {
    case "pass":
      return "ok";
    case "fail":
      return "needs action";
    case "warn":
      return "warning";
    case "skipped":
      return "skipped";
    default:
      return status;
  }
}

function checkLabel(id) {
  switch (id) {
    case "alpha-script":
      return "alpha command";
    case "ci-workflow-budget":
      return "GitHub Actions CI budget";
    case "release-workflow-budget":
      return "GitHub Actions release budget";
    case "git-clean":
      return "Git worktree";
    case "git-clean-after-gates":
      return "Git worktree after checks";
    case "external-alpha-evidence":
      return "external MCP smoke evidence";
    case "product-check":
      return "product checks";
    case "public-audit":
      return "public release audit";
    case "preserved-history-audit":
      return "existing Git history audit";
    case "public-snapshot-dry-run":
      return "public snapshot dry run";
    default:
      return id.replaceAll("-", " ");
  }
}

function indentBlock(value, prefix) {
  return String(value).split(/\r?\n/).map((line) => `${prefix}${line}`).join("\n");
}
