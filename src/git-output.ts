import { isSensitiveWorkspacePath } from "./sensitive-files.js";

export const GIT_SENSITIVE_DIFF_REDACTION =
  "[Computer Linker redacted this Git diff block because it touches a sensitive workspace path.]";

export interface SanitizedGitOutput {
  output: string;
  redacted: boolean;
  redactedPaths: string[];
}

export function sanitizeGitPatchOutput(output: string): SanitizedGitOutput {
  const redactedPaths = new Set<string>();
  const lines = output.split(/\r?\n/);
  const result: string[] = [];
  let block: string[] = [];

  const flushBlock = (): void => {
    if (block.length === 0) return;
    const paths = gitPatchPaths(block);
    const sensitivePaths = paths.filter((path) => isSensitiveWorkspacePath(path));
    if (sensitivePaths.length === 0) {
      result.push(...block);
      block = [];
      return;
    }

    for (const path of sensitivePaths) redactedPaths.add(path);
    result.push(block[0] ?? "diff --git");
    result.push(GIT_SENSITIVE_DIFF_REDACTION);
    block = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushBlock();
      block = [line];
      continue;
    }

    if (block.length > 0) {
      block.push(line);
      continue;
    }

    result.push(line);
  }

  flushBlock();

  return {
    output: result.join("\n"),
    redacted: redactedPaths.size > 0,
    redactedPaths: [...redactedPaths].sort(),
  };
}

function gitPatchPaths(lines: string[]): string[] {
  const paths = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      for (const path of parseDiffGitLine(line)) addGitPatchPath(paths, path);
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      addGitPatchPath(paths, stripGitPrefix(line.slice(4).trim().split(/\s+/)[0] ?? ""));
      continue;
    }

    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      addGitPatchPath(paths, line.replace(/^rename (from|to) /, "").trim());
      continue;
    }

    if (line.startsWith("copy from ") || line.startsWith("copy to ")) {
      addGitPatchPath(paths, line.replace(/^copy (from|to) /, "").trim());
    }
  }

  return [...paths];
}

function parseDiffGitLine(line: string): string[] {
  const payload = line.slice("diff --git ".length).trim();
  const match = /^("?a\/.+?"?)\s+("?b\/.+?"?)$/.exec(payload);
  if (match) {
    return [stripGitPrefix(match[1] ?? ""), stripGitPrefix(match[2] ?? "")];
  }
  return payload.split(/\s+/).map(stripGitPrefix);
}

function addGitPatchPath(paths: Set<string>, path: string): void {
  if (!path || path === "/dev/null") return;
  paths.add(path);
}

function stripGitPrefix(path: string): string {
  const normalized = path.replace(/^"|"$/g, "");
  return normalized.startsWith("a/") || normalized.startsWith("b/") ? normalized.slice(2) : normalized;
}
