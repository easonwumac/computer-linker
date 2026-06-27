#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "alpha-evidence.mjs");
const requiredChecks = [
  "external-mcp-tool-flow",
  "tunnel-transport",
  "mcp-only-public-surface",
  "operation-history-reviewed",
  "client-instructions-usable",
];

function run(args, options = {}) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runResult(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
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

function readEvidence(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function recordAllEvidence(file) {
  for (let index = 0; index < requiredChecks.length; index += 1) {
    const checkId = requiredChecks[index];
    run([
      "record",
      checkId,
      `Concrete alpha evidence note for ${checkId} from the test fixture.`,
      "--file",
      file,
      ...(index === requiredChecks.length - 1 ? ["--redaction-confirmed"] : []),
    ]);
  }
  return readEvidence(file);
}

const tempRoot = mkdtempSync(join(tmpdir(), "computer-linker-alpha-evidence-test-"));
try {
  const freshTimestamp = new Date().toISOString();

  const help = run(["help"]);
  assert.match(help, /--client name/);
  assert.match(help, /Example: Claude Desktop or ChatGPT web/);
  assert.match(help, /--exposure name/);
  assert.match(help, /--tunnel-or-url value/);
  assert.match(help, /--scope id/);
  assert.match(help, /smoke \["external MCP smoke note"\]/);
  assert.match(help, /auto-detect exposure, tunnel target, and scope/);
  assert.match(help, /preflight/);
  assert.match(help, /record-smoke/);
  assert.match(help, /record <check-id>/);
  assert.match(help, /--redaction-confirmed/);

  const preflightConfigDir = join(tempRoot, "preflight-config");
  mkdirSync(preflightConfigDir, { recursive: true });
  writeFileSync(join(preflightConfigDir, "config.json"), `${JSON.stringify({ publicMcpOnly: true }, null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [
      { timestamp: freshTimestamp, kind: "dispatcher_forwarded", success: true },
      { timestamp: freshTimestamp, kind: "dispatcher_acknowledged", success: true },
    ],
  }], null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "audit.jsonl"), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "get_computer_info", success: true }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "computer_operation", success: true, workspaceRef: "app", operation: "file.list" }),
    "",
  ].join("\n"));
  const missingHistoryPreflight = runResult(["preflight", "--json"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(missingHistoryPreflight.status, 0);
  const missingHistoryPreflightJson = parseJsonOutput(missingHistoryPreflight.stdout);
  assert.equal(missingHistoryPreflightJson.kind, "computer-linker-alpha-evidence-preflight");
  assert.equal(missingHistoryPreflightJson.status, "fail");
  assert.equal(missingHistoryPreflightJson.observed.publicMcpOnly, true);
  assert.equal(missingHistoryPreflightJson.observed.tunnelOrUrl, "tunnel_preflight123");
  assert.equal(missingHistoryPreflightJson.observed.currentHeadFresh, false);
  assert.ok(missingHistoryPreflightJson.checks.some((check) => check.id === "external-mcp-tool-flow" && check.status === "fail" && check.detail.includes("get_operation_history")));
  assert.ok(missingHistoryPreflightJson.checks.some((check) => check.id === "current-head-observations" && check.status === "fail" && check.detail.includes("get_operation_history")));
  assert.match(missingHistoryPreflightJson.externalClientPrompt, /get_computer_info/);
  assert.match(missingHistoryPreflightJson.externalClientPrompt, /computer_operation/);
  assert.match(missingHistoryPreflightJson.externalClientPrompt, /get_operation_history/);
  assert.match(missingHistoryPreflightJson.externalClientPrompt, /"scope":"app"/);
  assert.match(missingHistoryPreflightJson.nextExternalClientPrompt, /Call get_operation_history/);
  assert.doesNotMatch(missingHistoryPreflightJson.nextExternalClientPrompt, /Call get_computer_info/);
  assert.doesNotMatch(missingHistoryPreflightJson.nextExternalClientPrompt, /Call computer_operation/);
  assert.match(missingHistoryPreflightJson.recordCommand, /alpha:evidence -- smoke/);
  assert.doesNotMatch(missingHistoryPreflightJson.recordCommand, /--tunnel-or-url/);
  assert.match(missingHistoryPreflightJson.explicitRecordCommand, /--tunnel-or-url tunnel_preflight123/);
  assert.ok(missingHistoryPreflightJson.nextActions.some((action) => action.includes("Paste the prompt above")));
  assert.ok(missingHistoryPreflightJson.nextActions.some((action) => action.includes("When this preflight no longer fails")));

  const missingHistoryPreflightText = runResult(["preflight"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(missingHistoryPreflightText.status, 0);
  assert.match(missingHistoryPreflightText.stdout, /status: needs external client action/);
  assert.match(missingHistoryPreflightText.stdout, /MCP tool calls: get_computer_info=yes computer_operation=yes get_operation_history=no/);
  assert.match(missingHistoryPreflightText.stdout, /current HEAD observations: no/);
  assert.match(missingHistoryPreflightText.stdout, /current HEAD: [0-9a-f]{12} committed /);
  assert.match(missingHistoryPreflightText.stdout, /freshness: missing current-HEAD evidence: after [0-9a-f]{12} .*: tool calls: get_operation_history/);
  assert.match(missingHistoryPreflightText.stdout, /missing: get_operation_history/);
  assert.match(missingHistoryPreflightText.stdout, /copy this into the external MCP client:/);
  assert.match(missingHistoryPreflightText.stdout, /record command after the preflight no longer fails:/);
  assert.doesNotMatch(missingHistoryPreflightText.stdout, /checks:/);
  assert.doesNotMatch(missingHistoryPreflightText.stdout, /external-mcp-tool-flow/);
  assert.doesNotMatch(missingHistoryPreflightText.stdout, /operation-history-reviewed/);
  assert.doesNotMatch(missingHistoryPreflightText.stdout, /external client prompt:/);

  const oldTimestamp = new Date(0).toISOString();
  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [
      { timestamp: oldTimestamp, kind: "dispatcher_forwarded", success: true },
      { timestamp: oldTimestamp, kind: "dispatcher_acknowledged", success: true },
    ],
  }], null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "audit.jsonl"), [
    JSON.stringify({ timestamp: oldTimestamp, type: "tool_call", tool: "get_computer_info", success: true }),
    JSON.stringify({ timestamp: oldTimestamp, type: "tool_call", tool: "computer_operation", success: true, workspaceRef: "app", operation: "file.list" }),
    JSON.stringify({ timestamp: oldTimestamp, type: "tool_call", tool: "get_operation_history", success: true }),
    "",
  ].join("\n"));
  const staleHeadPreflightText = runResult(["preflight"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(staleHeadPreflightText.status, 0);
  assert.match(staleHeadPreflightText.stdout, /MCP tool calls: get_computer_info=yes computer_operation=yes get_operation_history=yes/);
  assert.match(staleHeadPreflightText.stdout, /freshness: missing current-HEAD evidence: after [0-9a-f]{12} .*: tool calls: get_computer_info, computer_operation, get_operation_history; tunnel dispatcher traffic/);
  assert.match(staleHeadPreflightText.stdout, /missing: current-HEAD external smoke/);

  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [
      { timestamp: freshTimestamp, kind: "dispatcher_forwarded", success: true },
      { timestamp: freshTimestamp, kind: "dispatcher_acknowledged", success: true },
    ],
  }], null, 2)}\n`);
  writeFileSync(join(preflightConfigDir, "audit.jsonl"), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "get_computer_info", success: true }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "computer_operation", success: true, workspaceRef: "app", operation: "file.list" }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_call", tool: "get_operation_history", success: true }),
    "",
  ].join("\n"));
  const readyPreflight = parseJsonOutput(run(["preflight", "--json"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  }));
  assert.equal(readyPreflight.status, "warn");
  assert.equal(readyPreflight.observed.currentHeadFresh, true);
  assert.ok(readyPreflight.checks.some((check) => check.id === "current-head-observations" && check.status === "pass"));
  assert.ok(readyPreflight.checks.some((check) => check.id === "client-instructions-usable" && check.status === "warn"));
  assert.equal(readyPreflight.nextExternalClientPrompt, undefined);
  assert.match(readyPreflight.recordCommand, /alpha:evidence -- smoke/);
  assert.doesNotMatch(readyPreflight.recordCommand, /--tunnel-or-url/);
  assert.match(readyPreflight.explicitRecordCommand, /--tunnel-or-url tunnel_preflight123/);
  assert.ok(readyPreflight.nextActions.some((action) => action.includes("alpha:evidence -- smoke")));

  const readyPreflightText = run(["preflight"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.match(readyPreflightText, /status: ready after manual confirmation/);
  assert.match(readyPreflightText, /current HEAD observations: yes/);
  assert.match(readyPreflightText, /current HEAD: [0-9a-f]{12} committed /);
  assert.match(readyPreflightText, /freshness: Latest relevant observation: /);
  assert.match(readyPreflightText, /record command:/);
  assert.doesNotMatch(readyPreflightText, /record command after the preflight no longer fails:/);

  const autoSmokeFile = join(tempRoot, "auto-smoke.json");
  const autoSmokeReport = parseJsonOutput(run([
    "smoke",
    "--file",
    autoSmokeFile,
    "--redaction-confirmed",
    "--json",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  }));
  assert.equal(autoSmokeReport.kind, "computer-linker-alpha-evidence-smoke");
  assert.equal(autoSmokeReport.status, "pass");
  assert.equal(autoSmokeReport.client, "External MCP client");
  assert.equal(autoSmokeReport.exposure, "openai");
  assert.equal(autoSmokeReport.tunnelOrUrl, "tunnel_preflight123");
  assert.equal(autoSmokeReport.scope, "app");
  assert.equal(autoSmokeReport.autoDetected.note, true);
  assert.equal(autoSmokeReport.autoDetected.tunnelOrUrl, true);
  assert.equal(autoSmokeReport.preflight.status, "warn");
  assert.equal(autoSmokeReport.preflight.currentHeadFresh, true);
  const autoSmokeEvidence = readEvidence(autoSmokeFile);
  assert.equal(autoSmokeEvidence.target.tunnelOrUrl, "tunnel_preflight123");
  assert.ok(autoSmokeEvidence.checks.every((check) => check.status === "pass"));
  const autoSmokeCheck = parseJsonOutput(run(["check", "--file", autoSmokeFile, "--json"]));
  assert.equal(autoSmokeCheck.status, "pass");

  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_preflight123"],
    events: [],
  }], null, 2)}\n`);
  const missingTunnelPreflight = runResult(["preflight", "--json"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(missingTunnelPreflight.status, 0);
  const missingTunnelPreflightJson = parseJsonOutput(missingTunnelPreflight.stdout);
  assert.equal(missingTunnelPreflightJson.status, "fail");
  assert.match(missingTunnelPreflightJson.nextExternalClientPrompt, /get_computer_info/);
  assert.ok(missingTunnelPreflightJson.nextActions.some((action) => action.includes("external MCP client through the configured tunnel")));
  assert.ok(missingTunnelPreflightJson.nextActions.some((action) => action.includes("Paste the prompt above")));

  const missingTunnelPreflightText = runResult(["preflight"], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(missingTunnelPreflightText.status, 0);
  assert.match(missingTunnelPreflightText.stdout, /MCP tool calls: get_computer_info=yes computer_operation=yes get_operation_history=yes/);
  assert.match(missingTunnelPreflightText.stdout, /freshness: missing current-HEAD evidence: after [0-9a-f]{12} .*: tunnel dispatcher traffic/);
  assert.match(missingTunnelPreflightText.stdout, /missing: tunnel traffic/);
  assert.match(missingTunnelPreflightText.stdout, /copy this into the external MCP client:/);
  assert.match(missingTunnelPreflightText.stdout, /Paste the prompt above/);
  assert.match(missingTunnelPreflightText.stdout, /external MCP client through the configured tunnel/);

  const missingTunnelSmoke = runResult([
    "smoke",
    "--file",
    join(tempRoot, "missing-tunnel-smoke.json"),
    "--redaction-confirmed",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(missingTunnelSmoke.status, 0);
  assert.match(missingTunnelSmoke.stderr, /smoke preflight failed/);
  assert.match(missingTunnelSmoke.stderr, /tunnel-transport/);

  const openAiEvidenceFile = join(tempRoot, "openai.json");
  run([
    "init",
    "--file",
    openAiEvidenceFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_testalpha123",
    "--scope",
    "app",
  ]);
  const openAiEvidence = recordAllEvidence(openAiEvidenceFile);
  assert.equal(openAiEvidence.target.client, "ChatGPT web");
  assert.equal(openAiEvidence.target.exposure, "openai");
  assert.equal(openAiEvidence.target.tunnelOrUrl, "tunnel_testalpha123");
  assert.equal(openAiEvidence.target.mcpPath, "/mcp");
  assert.equal(openAiEvidence.target.scope, "app");
  assert.equal(openAiEvidence.redactionConfirmed, true);
  assert.ok(openAiEvidence.checks.every((check) => check.status === "pass"));
  const openAiReport = parseJsonOutput(run(["check", "--file", openAiEvidenceFile, "--json"]));
  assert.equal(openAiReport.status, "pass");
  assert.ok(openAiReport.checks.some((check) => check.id === "target-tunnel-or-url" && check.status === "pass"));
  assert.ok(openAiReport.checks.some((check) => check.id === "target-mcp-path" && check.status === "pass"));
  assert.ok(openAiReport.checks.some((check) => check.id === "target-scope" && check.status === "pass"));

  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_onecommand123"],
    events: [{ timestamp: freshTimestamp, kind: "dispatcher_forwarded", success: true }],
  }], null, 2)}\n`);
  const oneCommandSmokeFile = join(tempRoot, "one-command-smoke.json");
  const oneCommandSmokeReport = parseJsonOutput(run([
    "smoke",
    "External MCP smoke passed from ChatGPT web through OpenAI tunnel.",
    "--file",
    oneCommandSmokeFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_onecommand123",
    "--scope",
    "app",
    "--redaction-confirmed",
    "--json",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  }));
  assert.equal(oneCommandSmokeReport.kind, "computer-linker-alpha-evidence-smoke");
  assert.equal(oneCommandSmokeReport.status, "pass");
  assert.equal(oneCommandSmokeReport.client, "ChatGPT web");
  assert.equal(oneCommandSmokeReport.tunnelOrUrl, "tunnel_onecommand123");
  assert.equal(oneCommandSmokeReport.scope, "app");
  assert.deepEqual(oneCommandSmokeReport.checks, requiredChecks);
  const oneCommandSmokeEvidence = readEvidence(oneCommandSmokeFile);
  assert.equal(oneCommandSmokeEvidence.target.client, "ChatGPT web");
  assert.equal(oneCommandSmokeEvidence.target.tunnelOrUrl, "tunnel_onecommand123");
  assert.equal(oneCommandSmokeEvidence.redactionConfirmed, true);
  assert.ok(oneCommandSmokeEvidence.checks.every((check) => check.status === "pass"));
  const oneCommandSmokeCheck = parseJsonOutput(run(["check", "--file", oneCommandSmokeFile, "--json"]));
  assert.equal(oneCommandSmokeCheck.status, "pass");
  writeFileSync(join(preflightConfigDir, "tunnels.json"), `${JSON.stringify([{
    provider: "openai",
    args: ["run", "--control-plane.tunnel-id", "tunnel_replacement123"],
    events: [{ timestamp: freshTimestamp, kind: "dispatcher_forwarded", success: true }],
  }], null, 2)}\n`);
  const oneCommandRefresh = parseJsonOutput(run([
    "smoke",
    "External MCP smoke refreshed existing evidence after a new current-HEAD test.",
    "--file",
    oneCommandSmokeFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_replacement123",
    "--redaction-confirmed",
    "--json",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  }));
  assert.equal(oneCommandRefresh.status, "pass");
  assert.equal(oneCommandRefresh.refreshedExistingEvidence, true);
  assert.equal(readEvidence(oneCommandSmokeFile).target.tunnelOrUrl, "tunnel_replacement123");

  const nonEvidenceFile = join(tempRoot, "not-alpha-evidence.json");
  writeFileSync(nonEvidenceFile, `${JSON.stringify({ kind: "not-alpha-evidence" }, null, 2)}\n`);
  const nonEvidenceNoOverwrite = runResult([
    "smoke",
    "External MCP smoke should not replace unrelated files without force.",
    "--file",
    nonEvidenceFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_replacement123",
    "--redaction-confirmed",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: preflightConfigDir },
  });
  assert.notEqual(nonEvidenceNoOverwrite.status, 0);
  assert.match(nonEvidenceNoOverwrite.stderr, /already exists; pass --force/);
  assert.equal(readEvidence(nonEvidenceFile).kind, "not-alpha-evidence");

  const smokeEvidenceFile = join(tempRoot, "record-smoke.json");
  run([
    "init",
    "--file",
    smokeEvidenceFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_smokealpha123",
    "--scope",
    "app",
  ]);
  const smokeRecordReport = parseJsonOutput(run([
    "record-smoke",
    "External MCP smoke passed from ChatGPT web through OpenAI tunnel.",
    "--file",
    smokeEvidenceFile,
    "--redaction-confirmed",
    "--json",
  ]));
  assert.equal(smokeRecordReport.kind, "computer-linker-alpha-evidence-record-smoke");
  assert.equal(smokeRecordReport.status, "pass");
  assert.equal(smokeRecordReport.redactionConfirmed, true);
  assert.deepEqual(smokeRecordReport.checks, requiredChecks);
  const smokeEvidence = readEvidence(smokeEvidenceFile);
  assert.equal(smokeEvidence.redactionConfirmed, true);
  assert.ok(smokeEvidence.checks.every((check) => check.status === "pass"));
  assert.ok(smokeEvidence.checks.every((check) => check.evidence.includes("External MCP smoke passed")));
  const smokeReport = parseJsonOutput(run(["check", "--file", smokeEvidenceFile, "--json"]));
  assert.equal(smokeReport.status, "pass");

  const recordReport = parseJsonOutput(run([
    "record",
    "client-instructions-usable",
    "Updated concrete agent instruction evidence note from the record command.",
    "--file",
    openAiEvidenceFile,
    "--redaction-confirmed",
    "--json",
  ]));
  assert.equal(recordReport.kind, "computer-linker-alpha-evidence-record");
  assert.equal(recordReport.checkId, "client-instructions-usable");
  assert.equal(recordReport.redactionConfirmed, true);

  const cloudflareEvidenceFile = join(tempRoot, "cloudflare.json");
  run([
    "init",
    "--file",
    cloudflareEvidenceFile,
    "--client",
    "Claude Desktop",
    "--exposure",
    "cloudflare",
    "--tunnel-or-url",
    "https://mcp.example.test",
    "--scope",
    "repo",
  ]);
  recordAllEvidence(cloudflareEvidenceFile);
  const cloudflareReport = parseJsonOutput(run(["check", "--file", cloudflareEvidenceFile, "--json"]));
  assert.equal(cloudflareReport.status, "pass");

  const placeholderEvidenceFile = join(tempRoot, "placeholder.json");
  run(["init", "--file", placeholderEvidenceFile]);
  recordAllEvidence(placeholderEvidenceFile);
  const placeholderReport = runResult(["check", "--file", placeholderEvidenceFile, "--json"]);
  assert.notEqual(placeholderReport.status, 0);
  const placeholderJson = parseJsonOutput(placeholderReport.stdout);
  assert.equal(placeholderJson.status, "fail");
  assert.ok(placeholderJson.checks.some((check) => check.id === "target-client" && check.status === "fail"));
  assert.ok(placeholderJson.checks.some((check) => check.id === "target-tunnel-or-url" && check.status === "fail"));

  const badUrlEvidenceFile = join(tempRoot, "bad-url.json");
  run([
    "init",
    "--file",
    badUrlEvidenceFile,
    "--client",
    "External MCP Client",
    "--exposure",
    "tailscale",
    "--tunnel-or-url",
    "http://mcp.example.test",
  ]);
  recordAllEvidence(badUrlEvidenceFile);
  const badUrlReport = runResult(["check", "--file", badUrlEvidenceFile, "--json"]);
  assert.notEqual(badUrlReport.status, 0);
  const badUrlJson = parseJsonOutput(badUrlReport.stdout);
  assert.equal(badUrlJson.status, "fail");
  assert.ok(badUrlJson.checks.some((check) => check.id === "target-tunnel-or-url" && check.status === "fail"));

  const badRecord = runResult([
    "record",
    "not-a-required-check",
    "Concrete but invalid check id evidence note.",
    "--file",
    openAiEvidenceFile,
  ]);
  assert.notEqual(badRecord.status, 0);
  assert.match(badRecord.stderr, /record check-id must be one of/);

  const missingRedactionEvidenceFile = join(tempRoot, "missing-redaction-smoke.json");
  run([
    "init",
    "--file",
    missingRedactionEvidenceFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_missingredaction123",
  ]);
  const missingRedactionSmoke = runResult([
    "record-smoke",
    "External MCP smoke passed but redaction was not confirmed.",
    "--file",
    missingRedactionEvidenceFile,
  ]);
  assert.notEqual(missingRedactionSmoke.status, 0);
  assert.match(missingRedactionSmoke.stderr, /record-smoke requires --redaction-confirmed/);
  assert.ok(readEvidence(missingRedactionEvidenceFile).checks.every((check) => check.status === "pending"));

  const missingTargetSmoke = runResult([
    "smoke",
    "External MCP smoke cannot be accepted without a tunnel target.",
    "--file",
    join(tempRoot, "missing-target-smoke.json"),
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--redaction-confirmed",
  ], {
    env: { COMPUTER_LINKER_CONFIG_DIR: join(tempRoot, "empty-config") },
  });
  assert.notEqual(missingTargetSmoke.status, 0);
  assert.match(missingTargetSmoke.stderr, /could not auto-detect --tunnel-or-url/);

  const secretRecordEvidenceFile = join(tempRoot, "secret-record.json");
  run([
    "init",
    "--file",
    secretRecordEvidenceFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "tunnel_secretcheck123",
  ]);
  const secretRecord = runResult([
    "record",
    "external-mcp-tool-flow",
    "The client used Authorization: Bearer abcdefghijklmnop during testing.",
    "--file",
    secretRecordEvidenceFile,
  ]);
  assert.notEqual(secretRecord.status, 0);
  assert.match(secretRecord.stderr, /record evidence note contains common secret-shaped values/);
  assert.equal(readEvidence(secretRecordEvidenceFile).checks[0].status, "pending");

  const secretSmoke = runResult([
    "record-smoke",
    "The client used Authorization: Bearer abcdefghijklmnop during testing.",
    "--file",
    secretRecordEvidenceFile,
    "--redaction-confirmed",
  ]);
  assert.notEqual(secretSmoke.status, 0);
  assert.match(secretSmoke.stderr, /record-smoke evidence note contains common secret-shaped values/);
  assert.equal(readEvidence(secretRecordEvidenceFile).checks[0].status, "pending");

  const secretInitFile = join(tempRoot, "secret-init.json");
  const secretInit = runResult([
    "init",
    "--file",
    secretInitFile,
    "--client",
    "ChatGPT web",
    "--exposure",
    "openai",
    "--tunnel-or-url",
    "Authorization: Bearer abcdefghijklmnop",
  ]);
  assert.notEqual(secretInit.status, 0);
  assert.match(secretInit.stderr, /init target details contain common secret-shaped values/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("alpha evidence tests ok");
