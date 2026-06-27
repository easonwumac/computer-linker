#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const DEFAULT_EVIDENCE_FILE = ".computer-linker-alpha-evidence.json";
const REQUIRED_CHECKS = [
  "external-mcp-tool-flow",
  "tunnel-transport",
  "mcp-only-public-surface",
  "operation-history-reviewed",
  "client-instructions-usable",
];
const PUBLIC_EXPOSURES = new Set(["openai", "cloudflare", "tailscale", "manual-reverse-proxy"]);
const LOCAL_EXPOSURES = new Set(["local"]);
const ALL_EXPOSURES = new Set([...PUBLIC_EXPOSURES, ...LOCAL_EXPOSURES]);
const DEFAULT_EXTERNAL_CLIENT_NAME = "External MCP client";
const DEFAULT_SMOKE_NOTE = "External MCP smoke passed: get_computer_info, computer_operation, get_operation_history, tunnel transport, MCP-only public surface, and history review.";

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.shift() : "check";
const booleanFlags = new Set(["--force", "--json", "--allow-head-mismatch", "--allow-local-only", "--redaction-confirmed", "--help"]);
const valueFlags = new Set(["--file", "--max-age-days", "--client", "--exposure", "--tunnel-or-url", "--scope"]);
const flags = new Set();
const values = new Map();
const positionals = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (booleanFlags.has(arg)) {
    flags.add(arg);
    continue;
  }
  if (valueFlags.has(arg)) {
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${arg}`);
    }
    values.set(arg, value);
    index += 1;
    continue;
  }
  if ((command === "record" || command === "record-smoke" || command === "smoke") && !arg.startsWith("--")) {
    positionals.push(arg);
    continue;
  }
  fail(`unknown option ${arg}`);
}

if (command === "help" || flags.has("--help")) {
  printHelp();
  process.exit(0);
}

if (command !== "init" && command !== "check" && command !== "record" && command !== "record-smoke" && command !== "smoke" && command !== "preflight") {
  fail(`unknown command ${command}`);
}

const file = resolve(values.get("--file") ?? DEFAULT_EVIDENCE_FILE);
const jsonOutput = flags.has("--json");

if (command === "init") {
  initEvidence(file, flags.has("--force"), {
    client: values.get("--client"),
    exposure: values.get("--exposure"),
    tunnelOrUrl: values.get("--tunnel-or-url"),
    scope: values.get("--scope"),
  });
} else if (command === "record") {
  recordEvidence(file, {
    checkId: positionals[0],
    note: positionals[1],
    redactionConfirmed: flags.has("--redaction-confirmed"),
    jsonOutput,
  });
} else if (command === "record-smoke") {
  recordSmokeEvidence(file, {
    note: positionals[0],
    redactionConfirmed: flags.has("--redaction-confirmed"),
    jsonOutput,
  });
} else if (command === "smoke") {
  smokeEvidence(file, flags.has("--force"), {
    client: values.get("--client"),
    exposure: values.get("--exposure"),
    tunnelOrUrl: values.get("--tunnel-or-url"),
    scope: values.get("--scope"),
    note: positionals[0],
    redactionConfirmed: flags.has("--redaction-confirmed"),
    jsonOutput,
  });
} else if (command === "preflight") {
  preflightEvidence({
    client: values.get("--client"),
    exposure: values.get("--exposure"),
    tunnelOrUrl: values.get("--tunnel-or-url"),
    scope: values.get("--scope"),
    jsonOutput,
  });
} else {
  checkEvidence(file, {
    maxAgeDays: readPositiveInteger("--max-age-days", 14),
    allowHeadMismatch: flags.has("--allow-head-mismatch"),
    allowLocalOnly: flags.has("--allow-local-only"),
    jsonOutput,
  });
}

function printHelp() {
  console.log([
    "Computer Linker alpha evidence",
    "",
    "Usage:",
    "  node scripts/alpha-evidence.mjs init [--file path] [--client name] [--exposure name] [--tunnel-or-url value] [--scope id] [--force]",
    "  node scripts/alpha-evidence.mjs smoke [\"external MCP smoke note\"] [--client name] [--exposure name] [--tunnel-or-url value] [--scope id] [--file path] [--force] --redaction-confirmed",
    "  node scripts/alpha-evidence.mjs preflight [--client name] [--exposure name] [--tunnel-or-url value] [--scope id] [--json]",
    "  node scripts/alpha-evidence.mjs record-smoke \"external MCP smoke note\" [--file path] --redaction-confirmed",
    "  node scripts/alpha-evidence.mjs record <check-id> \"evidence note\" [--file path] [--redaction-confirmed]",
    "  node scripts/alpha-evidence.mjs check [--file path] [--json]",
    "",
    "Options:",
    `  --file path             Evidence JSON path. Default: ${DEFAULT_EVIDENCE_FILE}`,
    "  --client name           External MCP client name for init/smoke. Example: Claude Desktop or ChatGPT web.",
    "  --exposure name         openai, cloudflare, tailscale, manual-reverse-proxy, or local.",
    "  --tunnel-or-url value   OpenAI tunnel id or public HTTPS origin for init/smoke.",
    "  --scope id              Workspace scope used in the external test. Default: app.",
    "  --max-age-days days     Maximum accepted evidence age. Default: 14.",
    "  --allow-head-mismatch   Do not require evidence git.head to match current HEAD.",
    "  --allow-local-only      Allow local-only evidence instead of a public tunnel.",
    "  --redaction-confirmed   With smoke, record-smoke, or record, mark evidence as free of secrets and sensitive payloads.",
    "  --json                  Print machine-readable check output.",
    "",
    "Smoke defaults:",
    "  smoke can auto-detect exposure, tunnel target, and scope from local preflight state.",
    "  Pass explicit options only when auto-detection cannot find the tested tunnel target.",
    "",
    "Required check ids:",
    `  ${REQUIRED_CHECKS.join(", ")}`,
  ].join("\n"));
}

function initEvidence(filePath, force, initOptions = {}, options = {}) {
  if (existsSync(filePath) && !force) {
    if (!options.refreshExistingEvidence || !isAlphaEvidenceFile(filePath)) {
      fail(`${filePath} already exists; pass --force to replace it.`);
    }
  }
  const exposure = initOptions.exposure ?? "openai";
  if (!ALL_EXPOSURES.has(exposure)) {
    fail(`--exposure must be one of: ${[...ALL_EXPOSURES].join(", ")}`);
  }
  const initSecretFindings = findSecretLikeValues(JSON.stringify(initOptions));
  if (initSecretFindings.length > 0) {
    fail(`init target details contain common secret-shaped values: ${initSecretFindings.join(", ")}`);
  }
  const packageJson = readPackageJson();
  const fullHead = git(["rev-parse", "HEAD"], { allowFailure: true });
  const shortHead = git(["rev-parse", "--short=12", "HEAD"], { allowFailure: true });
  const evidence = {
    kind: "computer-linker-alpha-evidence",
    schemaVersion: 1,
    testedAt: new Date().toISOString(),
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    git: {
      head: fullHead || shortHead || "unknown",
      shortHead: shortHead || "unknown",
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    target: {
      client: initOptions.client ?? "replace-with-external-mcp-client",
      exposure,
      tunnelOrUrl: initOptions.tunnelOrUrl ?? targetPlaceholder(exposure),
      mcpPath: "/mcp",
      scope: initOptions.scope ?? "app",
    },
    checks: REQUIRED_CHECKS.map((id) => ({
      id,
      status: "pending",
      evidence: describeEvidence(id),
    })),
    redactionConfirmed: false,
    notes: "Do not store owner tokens, API keys, bearer headers, screenshots, or private file contents in this evidence file.",
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  if (!options.quiet) {
    console.log(`alpha evidence template written: ${filePath}`);
  }
  return evidence;
}

function recordEvidence(filePath, options) {
  if (!options.checkId || !REQUIRED_CHECKS.includes(options.checkId)) {
    fail(`record check-id must be one of: ${REQUIRED_CHECKS.join(", ")}`);
  }
  validateRecordNote(options.note, "record evidence note");
  const evidence = loadEvidenceForRecord(filePath);

  const check = evidence.checks.find((item) => item?.id === options.checkId);
  if (!check) {
    fail(`Evidence file does not contain required check ${options.checkId}. Re-run init or add the missing check.`);
  }
  check.status = "pass";
  check.evidence = options.note.trim();
  evidence.testedAt = new Date().toISOString();
  if (options.redactionConfirmed) {
    evidence.redactionConfirmed = true;
  }

  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const report = {
    kind: "computer-linker-alpha-evidence-record",
    schemaVersion: 1,
    file: filePath,
    checkId: options.checkId,
    status: "pass",
    redactionConfirmed: evidence.redactionConfirmed === true,
  };
  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`alpha evidence recorded: ${options.checkId}`);
    if (options.redactionConfirmed) console.log("redaction confirmed: yes");
  }
}

function recordSmokeEvidence(filePath, options, output = {}) {
  if (!options.redactionConfirmed) {
    fail("record-smoke requires --redaction-confirmed after verifying notes contain no owner tokens, API keys, bearer headers, screenshots, or private file contents.");
  }
  validateRecordNote(options.note, "record-smoke evidence note");
  const evidence = loadEvidenceForRecord(filePath);
  const note = options.note.trim();

  for (const requiredId of REQUIRED_CHECKS) {
    const check = evidence.checks.find((item) => item?.id === requiredId);
    if (!check) {
      fail(`Evidence file does not contain required check ${requiredId}. Re-run init or add the missing check.`);
    }
    check.status = "pass";
    check.evidence = `${note} ${describeEvidence(requiredId)}`;
  }
  evidence.testedAt = new Date().toISOString();
  evidence.redactionConfirmed = true;

  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const report = {
    kind: "computer-linker-alpha-evidence-record-smoke",
    schemaVersion: 1,
    file: filePath,
    status: "pass",
    checks: REQUIRED_CHECKS,
    redactionConfirmed: true,
  };
  if (output.quiet) return report;
  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("alpha evidence smoke recorded: all required checks");
    console.log("redaction confirmed: yes");
  }
  return report;
}

function smokeEvidence(filePath, force, options) {
  if (!options.redactionConfirmed) {
    fail("smoke requires --redaction-confirmed after verifying notes contain no owner tokens, API keys, bearer headers, screenshots, or private file contents.");
  }
  const defaults = detectedSmokeDefaults();
  const resolved = {
    client: options.client ?? DEFAULT_EXTERNAL_CLIENT_NAME,
    exposure: options.exposure ?? defaults.exposure ?? "openai",
    tunnelOrUrl: options.tunnelOrUrl ?? defaults.tunnelOrUrl,
    scope: options.scope ?? defaults.scope ?? "app",
    note: options.note ?? DEFAULT_SMOKE_NOTE,
  };
  if (!ALL_EXPOSURES.has(resolved.exposure)) {
    fail(`smoke --exposure must be one of: ${[...ALL_EXPOSURES].join(", ")}`);
  }
  if (!resolved.tunnelOrUrl) {
    fail("smoke could not auto-detect --tunnel-or-url from recent tunnel state. Run `npm run alpha:evidence -- preflight` after the external client connects, or pass --tunnel-or-url explicitly.");
  }
  const preflight = buildEvidencePreflightReport({
    client: resolved.client,
    exposure: resolved.exposure,
    tunnelOrUrl: resolved.tunnelOrUrl,
    scope: resolved.scope,
  });
  if (preflight.status === "fail") {
    const failedChecks = preflight.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.id}${check.detail ? ` (${check.detail})` : ""}`)
      .join("; ");
    fail(`smoke preflight failed: ${failedChecks}. Run \`npm run alpha:evidence -- preflight\`, complete the printed external-client action, then rerun smoke.`);
  }
  const refreshedExistingEvidence = existsSync(filePath) && isAlphaEvidenceFile(filePath);
  initEvidence(filePath, force, {
    client: resolved.client,
    exposure: resolved.exposure,
    tunnelOrUrl: resolved.tunnelOrUrl,
    scope: resolved.scope,
  }, { quiet: true, refreshExistingEvidence: true });
  const recordReport = recordSmokeEvidence(filePath, {
    note: resolved.note,
    redactionConfirmed: true,
    jsonOutput: false,
  }, { quiet: true });
  const report = {
    kind: "computer-linker-alpha-evidence-smoke",
    schemaVersion: 1,
    file: filePath,
    status: "pass",
    client: resolved.client,
    exposure: resolved.exposure,
    tunnelOrUrl: resolved.tunnelOrUrl,
    scope: resolved.scope,
    refreshedExistingEvidence,
    autoDetected: {
      client: options.client === undefined,
      exposure: options.exposure === undefined && defaults.exposure !== undefined,
      tunnelOrUrl: options.tunnelOrUrl === undefined,
      scope: options.scope === undefined && defaults.scope !== undefined,
      note: options.note === undefined,
    },
    checks: recordReport.checks,
    redactionConfirmed: true,
    preflight: {
      status: preflight.status,
      currentHeadFresh: preflight.observed.currentHeadFresh === true,
    },
  };
  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`alpha evidence smoke ${refreshedExistingEvidence ? "refreshed" : "written"}: ${filePath}`);
    console.log(`client: ${resolved.client}`);
    console.log(`exposure: ${resolved.exposure}`);
    console.log(`tunnel target: ${resolved.tunnelOrUrl}`);
    console.log(`scope: ${resolved.scope}`);
    console.log(`checks recorded: ${recordReport.checks.length}`);
    console.log("redaction confirmed: yes");
  }
}

