import type { LocalPortConfig, WorkspacePolicy } from "./permissions.js";

export interface PermissionPresetFlags {
  readOnly: boolean;
  dev: boolean;
  write: boolean;
  shell: boolean;
  codex: boolean;
  screen: boolean;
  canonicalArgs: string[];
}

export function permissionPresetFlags(
  args: string[],
  commandLabel: string,
  options: { defaultCoding?: boolean } = {},
): PermissionPresetFlags {
  assertReadOnlyNotMixed(args, commandLabel);
  const readOnly = args.includes("--read-only");
  const fullTrust = args.includes("--full-trust");
  const dev = args.includes("--dev") || args.includes("--coding");
  const defaultCoding = Boolean(options.defaultCoding && !hasExplicitPermissionMode(args));
  const development = dev || fullTrust || defaultCoding;
  return {
    readOnly,
    dev,
    write: !readOnly && (development || args.includes("--write")),
    shell: !readOnly && (development || args.includes("--shell")),
    codex: !readOnly && (fullTrust || args.includes("--codex")),
    screen: !readOnly && (fullTrust || args.includes("--screen")),
    canonicalArgs: canonicalPermissionArgs(args),
  };
}

export function assertReadOnlyNotMixed(args: string[], commandLabel: string): void {
  if (!args.includes("--read-only")) return;
  const conflicts = ["--dev", "--coding", "--full-trust", "--write", "--shell", "--codex", "--screen"]
    .filter((flag) => args.includes(flag));
  if (conflicts.length > 0) {
    throw new Error(`${commandLabel} --read-only cannot be combined with ${conflicts.join(", ")}`);
  }
}

function hasExplicitPermissionMode(args: string[]): boolean {
  return ["--read-only", "--dev", "--coding", "--full-trust", "--write", "--shell"]
    .some((flag) => args.includes(flag));
}

function canonicalPermissionArgs(args: string[]): string[] {
  if (args.includes("--read-only")) return ["--read-only"];
  if (args.includes("--full-trust")) return ["--full-trust"];
  const parts: string[] = [];
  if (args.includes("--write")) parts.push("--write");
  if (args.includes("--shell")) parts.push("--shell");
  if (args.includes("--codex")) parts.push("--codex");
  if (args.includes("--screen")) parts.push("--screen");
  return parts;
}

export function defaultExecutionPolicyForPermissions(
  permissions: { shell: boolean; codex: boolean },
): WorkspacePolicy | undefined {
  if (!permissions.shell && !permissions.codex) return undefined;
  const allowedCommands = [
    "npm *",
    "pnpm *",
    "yarn *",
    "bun *",
    "node *",
    "npx *",
    "git *",
  ];
  if (permissions.codex) allowedCommands.push("codex *");
  return {
    maxRuntimeSeconds: permissions.codex ? 1800 : 600,
    maxOutputBytes: 200000,
    allowedCommands,
    deniedCommands: ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"],
  };
}

export function repairedExecutionPolicy(
  policy: WorkspacePolicy | undefined,
  permissions: { shell: boolean; codex: boolean },
): WorkspacePolicy | undefined {
  const defaults = defaultExecutionPolicyForPermissions(permissions);
  if (!defaults) return policy;
  if (!policy) return defaults;
  return {
    ...policy,
    maxRuntimeSeconds: policy.maxRuntimeSeconds ?? defaults.maxRuntimeSeconds,
    maxOutputBytes: policy.maxOutputBytes ?? defaults.maxOutputBytes,
    allowedCommands: policy.allowedCommands?.length ? policy.allowedCommands : defaults.allowedCommands,
    deniedCommands: mergePolicyList(policy.deniedCommands, defaults.deniedCommands ?? []),
  };
}

export function policyChanged(before: WorkspacePolicy | undefined, after: WorkspacePolicy | undefined): boolean {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

export function mergePolicyList(current: string[] | undefined, next: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...(current ?? []), ...next]) {
    const text = item.trim().replace(/\s+/g, " ");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    merged.push(text);
  }
  return merged;
}

export function formatPermissions(permissions: LocalPortConfig["workspaces"][number]["permissions"]): string {
  return [
    `read=${permissions.read}`,
    `write=${permissions.write}`,
    `shell=${permissions.shell}`,
    `codex=${permissions.codex}`,
    `screen=${Boolean(permissions.screen)}`,
  ].join(" ");
}
