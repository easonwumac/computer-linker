#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "alpha-readiness-report.mjs");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

function runResult(args, options = {}) {
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  };
  if (options.useDefaultEvidence) {
    delete env.COMPUTER_LINKER_ALPHA_EVIDENCE;
  } else if (!Object.hasOwn(options.env ?? {}, "COMPUTER_LINKER_ALPHA_EVIDENCE")) {
    env.COMPUTER_LINKER_ALPHA_EVIDENCE = "";
  }
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseJsonOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  assert.notEqual(start, -1, "expected JSON object output");
  assert.ok(end > start, "expected complete JSON object output");
  return JSON.parse(output.slice(start, end + 1));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tempRoot = mkdtempSync(join(tmpdir(), "computer-linker-alpha-readiness-test-"));
const defaultEvidencePath = join(repoRoot, ".computer-linker-alpha-evidence.json");
let defaultEvidenceTouched = false;
let defaultEvidenceExisted = false;
let defaultEvidenceBackup = "";
const changelogPath = join(repoRoot, "CHANGELOG.md");
let changelogTouched = false;
let changelogBackup = "";
try {
  const scriptSource = readFileSync(scriptPath, "utf8");
  assert.ok(scriptSource.includes("create a detached public mirror with `npm run public:mirror -- --remote <github-owner>/<public-repo>`"));

  const missingEvidencePath = join(tempRoot, "missing-evidence.json");
  const result = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--require-evidence",
    "--evidence",
    missingEvidencePath,
  ]);
  assert.notEqual(result.status, 0);
  const report = parseJsonOutput(result.stdout);
  assert.equal(report.kind, "computer-linker-alpha-readiness");
  assert.equal(report.status, "blocked");
  const evidenceCheck = report.checks.find((check) => check.id === "external-alpha-evidence");
  assert.equal(evidenceCheck?.status, "fail");
  const preservedHistoryCheck = report.checks.find((check) => check.id === "preserved-history-audit");
  assert.equal(preservedHistoryCheck?.status, "skipped");
  assert.match(evidenceCheck?.detail ?? "", /alpha:evidence -- preflight/);
  assert.match(evidenceCheck?.detail ?? "", /recordCommand/);
  assert.match(evidenceCheck?.detail ?? "", /alpha:evidence -- smoke/);
  assert.doesNotMatch(evidenceCheck?.detail ?? "", /--client "ChatGPT web"/);
  assert.match(report.nextActions.join("\n"), /Resolve the items marked needs action/);

  changelogBackup = readFileSync(changelogPath, "utf8");
  const undatedChangelog = changelogBackup.replace(
    new RegExp(`^## ${escapeRegex(packageJson.version)} - .+$`, "m"),
    `## ${packageJson.version} - Unreleased`,
  );
  assert.notEqual(undatedChangelog, changelogBackup, "expected test fixture to rewrite release changelog heading");
  writeFileSync(changelogPath, undatedChangelog, "utf8");
  changelogTouched = true;
  const undatedChangelogResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--require-dated-changelog",
  ]);
  assert.notEqual(undatedChangelogResult.status, 0);
  const undatedChangelogReport = parseJsonOutput(undatedChangelogResult.stdout);
  const releaseChangelogCheck = undatedChangelogReport.checks.find((check) => check.id === "release-changelog");
  assert.equal(releaseChangelogCheck?.status, "fail");
  assert.match(releaseChangelogCheck?.message ?? "", /must be dated/);
  assert.match(releaseChangelogCheck?.detail ?? "", /## 0\.1\.0 - YYYY-MM-DD/);
  assert.match(undatedChangelogReport.nextActions.join("\n"), /Date the CHANGELOG\.md heading/);
  writeFileSync(changelogPath, changelogBackup, "utf8");
  changelogTouched = false;

  const releaseReadyResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--accept-public-snapshot",
    "--require-evidence",
    "--require-dated-changelog",
  ]);
  assert.notEqual(releaseReadyResult.status, 0);
  const releaseReadyReport = parseJsonOutput(releaseReadyResult.stdout);
  assert.match(releaseReadyReport.nextActions.join("\n"), /Then rerun: npm run public:release-ready/);
  assert.doesNotMatch(releaseReadyReport.nextActions.join("\n"), /Then rerun: npm run alpha:check -- --require-evidence/);

  const staleEvidencePath = join(tempRoot, "stale-evidence.json");
  writeFileSync(staleEvidencePath, `${JSON.stringify({
    kind: "computer-linker-alpha-evidence",
    schemaVersion: 1,
    testedAt: new Date().toISOString(),
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    git: {
      head: "1111111111111111111111111111111111111111",
      shortHead: "111111111111",
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    target: {
      client: "ChatGPT web",
      exposure: "openai",
      tunnelOrUrl: "tunnel_staleevidence123",
      mcpPath: "/mcp",
      scope: "app",
    },
    checks: [
      {
        id: "external-mcp-tool-flow",
        status: "pass",
        evidence: "External MCP client called the required public tools successfully.",
      },
      {
        id: "tunnel-transport",
        status: "pass",
        evidence: "OpenAI tunnel forwarded the external client session to local MCP.",
      },
      {
        id: "mcp-only-public-surface",
        status: "pass",
        evidence: "Public exposure allowed MCP and did not expose non-MCP endpoints.",
      },
      {
        id: "operation-history-reviewed",
        status: "pass",
        evidence: "Operation history showed the expected session and no sensitive payloads.",
      },
      {
        id: "client-instructions-usable",
        status: "pass",
        evidence: "README agent instructions produced the expected first operations.",
      },
    ],
    redactionConfirmed: true,
  }, null, 2)}\n`);
  const stalePreflightConfigDir = join(tempRoot, "stale-preflight-config");
  mkdirSync(stalePreflightConfigDir, { recursive: true });
  const staleObservationTimestamp = "2000-01-01T00:00:00.000Z";
  writeFileSync(join(stalePreflightConfigDir, "config.json"), `${JSON.stringify({ publicMcpOnly: true }, null, 2)}\n`);
  writeFileSync(join(stalePreflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_stale123"],
    events: [{ timestamp: staleObservationTimestamp, kind: "dispatcher_forwarded", success: true }],
  }], null, 2)}\n`);
  writeFileSync(join(stalePreflightConfigDir, "audit.jsonl"), [
    JSON.stringify({ timestamp: staleObservationTimestamp, type: "tool_call", tool: "get_computer_info", success: true }),
    JSON.stringify({ timestamp: staleObservationTimestamp, type: "tool_call", tool: "computer_operation", success: true, workspaceRef: "app", operation: "file.list" }),
    JSON.stringify({ timestamp: staleObservationTimestamp, type: "tool_call", tool: "get_operation_history", success: true }),
    "",
  ].join("\n"));
  const staleEvidenceResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--evidence",
    staleEvidencePath,
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: stalePreflightConfigDir },
  });
  assert.notEqual(staleEvidenceResult.status, 0);
  const staleEvidenceReport = parseJsonOutput(staleEvidenceResult.stdout);
  const staleEvidenceCheck = staleEvidenceReport.checks.find((check) => check.id === "external-alpha-evidence");
  assert.equal(staleEvidenceCheck?.status, "fail");
  assert.match(staleEvidenceCheck?.detail ?? "", /git-head: Evidence git head must match current HEAD/);
  assert.match(staleEvidenceCheck?.detail ?? "", /preflight status=fail/);
  assert.match(staleEvidenceCheck?.detail ?? "", /failed checks: current-HEAD external smoke/);
  assert.match(staleEvidenceCheck?.detail ?? "", /current-HEAD freshness: missing current-HEAD observations after [0-9a-f]{12} .*: tool calls: get_computer_info, computer_operation, get_operation_history; tunnel dispatcher traffic/);
  assert.equal(staleEvidenceCheck?.evidencePreflight?.currentHeadFresh, false);
  assert.match(staleEvidenceCheck?.evidencePreflight?.currentHead?.shortHead ?? "", /^[0-9a-f]{12}$/);
  assert.match(staleEvidenceCheck?.evidencePreflight?.freshnessDetail ?? "", /missing current-HEAD observations after [0-9a-f]{12} .*: tool calls: get_computer_info, computer_operation, get_operation_history; tunnel dispatcher traffic/);
  assert.match(staleEvidenceCheck?.evidencePreflight?.nextExternalClientPrompt ?? "", /get_computer_info/);
  assert.match(staleEvidenceCheck?.evidencePreflight?.recordCommand ?? "", /alpha:evidence -- smoke/);
  assert.match(staleEvidenceCheck?.detail ?? "", /Fresh external MCP evidence is required for the current commit/);
  assert.match(staleEvidenceCheck?.nextAction ?? "", /npm run alpha:evidence -- preflight/);
  assert.match(staleEvidenceCheck?.nextAction ?? "", /npm run alpha:evidence -- smoke --redaction-confirmed/);
  assert.doesNotMatch(staleEvidenceCheck?.nextAction ?? "", /smoke \.\.\./);
  assert.doesNotMatch(staleEvidenceReport.nextActions.join("\n"), /Fresh external MCP evidence is required for the current commit/);
  assert.match(staleEvidenceReport.nextActions.join("\n"), /Paste the prompt shown in the external evidence section.*alpha:evidence -- preflight/);
  assert.match(staleEvidenceReport.nextActions.join("\n"), /After preflight is ready, run: npm run alpha:evidence -- smoke --redaction-confirmed/);
  assert.match(staleEvidenceReport.nextActions.join("\n"), /Then rerun: npm run alpha:check -- --require-evidence/);
  assert.doesNotMatch(staleEvidenceReport.nextActions.join("\n"), /When the preflight no longer fails/);
  assert.doesNotMatch(staleEvidenceReport.nextActions.join("\n"), /allow-evidence-head-mismatch/);

  defaultEvidenceTouched = true;
  defaultEvidenceExisted = existsSync(defaultEvidencePath);
  defaultEvidenceBackup = defaultEvidenceExisted ? readFileSync(defaultEvidencePath, "utf8") : "";
  writeFileSync(defaultEvidencePath, "{ not valid evidence json\n", "utf8");
  const optionalDefaultEvidenceResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
  ], { useDefaultEvidence: true });
  assert.equal(optionalDefaultEvidenceResult.status, 0);
  const optionalDefaultEvidenceReport = parseJsonOutput(optionalDefaultEvidenceResult.stdout);
  const optionalDefaultEvidenceCheck = optionalDefaultEvidenceReport.checks.find((check) => check.id === "external-alpha-evidence");
  assert.equal(optionalDefaultEvidenceCheck, undefined);
  assert.equal(optionalDefaultEvidenceReport.status, "needs_attention");

  const requiredDefaultEvidenceResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--require-evidence",
  ], { useDefaultEvidence: true });
  assert.notEqual(requiredDefaultEvidenceResult.status, 0);
  const requiredDefaultEvidenceReport = parseJsonOutput(requiredDefaultEvidenceResult.stdout);
  const requiredDefaultEvidenceCheck = requiredDefaultEvidenceReport.checks.find((check) => check.id === "external-alpha-evidence");
  assert.equal(requiredDefaultEvidenceCheck?.status, "fail");
  assert.match(requiredDefaultEvidenceCheck?.command ?? "", /--file \.computer-linker-alpha-evidence\.json/);
  assert.match(requiredDefaultEvidenceCheck?.detail ?? "", /preflight status=fail/);

  const preflightConfigDir = join(tempRoot, "preflight-config");
  const freshTimestamp = new Date().toISOString();
  mkdirSync(preflightConfigDir, { recursive: true });
  writeFileSync(join(preflightConfigDir, "config.json"), `${JSON.stringify({ publicMcpOnly: true }, null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [{ timestamp: freshTimestamp, kind: "dispatcher_forwarded", success: true }],
  }], null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "audit.jsonl"), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "get_computer_info", success: true }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "computer_operation", success: true, workspaceRef: "app", operation: "file.list" }),
    "",
  ].join("\n"));
  const noEvidenceResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--require-evidence",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(noEvidenceResult.status, 0);
  const noEvidenceReport = parseJsonOutput(noEvidenceResult.stdout);
  const preflightEvidenceCheck = noEvidenceReport.checks.find((check) => check.id === "external-alpha-evidence");
  assert.equal(preflightEvidenceCheck?.status, "fail");
  assert.match(preflightEvidenceCheck?.command ?? "", /alpha-evidence\.mjs preflight --json/);
  assert.match(preflightEvidenceCheck?.detail ?? "", /get_operation_history=no/);
  assert.match(preflightEvidenceCheck?.detail ?? "", /missing tools: get_operation_history/);
  assert.doesNotMatch(preflightEvidenceCheck?.detail ?? "", /missing-operation prompt/);
  assert.doesNotMatch(preflightEvidenceCheck?.detail ?? "", /Call get_operation_history/);
  assert.equal(preflightEvidenceCheck?.evidencePreflight?.observedTools?.get_operation_history, false);
  assert.match(preflightEvidenceCheck?.evidencePreflight?.nextExternalClientPrompt ?? "", /Call get_operation_history/);
  assert.match(preflightEvidenceCheck?.evidencePreflight?.recordCommand ?? "", /alpha:evidence -- smoke/);
  assert.match(preflightEvidenceCheck?.stdoutTail ?? "", /nextExternalClientPrompt/);
  assert.match(noEvidenceReport.nextActions.join("\n"), /Paste the prompt shown in the external evidence section.*alpha:evidence -- preflight/);
  assert.match(noEvidenceReport.nextActions.join("\n"), /After preflight is ready, run: npm run alpha:evidence -- smoke --redaction-confirmed/);
  assert.match(noEvidenceReport.nextActions.join("\n"), /Then rerun: npm run alpha:check -- --require-evidence/);
  assert.doesNotMatch(noEvidenceReport.nextActions.join("\n"), /When the preflight no longer fails/);
  const noEvidenceTextResult = runResult([
    "--skip-gates",
    "--allow-dirty",
    "--require-evidence",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(noEvidenceTextResult.status, 0);
  assert.match(noEvidenceTextResult.stdout, /status: needs action/);
  assert.match(noEvidenceTextResult.stdout, /readiness checks:/);
  assert.match(noEvidenceTextResult.stdout, /\[ok\] alpha command:/);
  assert.match(noEvidenceTextResult.stdout, /\[needs action\] external MCP smoke evidence/);
  assert.match(noEvidenceTextResult.stdout, /detail: No evidence file was provided\./);
  assert.match(noEvidenceTextResult.stdout, /evidence preflight status: fail/);
  assert.doesNotMatch(noEvidenceTextResult.stdout, /detail: .*preflight status=fail/);
  assert.doesNotMatch(noEvidenceTextResult.stdout, /detail: .*failed checks:/);
  assert.match(noEvidenceTextResult.stdout, /current HEAD: [0-9a-f]{12} committed /);
  assert.match(noEvidenceTextResult.stdout, /freshness: missing current-HEAD observations after [0-9a-f]{12} .*: tool calls: get_operation_history/);
  assert.match(noEvidenceTextResult.stdout, /prompt for external MCP client:/);
  assert.doesNotMatch(noEvidenceTextResult.stdout, /^checks:/m);
  assert.doesNotMatch(noEvidenceTextResult.stdout, /external-alpha-evidence/);
  assert.doesNotMatch(noEvidenceTextResult.stdout, /alpha-script/);
  assert.doesNotMatch(noEvidenceTextResult.stdout, /missing-operation prompt:/);

  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [],
  }], null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "audit.jsonl"), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "get_computer_info", success: true }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "computer_operation", success: true, workspaceRef: "app", operation: "file.list" }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "get_operation_history", success: true }),
    "",
  ].join("\n"));
  const missingTunnelResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--require-evidence",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(missingTunnelResult.status, 0);
  const missingTunnelReport = parseJsonOutput(missingTunnelResult.stdout);
  const missingTunnelEvidenceCheck = missingTunnelReport.checks.find((check) => check.id === "external-alpha-evidence");
  assert.match(missingTunnelEvidenceCheck?.detail ?? "", /get_operation_history=yes/);
  assert.match(missingTunnelEvidenceCheck?.detail ?? "", /failed checks: tunnel traffic/);
  assert.match(missingTunnelEvidenceCheck?.detail ?? "", /current-HEAD freshness: missing current-HEAD observations after [0-9a-f]{12} .*: tunnel dispatcher traffic/);
  assert.match(missingTunnelEvidenceCheck?.evidencePreflight?.freshnessDetail ?? "", /missing current-HEAD observations after [0-9a-f]{12} .*: tunnel dispatcher traffic/);
  assert.match(missingTunnelEvidenceCheck?.evidencePreflight?.nextExternalClientPrompt ?? "", /get_computer_info/);
  assert.match(missingTunnelReport.nextActions.join("\n"), /external MCP client through the configured tunnel/);
  assert.match(missingTunnelReport.nextActions.join("\n"), /Paste the prompt shown in the external evidence section.*alpha:evidence -- preflight/);
  assert.match(missingTunnelReport.nextActions.join("\n"), /After preflight is ready, run: npm run alpha:evidence -- smoke --redaction-confirmed/);
  assert.match(missingTunnelReport.nextActions.join("\n"), /Then rerun: npm run alpha:check -- --require-evidence/);
  assert.doesNotMatch(missingTunnelReport.nextActions.join("\n"), /When the preflight no longer fails/);

  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [{ timestamp: freshTimestamp, kind: "dispatcher_forwarded", success: true }],
  }], null, 2)}\n`);
  const readyPreflightResult = runResult([
    "--json",
    "--skip-gates",
    "--allow-dirty",
    "--require-evidence",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(readyPreflightResult.status, 0);
  const readyPreflightReport = parseJsonOutput(readyPreflightResult.stdout);
  const readyPreflightEvidenceCheck = readyPreflightReport.checks.find((check) => check.id === "external-alpha-evidence");
  assert.equal(readyPreflightEvidenceCheck?.evidencePreflight?.status, "warn");
  assert.match(readyPreflightReport.nextActions.join("\n"), /Run: npm run alpha:evidence -- smoke/);
  assert.doesNotMatch(readyPreflightReport.nextActions.join("\n"), /When the preflight no longer fails/);

  const help = runResult(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--require-evidence/);
  assert.match(help.stdout, /--accept-public-snapshot/);
} finally {
  if (changelogTouched) {
    writeFileSync(changelogPath, changelogBackup, "utf8");
  }
  if (defaultEvidenceTouched) {
    if (defaultEvidenceExisted) {
      writeFileSync(defaultEvidencePath, defaultEvidenceBackup, "utf8");
    } else {
      rmSync(defaultEvidencePath, { force: true });
    }
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("alpha readiness report tests ok");