function detectedSmokeDefaults() {
  const configDir = workspaceLinkerConfigDir();
  const auditEvents = readJsonl(resolve(configDir, "audit.jsonl"));
  const tunnelSnapshots = readOptionalJson(resolve(configDir, "tunnels.json"));
  const tunnelEvents = collectTunnelEvents(tunnelSnapshots);
  return {
    exposure: detectedExposure(tunnelSnapshots, tunnelEvents),
    tunnelOrUrl: detectedTunnelOrUrl(tunnelSnapshots, tunnelEvents),
    scope: detectedScope(auditEvents),
  };
}

function isAlphaEvidenceFile(filePath) {
  try {
    const evidence = JSON.parse(readFileSync(filePath, "utf8"));
    return evidence?.kind === "computer-linker-alpha-evidence";
  } catch {
    return false;
  }
}

function preflightEvidence(options) {
  const report = buildEvidencePreflightReport(options);
  const failures = report.checks.filter((check) => check.status === "fail");
  if (failures.length > 0) process.exitCode = 1;

  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const observed = report.observed;
  const tools = observed.tools ?? {};
  const missingToolCalls = Object.entries(tools)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  console.log("Computer Linker alpha evidence preflight");
  console.log(`status: ${preflightTextStatus(report.status)}`);
  console.log("observed:");
  console.log(`  tunnel traffic: ${observed.dispatcherEvents > 0 ? `yes (${observed.dispatcherEvents} events)` : "no"}`);
  console.log(`  MCP-only public surface: ${observed.publicMcpOnly ? "yes" : "no"}`);
  console.log(`  MCP tool calls: get_computer_info=${tools.get_computer_info ? "yes" : "no"} computer_operation=${tools.computer_operation ? "yes" : "no"} get_operation_history=${tools.get_operation_history ? "yes" : "no"}`);
  console.log(`  current HEAD observations: ${observed.currentHeadFresh ? "yes" : "no"}`);
  const headSummary = preflightHeadSummary(observed.currentHead);
  if (headSummary) console.log(`  current HEAD: ${headSummary}`);
  const freshnessDetail = preflightFreshnessDetail(report.checks);
  if (freshnessDetail) console.log(`  freshness: ${freshnessDetail}`);
  if (missingToolCalls.length > 0) {
    console.log(`missing: ${missingToolCalls.join(", ")}`);
  } else if (failures.length > 0) {
    console.log(`missing: ${failures.map(preflightMissingLabel).join(", ")}`);
  } else {
    console.log("missing: none");
  }
  if (report.nextExternalClientPrompt) {
    console.log("copy this into the external MCP client:");
    console.log(indentBlock(report.nextExternalClientPrompt, "  "));
  }
  console.log(failures.length > 0
    ? "record command after the preflight no longer fails:"
    : "record command:");
  console.log(`  ${report.recordCommand}`);
  console.log("debug:");
  console.log("  rerun with --json to inspect raw checks, configDir, and observed audit/tunnel counts.");
  console.log("next actions:");
  for (const action of report.nextActions) {
    console.log(`  - ${action}`);
  }
}

