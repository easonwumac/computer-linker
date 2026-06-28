import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexRunsPath } from "./config.js";
import { enforceCodexRunRetention, readCodexRunRecords, writeCodexRunRecord } from "./codex-runs.js";
import type { ProcessResult } from "./workspace-operations.js";

const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "computer-linker-codex-runs-test-"));

try {
  process.env.LOCALPORT_CONFIG_DIR = root;

  for (const index of [1, 2, 3]) {
    writeCodexRunRecord({
      workflowId: `codex_fix_${index}`,
      workflowType: "codex_fix",
      workspaceId: "app",
      workspaceRoot: "/tmp/app",
      workingDirectory: ".",
      promptPreview: `fix with OPENAI_API_KEY=sk-secret-${index}`,
      userPromptPreview: `Bearer token-${index}`,
      result: processResult(`stdout password=hunter${index}`, `stderr Authorization: Bearer abc${index}`),
      preRunChangeSummary: { summary: "before" },
      postRunChangeSummary: { summary: "after" },
      maxPreviewBytes: 1024,
    });
  }

  const raw = await readFile(codexRunsPath(), "utf8");
  assert.doesNotMatch(raw, /sk-secret|hunter|Authorization: Bearer abc|Bearer token/);
  assert.match(raw, /OPENAI_API_KEY=<redacted>/);
  assert.match(raw, /password=<redacted>/);

  const records = readCodexRunRecords({ workspaceId: "app", maxResults: 2 });
  assert.deepEqual(records.map((record) => record.workflowId), ["codex_fix_3", "codex_fix_2"]);
  assert.equal(records[0].stdoutPreview, "stdout password=<redacted>");
  assert.equal(records[0].stderrPreview, "stderr Authorization: Bearer <redacted>");

  const retention = enforceCodexRunRetention({ maxRecords: 2, maxBytes: 1024 * 1024 });
  assert.equal(retention.changed, true);
  assert.equal(retention.afterLines, 2);
  assert.deepEqual(readCodexRunRecords({ maxResults: 10 }).map((record) => record.workflowId), ["codex_fix_3", "codex_fix_2"]);
} finally {
  if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
  else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;

  await rm(root, { recursive: true, force: true });
}

function processResult(stdout: string, stderr: string): ProcessResult {
  return {
    exitCode: 0,
    timedOut: false,
    stdout,
    stderr,
  };
}
