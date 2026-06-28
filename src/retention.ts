import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { securePrivateFile } from "./file-permissions.js";

export interface JsonlRetentionPolicy {
  maxBytes: number;
  maxLines?: number;
}

export interface JsonlRetentionResult {
  path: string;
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
  beforeLines: number;
  afterLines: number;
  removedLines: number;
}

export interface TailTextResult {
  exists: boolean;
  path: string;
  text: string;
  sizeBytes: number;
  readBytes: number;
  truncated: boolean;
}

export const auditRetentionPolicy = {
  maxBytes: 10 * 1024 * 1024,
  tailReadMaxBytes: 10 * 1024 * 1024,
};

export const codexRunRetentionPolicy = {
  maxBytes: 10 * 1024 * 1024,
  maxRecords: 500,
  tailReadMaxBytes: 10 * 1024 * 1024,
};

export const screenshotRetentionPolicy = {
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxFiles: 100,
  maxTotalBytes: 250 * 1024 * 1024,
};

export const managedProcessRetentionPolicy = {
  maxExitedAgeMs: 60 * 60 * 1000,
  maxExitedPerWorkspace: 50,
};

export const serviceLogPolicy = {
  warnBytes: 10 * 1024 * 1024,
  tailReadMaxBytes: 1024 * 1024,
};

export function enforceJsonlRetention(path: string, policy: JsonlRetentionPolicy): JsonlRetentionResult {
  if (!existsSync(path)) {
    return {
      path,
      changed: false,
      beforeBytes: 0,
      afterBytes: 0,
      beforeLines: 0,
      afterLines: 0,
      removedLines: 0,
    };
  }

  const beforeBytes = statSync(path).size;
  if (beforeBytes <= policy.maxBytes && !policy.maxLines) {
    return {
      path,
      changed: false,
      beforeBytes,
      afterBytes: beforeBytes,
      beforeLines: 0,
      afterLines: 0,
      removedLines: 0,
    };
  }

  const lines = readFileSync(path, "utf8").trimEnd().split(/\r?\n/).filter(Boolean);
  const beforeLines = lines.length;
  let kept = policy.maxLines && policy.maxLines > 0 ? lines.slice(-policy.maxLines) : [...lines];
  while (kept.length > 0 && Buffer.byteLength(`${kept.join("\n")}\n`, "utf8") > policy.maxBytes) {
    kept = kept.slice(1);
  }

  const content = kept.length > 0 ? `${kept.join("\n")}\n` : "";
  const afterBytes = Buffer.byteLength(content, "utf8");
  const changed = kept.length !== lines.length || afterBytes !== beforeBytes;
  if (changed) {
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, content, { mode: 0o600 });
    renameSync(tempPath, path);
  }

  return {
    path,
    changed,
    beforeBytes,
    afterBytes,
    beforeLines,
    afterLines: kept.length,
    removedLines: beforeLines - kept.length,
  };
}

export function readTailText(path: string, maxBytes: number): TailTextResult {
  if (!existsSync(path)) {
    return { exists: false, path, text: "", sizeBytes: 0, readBytes: 0, truncated: false };
  }
  const sizeBytes = statSync(path).size;
  const readBytes = Math.min(sizeBytes, Math.max(0, Math.floor(maxBytes)));
  if (readBytes === 0) {
    return { exists: true, path, text: "", sizeBytes, readBytes: 0, truncated: sizeBytes > 0 };
  }

  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(readBytes);
    const offset = Math.max(0, sizeBytes - readBytes);
    const bytesRead = readSync(fd, buffer, 0, readBytes, offset);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    const truncated = offset > 0;
    if (truncated) {
      const newlineIndex = text.indexOf("\n");
      text = newlineIndex >= 0 ? text.slice(newlineIndex + 1) : "";
    }
    return { exists: true, path, text, sizeBytes, readBytes: bytesRead, truncated };
  } finally {
    closeSync(fd);
  }
}

export function tailLinesFromText(value: string, lines: number): string {
  const items = value.split(/\r?\n/);
  const hasTrailingNewline = items.length > 0 && items.at(-1) === "";
  const trimmed = hasTrailingNewline ? items.slice(0, -1) : items;
  return trimmed.slice(-Math.max(1, Math.floor(lines))).join("\n");
}

export function fileStatus(path: string, warnBytes: number): {
  exists: boolean;
  path: string;
  sizeBytes: number;
  warnBytes: number;
  oversized: boolean;
} {
  if (!existsSync(path)) return { exists: false, path, sizeBytes: 0, warnBytes, oversized: false };
  const sizeBytes = statSync(path).size;
  return {
    exists: true,
    path,
    sizeBytes,
    warnBytes,
    oversized: sizeBytes > warnBytes,
  };
}

export function safeWriteFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  securePrivateFile(path, 0o600);
}

export function parentDirectory(path: string): string {
  return dirname(path);
}