function buildEvidencePreflightReport(options) {
  const configDir = workspaceLinkerConfigDir();
  const config = readOptionalJson(resolve(configDir, "config.json"));
  const auditEvents = readJsonl(resolve(configDir, "audit.jsonl"));
  const tunnelSnapshots = readOptionalJson(resolve(configDir, "tunnels.json"));
  const tunnelEvents = collectTunnelEvents(tunnelSnapshots);
  const exposure = options.exposure ?? detectedExposure(tunnelSnapshots, tunnelEvents) ?? "openai";
  const detectedTarget = options.tunnelOrUrl ?? detectedTunnelOrUrl(tunnelSnapshots, tunnelEvents);
  const tunnelOrUrl = detectedTarget ?? "tunnel_...";
  const scope = options.scope ?? detectedScope(auditEvents) ?? "app";

  const successfulToolCalls = auditEvents.filter((event) => event?.type === "tool_call" && event.success === true);
  const hasGetComputerInfo = successfulToolCalls.some((event) => event.tool === "get_computer_info");
  const hasComputerOperation = successfulToolCalls.some((event) => event.tool === "computer_operation");
  const hasGetOperationHistory = successfulToolCalls.some((event) => event.tool === "get_operation_history");
  const requiredToolCalls = [
    ["get_computer_info", hasGetComputerInfo],
    ["computer_operation", hasComputerOperation],
    ["get_operation_history", hasGetOperationHistory],
  ];
  const missingToolCalls = requiredToolCalls.filter(([, present]) => !present).map(([name]) => name);
  const dispatcherEvents = tunnelEvents.filter((event) => (
    event.success !== false &&
    (event.kind === "dispatcher_forwarded" || event.kind === "dispatcher_acknowledged" || event.operation === "dispatcher_forwarded" || event.operation === "dispatcher_acknowledged")
  ));
  const publicMcpOnly = config?.publicMcpOnly === true;
  const currentHead = currentGitHead();
  const freshness = currentHeadObservationFreshness({
    requiredToolCalls,
    successfulToolCalls,
    dispatcherEvents,
    currentHead,
  });

  const checks = [
    {
      id: "external-mcp-tool-flow",
      status: hasGetComputerInfo && hasComputerOperation && hasGetOperationHistory ? "pass" : "fail",
      message: "Requires successful get_computer_info, computer_operation, and get_operation_history tool calls.",
      detail: missingList([
        ["get_computer_info", hasGetComputerInfo],
        ["computer_operation", hasComputerOperation],
        ["get_operation_history", hasGetOperationHistory],
      ]),
    },
    {
      id: "tunnel-transport",
      status: dispatcherEvents.length > 0 ? "pass" : "fail",
      message: "Observed tunnel dispatcher traffic reaching the local MCP server.",
      detail: dispatcherEvents.length > 0 ? `${dispatcherEvents.length} dispatcher events` : "No dispatcher_forwarded or dispatcher_acknowledged tunnel events found.",
    },
    {
      id: "mcp-only-public-surface",
      status: publicMcpOnly ? "pass" : "fail",
      message: "Config has publicMcpOnly enabled.",
      detail: publicMcpOnly ? undefined : `${resolve(configDir, "config.json")} does not set publicMcpOnly: true.`,
    },
    {
      id: "evidence-target",
      status: detectedTarget ? "pass" : "fail",
      message: "Detected a concrete tunnel id or public URL for evidence recording.",
      detail: detectedTarget ? undefined : "Start a tunnel and send one external request, or pass --tunnel-or-url explicitly.",
    },
    {
      id: "current-head-observations",
      status: freshness.status,
      message: "Requires external MCP tool calls and tunnel dispatcher traffic after the current Git HEAD.",
      detail: freshness.detail,
    },
    {
      id: "operation-history-reviewed",
      status: hasGetOperationHistory ? "pass" : "fail",
      message: "Requires get_operation_history so the external client can review recent actions.",
      detail: hasGetOperationHistory ? undefined : "Ask the external MCP client to call get_operation_history with view=connections or view=last.",
    },
    {
      id: "client-instructions-usable",
      status: "warn",
      message: "Manual confirmation is still required.",
      detail: "Verify the README Agent Instructions were pasted into the external client and produced the expected first operations.",
    },
  ];
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const externalClientPrompt = externalSmokePrompt(scope);
  const needsFreshCurrentHeadPrompt = freshness.status === "fail";
  const nextExternalClientPrompt = missingToolCalls.length > 0
    ? externalMissingPrompt(scope, missingToolCalls)
    : needsFreshCurrentHeadPrompt ? externalClientPrompt : undefined;
  const recordCommand = "npm run alpha:evidence -- smoke --redaction-confirmed";
  const explicitRecordCommand = `npm run alpha:evidence -- smoke "${DEFAULT_SMOKE_NOTE}" --client "${options.client ?? DEFAULT_EXTERNAL_CLIENT_NAME}" --exposure ${exposure} --tunnel-or-url ${tunnelOrUrl} --scope ${scope} --redaction-confirmed`;
  const nextActions = preflightNextActions({
    failures,
    missingToolCalls,
    recordCommand,
  });
  const report = {
    kind: "computer-linker-alpha-evidence-preflight",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    configDir,
    observed: {
      auditEvents: auditEvents.length,
      tunnelEvents: tunnelEvents.length,
      dispatcherEvents: dispatcherEvents.length,
      publicMcpOnly,
      tools: {
        get_computer_info: hasGetComputerInfo,
        computer_operation: hasComputerOperation,
        get_operation_history: hasGetOperationHistory,
      },
      exposure,
      tunnelOrUrl,
      scope,
      currentHead,
      currentHeadFresh: freshness.status === "pass",
    },
    checks,
    externalClientPrompt,
    ...(nextExternalClientPrompt ? { nextExternalClientPrompt } : {}),
    recordCommand,
    explicitRecordCommand,
    nextActions,
  };
  return report;
}

