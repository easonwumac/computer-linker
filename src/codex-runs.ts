import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactAuditValue } from "./audit-redaction.js";
import { codexRunsPath } from "./config.js";
import { codexRunRetentionPolicy, enforceJsonlRetention, readTailText, type JsonlRetentionPolicy } from "./retention.js";
import type { ProcessResult, WorkspaceOperationName } from "./workspace-operations.js";

export interface CodexRunRecord {
  timestamp: string;
  workflowId: string;
  workflowType: Extract<WorkspaceOperationName, "codex_plan" | "codex_review" | "codex_fix" | "codex_test" | "codex_continue">;
  workspaceId: string;
  workspaceRoot: string;
  workingDirectory: string;
  continuedFromWorkflowId?: string;
  promptPreview: string;
  userPromptPreview?: string;
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  stdoutPreview: string;
  stderrPreview: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  preRunChangeSummary: unknown;
  postRunChangeSummary: unknown;
  historyInsight?: unknown;
}

export interface WriteCodexRunRecordInput extends Omit<CodexRunRecord, "timestamp" | "exitCode" | "signal" | "timedOut" | "stdoutPreview" | "stderrPreview" | "stdoutBytes" | "stderrBytes" | "stdoutTruncated" | "stderrTruncated"> {
  result: ProcessResult;
  maxPreviewBytes?: number;
}

export interface ReadCodexRunRecordsOptions {
  workspaceId?: string;
  workflowId?: string;
  maxResults?: number;
}

export function writeCodexRunRecord(input: WriteCodexRunRecordInput): CodexRunRecord {
  const stdout = previewText(input.result.stdout, input.maxPreviewBytes ?? 32 * 1024);
  const stderr = previewText(input.result.stderr, input.maxPreviewBytes ?? 32 * 1024);
  const record: CodexRunRecord = redactAuditValue({
    timestamp: new Date().toISOString(),
    workflowId: input.workflowId,
    workflowType: input.workflowType,
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    workingDirectory: input.workingDirectory,
    continuedFromWorkflowId: input.continuedFromWorkflowId,
    promptPreview: input.promptPreview,
    userPromptPreview: input.userPromptPreview,
    exitCode: input.result.exitCode,
    signal: input.result.signal,
    timedOut: input.result.timedOut,
    stdoutPreview: stdout.text,
    stderrPreview: stderr.text,
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    preRunChangeSummary: input.preRunChangeSummary,
    postRunChangeSummary: input.postRunChangeSummary,
    historyInsight: input.historyInsight,
  });

  const path = codexRunsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  try {
    enforceCodexRunRetention();
  } catch {
    // Retention is opportunistic; the Codex run record was already appended.
  }
  return record;
}

export function readCodexRunRecords(options: ReadCodexRunRecordsOptions = {}): CodexRunRecord[] {
  const path = codexRunsPath();
  if (!existsSync(path)) return [];

  let records = readCodexRunRecordLines(path)
    .trimEnd()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => redactAuditValue(JSON.parse(line) as CodexRunRecord))
    .reverse();

  if (options.workspaceId) {
    records = records.filter((record) => record.workspaceId === options.workspaceId);
  }
  if (options.workflowId) {
    records = records.filter((record) => record.workflowId === options.workflowId);
  }
  const limit = Number.isInteger(options.maxResults) && options.maxResults && options.maxResults > 0
    ? Math.min(options.maxResults, 1000)
    : 50;
  return records.slice(0, limit);
}

export function enforceCodexRunRetention(policy: Partial<JsonlRetentionPolicy & { maxRecords: number }> = {}): ReturnType<typeof enforceJsonlRetention> {
  return enforceJsonlRetention(codexRunsPath(), {
    maxBytes: policy.maxBytes ?? codexRunRetentionPolicy.maxBytes,
    maxLines: policy.maxRecords ?? policy.maxLines ?? codexRunRetentionPolicy.maxRecords,
  });
}

function readCodexRunRecordLines(path: string): string {
  const size = existsSync(path) ? readTailText(path, codexRunRetentionPolicy.tailReadMaxBytes) : undefined;
  if (!size?.truncated) return readFileSync(path, "utf8");
  return size.text;
}

function previewText(value: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) {
    return { text: value, bytes, truncated: false };
  }
  return {
    text: Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8"),
    bytes,
    truncated: true,
  };
}