function preflightTextStatus(status) {
  if (status === "pass") return "ready";
  if (status === "warn") return "ready after manual confirmation";
  return "needs external client action";
}

function preflightHeadSummary(currentHead) {
  if (!currentHead || typeof currentHead !== "object") return undefined;
  const shortHead = currentHead.shortHead && currentHead.shortHead !== "unknown"
    ? currentHead.shortHead
    : currentHead.head && currentHead.head !== "unknown" ? String(currentHead.head).slice(0, 12) : undefined;
  if (!shortHead) return undefined;
  return currentHead.committedAt ? `${shortHead} committed ${currentHead.committedAt}` : shortHead;
}

function preflightFreshnessDetail(checks) {
  const check = checks.find((item) => item.id === "current-head-observations");
  if (!check?.detail) return undefined;
  if (check.status === "pass") return check.detail;
  const missing = check.detail
    .replace(/^Missing current-HEAD observations /, "")
    .replace(/^Missing /, "")
    .replace(/\. Rerun the external smoke prompt.*$/i, "");
  return `missing current-HEAD evidence: ${missing}.`;
}

function preflightNextActions({ failures, missingToolCalls, recordCommand }) {
  if (failures.length === 0) {
    return [
      "Confirm the external client used the README Agent Instructions and no secrets or private payloads are recorded.",
      `Run: ${recordCommand}`,
    ];
  }

  const failedIds = new Set(failures.map((check) => check.id));
  const actions = [];
  if (missingToolCalls.length > 0) {
    actions.push("Paste the prompt above into the external MCP client, then rerun this preflight.");
  }
  if (failedIds.has("tunnel-transport")) {
    actions.push("Send one request from the external MCP client through the configured tunnel, then rerun this preflight.");
  }
  if (failedIds.has("mcp-only-public-surface")) {
    actions.push("Start Computer Linker with `here --tunnel ...` inside the folder, use `start <workspace-path> --tunnel ...` from elsewhere, or rerun setup with a tunnel so publicMcpOnly is enabled.");
  }
  if (failedIds.has("evidence-target")) {
    actions.push("Start a tunnel and send one external request so preflight can detect the tunnel id or public URL, or pass --tunnel-or-url explicitly.");
  }
  if (failedIds.has("current-head-observations")) {
    actions.push("Paste the prompt above into the external MCP client for the current Git HEAD, then rerun this preflight.");
  }
  actions.push(`When this preflight no longer fails, run: ${recordCommand}`);
  actions.push("Use `node dist/cli.js history --view connections` to inspect tunnel sessions if traffic is unclear.");
  return actions;
}

function preflightMissingLabel(check) {
  if (check.id === "tunnel-transport") return "tunnel traffic";
  if (check.id === "mcp-only-public-surface") return "MCP-only public surface";
  if (check.id === "evidence-target") return "tunnel target";
  if (check.id === "current-head-observations") return "current-HEAD external smoke";
  if (check.id === "operation-history-reviewed") return "get_operation_history";
  if (check.id === "external-mcp-tool-flow") return "required MCP tool calls";
  return check.message;
}

function currentGitHead() {
  const head = git(["rev-parse", "HEAD"], { allowFailure: true });
  const shortHead = git(["rev-parse", "--short=12", "HEAD"], { allowFailure: true });
  const committedAt = git(["show", "-s", "--format=%cI", "HEAD"], { allowFailure: true });
  const committedAtMs = Date.parse(committedAt);
  return {
    head: head || "unknown",
    shortHead: shortHead || "unknown",
    committedAt: Number.isFinite(committedAtMs) ? committedAt : undefined,
    committedAtMs: Number.isFinite(committedAtMs) ? committedAtMs : undefined,
  };
}

function currentHeadObservationFreshness({ requiredToolCalls, successfulToolCalls, dispatcherEvents, currentHead }) {
  if (!currentHead.committedAtMs) {
    return {
      status: "warn",
      detail: "Could not determine the current Git HEAD commit time; rerun the external smoke prompt before recording evidence if the commit changed.",
    };
  }

  const missingFreshToolCalls = requiredToolCalls
    .filter(([name]) => !successfulToolCalls.some((event) => event.tool === name && eventAfter(event, currentHead.committedAtMs)))
    .map(([name]) => name);
  const hasFreshDispatcherEvent = dispatcherEvents.some((event) => eventAfter(event, currentHead.committedAtMs));
  const latestObservation = latestEventTimestamp([
    ...successfulToolCalls.filter((event) => requiredToolCalls.some(([name]) => event.tool === name)),
    ...dispatcherEvents,
  ]);

  if (missingFreshToolCalls.length === 0 && hasFreshDispatcherEvent) {
    return {
      status: "pass",
      detail: latestObservation ? `Latest relevant observation: ${latestObservation}.` : undefined,
    };
  }

  const missing = [
    ...(missingFreshToolCalls.length > 0 ? [`tool calls: ${missingFreshToolCalls.join(", ")}`] : []),
    ...(!hasFreshDispatcherEvent ? ["tunnel dispatcher traffic"] : []),
  ];
  const headLabel = currentHead.shortHead && currentHead.shortHead !== "unknown" ? currentHead.shortHead : "current HEAD";
  return {
    status: "fail",
    detail: `Missing current-HEAD observations after ${headLabel} (${currentHead.committedAt}): ${missing.join("; ")}. Rerun the external smoke prompt against the current commit before recording evidence.`,
  };
}

function eventAfter(event, timestampMs) {
  const eventTimestampMs = Date.parse(String(event?.timestamp ?? ""));
  return Number.isFinite(eventTimestampMs) && eventTimestampMs > timestampMs;
}

function latestEventTimestamp(events) {
  const timestamps = events
    .map((event) => Date.parse(String(event?.timestamp ?? "")))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  return timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : undefined;
}

function loadEvidenceForRecord(filePath) {
  if (!existsSync(filePath)) {
    fail(`Evidence file does not exist: ${filePath}. Run init first.`);
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Evidence file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (evidence.kind !== "computer-linker-alpha-evidence") {
    fail("Evidence kind must be computer-linker-alpha-evidence.");
  }
  if (!Array.isArray(evidence.checks)) {
    fail("Evidence must contain a checks array.");
  }
  return evidence;
}

function validateRecordNote(note, label) {
  if (typeof note !== "string" || note.trim().length < 12 || /pending|todo|tbd/i.test(note)) {
    fail(`${label} must be concrete, at least 12 characters, and not pending/todo/tbd.`);
  }
  const noteSecretFindings = findSecretLikeValues(note);
  if (noteSecretFindings.length > 0) {
    fail(`${label} contains common secret-shaped values: ${noteSecretFindings.join(", ")}`);
  }
}

function checkEvidence(filePath, options) {
  const checks = [];
  const add = (id, status, message, detail) => {
    checks.push({
      id,
      status,
      message,
      ...(detail ? { detail } : {}),
    });
  };

  if (!existsSync(filePath)) {
    add("file", "fail", `Evidence file does not exist: ${filePath}`);
    printReport({ filePath, checks, options });
    process.exitCode = 1;
    return;
  }

  let evidence;
  try {
    evidence = JSON.parse(readFileSync(filePath, "utf8"));
    add("json", "pass", "Evidence file is valid JSON.");
  } catch (error) {
    add("json", "fail", "Evidence file is not valid JSON.", error instanceof Error ? error.message : String(error));
    printReport({ filePath, checks, options });
    process.exitCode = 1;
    return;
  }

  const packageJson = readPackageJson();
  if (evidence.kind === "computer-linker-alpha-evidence") {
    add("kind", "pass", "Evidence kind is correct.");
  } else {
    add("kind", "fail", "Evidence kind must be computer-linker-alpha-evidence.");
  }

  if (evidence.schemaVersion === 1) {
    add("schema-version", "pass", "Evidence schema version is supported.");
  } else {
    add("schema-version", "fail", "Evidence schemaVersion must be 1.");
  }

  if (evidence.package?.name === packageJson.name && evidence.package?.version === packageJson.version) {
    add("package", "pass", `Evidence targets ${packageJson.name}@${packageJson.version}.`);
  } else {
    add(
      "package",
      "fail",
      "Evidence package name/version must match package.json.",
      `expected ${packageJson.name}@${packageJson.version}, got ${evidence.package?.name ?? "missing"}@${evidence.package?.version ?? "missing"}`,
    );
  }

  const currentHead = git(["rev-parse", "HEAD"], { allowFailure: true });
  const currentShortHead = git(["rev-parse", "--short=12", "HEAD"], { allowFailure: true });
  const evidenceHead = String(evidence.git?.head ?? evidence.git?.shortHead ?? "");
  const headMatches = Boolean(evidenceHead) && (
    evidenceHead === currentHead ||
    evidenceHead === currentShortHead ||
    currentHead.startsWith(evidenceHead) ||
    evidenceHead.startsWith(currentShortHead)
  );
  if (headMatches) {
    add("git-head", "pass", `Evidence matches current HEAD ${currentShortHead}.`);
  } else if (options.allowHeadMismatch) {
    add("git-head", "warn", "Evidence git head does not match current HEAD; allowed by flag.", `evidence=${evidenceHead || "missing"} current=${currentShortHead || "unknown"}`);
  } else {
    add("git-head", "fail", "Evidence git head must match current HEAD.", `evidence=${evidenceHead || "missing"} current=${currentShortHead || "unknown"}`);
  }

  const testedAt = new Date(evidence.testedAt);
  const testedAtValid = typeof evidence.testedAt === "string" && !Number.isNaN(testedAt.getTime());
  if (!testedAtValid) {
    add("tested-at", "fail", "Evidence testedAt must be an ISO timestamp.");
  } else {
    const ageMs = Date.now() - testedAt.getTime();
    const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1000;
    if (ageMs < -5 * 60 * 1000) {
      add("tested-at", "fail", "Evidence testedAt is in the future.");
    } else if (ageMs > maxAgeMs) {
      add("tested-at", "fail", `Evidence is older than ${options.maxAgeDays} days.`);
    } else {
      add("tested-at", "pass", `Evidence age is within ${options.maxAgeDays} days.`);
    }
  }

  const exposure = String(evidence.target?.exposure ?? "");
  if (PUBLIC_EXPOSURES.has(exposure)) {
    add("target-exposure", "pass", `Evidence uses ${exposure} exposure.`);
  } else if (LOCAL_EXPOSURES.has(exposure) && options.allowLocalOnly) {
    add("target-exposure", "warn", "Evidence is local-only; allowed by flag.");
  } else if (LOCAL_EXPOSURES.has(exposure)) {
    add("target-exposure", "fail", "Public alpha evidence must use a public or OpenAI tunnel exposure.");
  } else {
    add("target-exposure", "fail", `target.exposure must be one of: ${[...ALL_EXPOSURES].join(", ")}.`);
  }

  const tunnelOrUrl = typeof evidence.target?.tunnelOrUrl === "string" ? evidence.target.tunnelOrUrl.trim() : "";
  if (!tunnelOrUrl) {
    add("target-tunnel-or-url", "fail", "target.tunnelOrUrl must record the tested OpenAI tunnel id or public origin.");
  } else if (/replace|placeholder|redacted|your-|todo|tbd/i.test(tunnelOrUrl)) {
    add("target-tunnel-or-url", "fail", "target.tunnelOrUrl must be concrete release evidence, not a placeholder.");
  } else if (exposure === "openai" && /^tunnel_[A-Za-z0-9_-]{6,}$/.test(tunnelOrUrl)) {
    add("target-tunnel-or-url", "pass", "Evidence records an OpenAI tunnel id.");
  } else if (exposure === "openai") {
    add("target-tunnel-or-url", "fail", "OpenAI tunnel evidence must record the tested tunnel_... id.");
  } else if (PUBLIC_EXPOSURES.has(exposure) && /^https:\/\/[^\s]+$/i.test(tunnelOrUrl)) {
    add("target-tunnel-or-url", "pass", "Evidence records a public HTTPS tunnel origin or URL.");
  } else if (LOCAL_EXPOSURES.has(exposure) && /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/[^\s]*)?$/i.test(tunnelOrUrl)) {
    add("target-tunnel-or-url", "pass", "Evidence records a local loopback URL.");
  } else {
    add("target-tunnel-or-url", "fail", "target.tunnelOrUrl is not valid for the selected exposure.");
  }

  if (evidence.target?.mcpPath === "/mcp") {
    add("target-mcp-path", "pass", "Evidence targets the /mcp path.");
  } else {
    add("target-mcp-path", "fail", "target.mcpPath must be /mcp.");
  }

  if (typeof evidence.target?.scope === "string" && evidence.target.scope.trim().length > 0) {
    add("target-scope", "pass", `Evidence records tested scope: ${evidence.target.scope.trim()}.`);
  } else {
    add("target-scope", "fail", "target.scope must record the workspace scope used by the external test.");
  }

  const targetClient = typeof evidence.target?.client === "string" ? evidence.target.client.trim() : "";
  if (!targetClient) {
    add("target-client", "fail", "target.client must name the external MCP client tested.");
  } else if (/replace|placeholder|your-|todo|tbd/i.test(targetClient)) {
    add("target-client", "fail", "target.client must be concrete release evidence, not a placeholder.");
  } else {
    add("target-client", "pass", `Evidence records external client: ${targetClient}.`);
  }

  const evidenceChecks = Array.isArray(evidence.checks) ? evidence.checks : [];
  if (Array.isArray(evidence.checks)) {
    add("checks-array", "pass", "Evidence contains a checks array.");
  } else {
    add("checks-array", "fail", "Evidence must contain a checks array.");
  }

  for (const requiredId of REQUIRED_CHECKS) {
    const item = evidenceChecks.find((check) => check?.id === requiredId);
    if (!item) {
      add(`check:${requiredId}`, "fail", `Missing required evidence check ${requiredId}.`);
      continue;
    }
    if (item.status !== "pass") {
      add(`check:${requiredId}`, "fail", `Evidence check ${requiredId} must have status pass.`, `status=${item.status ?? "missing"}`);
      continue;
    }
    if (typeof item.evidence !== "string" || item.evidence.trim().length < 12 || /pending|todo|tbd/i.test(item.evidence)) {
      add(`check:${requiredId}`, "fail", `Evidence check ${requiredId} needs a concrete evidence note.`);
      continue;
    }
    add(`check:${requiredId}`, "pass", `Evidence check ${requiredId} passed.`);
  }

  if (evidence.redactionConfirmed === true) {
    add("redaction", "pass", "Evidence confirms secrets and sensitive payloads were not recorded.");
  } else {
    add("redaction", "fail", "redactionConfirmed must be true.");
  }

  const secretFindings = findSecretLikeValues(JSON.stringify(evidence));
  if (secretFindings.length === 0) {
    add("secret-scan", "pass", "Evidence does not contain common secret-shaped values.");
  } else {
    add("secret-scan", "fail", "Evidence contains common secret-shaped values.", secretFindings.join("; "));
  }

  printReport({ filePath, checks, options });
  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

function printReport({ filePath, checks, options }) {
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const report = {
    kind: "computer-linker-alpha-evidence-check",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    file: filePath,
    maxAgeDays: options.maxAgeDays,
    checks,
  };
  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("Computer Linker alpha evidence");
  console.log(`status: ${status}`);
  console.log(`file: ${filePath}`);
  console.log("checks:");
  for (const check of checks) {
    console.log(`  [${check.status}] ${check.id}: ${check.message}`);
    if (check.detail) console.log(`    detail: ${check.detail}`);
  }
}

function targetPlaceholder(exposure) {
  if (exposure === "openai") return "replace-with-tunnel-id";
  if (exposure === "local") return "http://127.0.0.1:3939";
  return "replace-with-public-https-origin";
}

function readPositiveInteger(option, fallback) {
  const raw = values.get(option);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${option} must be a positive integer`);
  }
  return value;
}

function workspaceLinkerConfigDir() {
  return resolve(expandHomePath(
    process.env.COMPUTER_LINKER_CONFIG_DIR ??
    process.env.LOCALPORT_CONFIG_DIR ??
    "~/.computer-linker",
  ));
}

function expandHomePath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(homedir(), path.slice(2));
  return path;
}

function readOptionalJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function collectTunnelEvents(value) {
  if (!Array.isArray(value)) return [];
  const events = [];
  for (const snapshot of value) {
    if (Array.isArray(snapshot?.events)) {
      for (const event of snapshot.events) {
        events.push({
          ...event,
          provider: event.provider ?? snapshot.provider,
          tunnelId: event.tunnelId ?? snapshot.openaiTunnelId ?? snapshot.tunnelId ?? snapshot.id,
        });
      }
    }
  }
  return events;
}

function detectedExposure(tunnelSnapshots, tunnelEvents) {
  const providers = [
    ...(Array.isArray(tunnelSnapshots) ? tunnelSnapshots.map((snapshot) => snapshot?.provider) : []),
    ...tunnelEvents.map((event) => event?.provider),
  ].filter(Boolean);
  if (providers.includes("openai")) return "openai";
  if (providers.includes("cloudflare")) return "cloudflare";
  if (providers.includes("tailscale")) return "tailscale";
  return undefined;
}

function detectedTunnelOrUrl(tunnelSnapshots, tunnelEvents) {
  const snapshots = Array.isArray(tunnelSnapshots) ? tunnelSnapshots : [];
  for (const snapshot of snapshots) {
    const fromArgs = tunnelIdFromArgs(snapshot?.args);
    if (fromArgs) return fromArgs;
    if (typeof snapshot?.openaiTunnelId === "string" && snapshot.openaiTunnelId.startsWith("tunnel_")) return snapshot.openaiTunnelId;
    if (typeof snapshot?.publicUrl === "string" && snapshot.publicUrl.startsWith("https://")) return snapshot.publicUrl;
  }
  for (const event of tunnelEvents) {
    if (typeof event?.controlPlaneTunnelId === "string" && event.controlPlaneTunnelId.startsWith("tunnel_")) return event.controlPlaneTunnelId;
    if (typeof event?.tunnelId === "string" && event.tunnelId.startsWith("tunnel_")) return event.tunnelId;
    if (typeof event?.publicUrl === "string" && event.publicUrl.startsWith("https://")) return event.publicUrl;
  }
  return undefined;
}

function tunnelIdFromArgs(args) {
  if (!Array.isArray(args)) return undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index]);
    if (value === "--control-plane.tunnel-id" && args[index + 1]) return String(args[index + 1]);
    const match = value.match(/--control-plane\.tunnel-id=(tunnel_[A-Za-z0-9_-]+)/);
    if (match) return match[1];
  }
  return undefined;
}

function detectedScope(auditEvents) {
  const event = [...auditEvents].reverse().find((item) => (
    item?.type === "tool_call" &&
    item.success === true &&
    item.tool === "computer_operation" &&
    typeof item.workspaceRef === "string" &&
    item.workspaceRef.trim()
  ));
  return event?.workspaceRef;
}

function missingList(items) {
  const missing = items.filter(([, present]) => !present).map(([name]) => name);
  return missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined;
}

function externalSmokePrompt(scope) {
  return [
    "Run a read-only Computer Linker alpha smoke test.",
    "Use only the Computer Linker MCP tools exposed by this connector.",
    "1. Call get_computer_info.",
    `2. Call computer_operation with {"scope":"${jsonStringLiteralContent(scope)}","op":"file.list","target":".","options":{"maxEntries":5}}.`,
    "3. Call get_operation_history with {\"view\":\"connections\",\"limit\":20}.",
    "Then summarize whether all three calls succeeded.",
    "Do not include owner tokens, bearer headers, API keys, private file contents, or screenshots in your answer.",
  ].join("\n");
}

function externalMissingPrompt(scope, missingTools) {
  const toolLines = [];
  if (missingTools.includes("get_computer_info")) {
    toolLines.push("Call get_computer_info.");
  }
  if (missingTools.includes("computer_operation")) {
    toolLines.push(`Call computer_operation with {"scope":"${jsonStringLiteralContent(scope)}","op":"file.list","target":".","options":{"maxEntries":5}}.`);
  }
  if (missingTools.includes("get_operation_history")) {
    toolLines.push("Call get_operation_history with {\"view\":\"connections\",\"limit\":20}.");
  }
  return [
    "Complete the remaining Computer Linker alpha smoke step.",
    "Use only the Computer Linker MCP tools exposed by this connector.",
    "The local preflight already observed the other smoke calls; run only the missing call(s) below.",
    ...toolLines.map((line, index) => `${index + 1}. ${line}`),
    "Then summarize whether the remaining call(s) succeeded.",
    "Do not include owner tokens, bearer headers, API keys, private file contents, or screenshots in your answer.",
  ].join("\n");
}

function jsonStringLiteralContent(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function indentBlock(text, prefix) {
  return text.split(/\r?\n/g).map((line) => `${prefix}${line}`).join("\n");
}

function readPackageJson() {
  return JSON.parse(readFileSync(resolve("package.json"), "utf8"));
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) return "";
    throw error;
  }
}

function findSecretLikeValues(text) {
  const patterns = [
    ["openai-api-key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
    ["github-token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
    ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
    ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
    ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    ["bearer-header", /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{12,}/gi],
    ["owner-token-field", /"ownerToken"\s*:\s*"(?!<|redacted|REDACTED|null)[^"]{8,}"/g],
  ];
  const findings = [];
  for (const [id, pattern] of patterns) {
    if (pattern.test(text)) findings.push(id);
  }
  return findings;
}

function describeEvidence(id) {
  switch (id) {
    case "external-mcp-tool-flow":
      return "External MCP client called get_computer_info, computer_operation, and get_operation_history.";
    case "tunnel-transport":
      return "Tunnel exposure connected from outside the local loopback target.";
    case "mcp-only-public-surface":
      return "Public exposure allowed /mcp and did not expose /api/v1 or /healthz.";
    case "operation-history-reviewed":
      return "computer-linker history --view connections and --view last showed the expected external session without secrets.";
    case "client-instructions-usable":
      return "README Agent Instructions were pasted into the client and produced the expected first operations.";
    default:
      return "Describe the concrete evidence for this check.";
  }
}

function fail(message) {
  console.error(`alpha evidence failed: ${message}`);
  process.exit(1);
}
