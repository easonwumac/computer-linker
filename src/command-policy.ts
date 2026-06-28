import { previewCommand } from "./audit.js";
import type { WorkspacePolicy } from "./permissions.js";

const DEFAULT_COMMAND_OUTPUT_BYTES = 200000;
const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface CommandPolicyLimitInput {
  timeoutSeconds?: number;
  maxOutputBytes?: number;
}

export interface CommandPolicyLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ManagedCommandPolicyLimits {
  timeoutMs?: number;
  maxOutputBytes: number;
}

export function commandPolicyLimits(
  policy: WorkspacePolicy | undefined,
  command: string,
  input: CommandPolicyLimitInput,
  defaultTimeoutSeconds: number,
): CommandPolicyLimits {
  assertCommandAllowedByPolicy(policy, command);
  return {
    timeoutMs: normalizeTimeoutMs(commandPolicyTimeoutSeconds(policy, input.timeoutSeconds, defaultTimeoutSeconds), defaultTimeoutSeconds),
    maxOutputBytes: commandPolicyOutputBytes(policy, input.maxOutputBytes),
  };
}

export function managedCommandPolicyLimits(
  policy: WorkspacePolicy | undefined,
  command: string,
  input: CommandPolicyLimitInput,
): ManagedCommandPolicyLimits {
  assertCommandAllowedByPolicy(policy, command);
  return {
    timeoutMs: managedCommandPolicyTimeoutMs(policy, input.timeoutSeconds),
    maxOutputBytes: commandPolicyOutputBytes(policy, input.maxOutputBytes),
  };
}

export function assertCommandAllowedByPolicy(policy: WorkspacePolicy | undefined, command: string): void {
  if (!policy) return;

  const disallowedShellSyntax = policy.allowShellMetacharacters ? undefined : detectDisallowedShellSyntax(command);
  if (disallowedShellSyntax) {
    throw new Error(
      `Command permission denied by workspace policy (shell metacharacters are disabled: ${disallowedShellSyntax}): ${previewCommand(command)}`,
    );
  }

  const deniedPattern = policy.deniedCommands?.find((pattern) => commandPolicyPatternMatches(pattern, command));
  if (deniedPattern) {
    throw new Error(`Command permission denied by workspace policy (${deniedPattern}): ${previewCommand(command)}`);
  }
  if (policy.allowedCommands?.length && !policy.allowedCommands.some((pattern) => commandPolicyPatternMatches(pattern, command))) {
    throw new Error(`Command permission denied by workspace policy: ${previewCommand(command)}`);
  }
}

export function assertPackageScriptAllowedByPolicy(policy: WorkspacePolicy | undefined, script: string): void {
  if (!policy) return;
  const deniedPattern = policy.deniedPackageScripts?.find((pattern) => commandPolicyPatternMatches(pattern, script));
  if (deniedPattern) {
    throw new Error(`Package script denied by workspace policy (${deniedPattern}): ${script}`);
  }
  if (policy.allowedPackageScripts?.length && !policy.allowedPackageScripts.some((pattern) => commandPolicyPatternMatches(pattern, script))) {
    throw new Error(`Package script denied by workspace policy: ${script}`);
  }
}

export function commandPolicyPatternMatches(pattern: string, command: string): boolean {
  const normalizedPattern = normalizeCommandPolicyText(pattern);
  if (!normalizedPattern) return false;
  const normalizedCommand = normalizeCommandPolicyText(command);
  const source = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "").test(normalizedCommand);
}

export function detectDisallowedShellSyntax(command: string): string | undefined {
  if (/[\r\n]/.test(command)) return "newline command separator";
  if (command.includes("&&")) return "&& command chaining";
  if (command.includes("||")) return "|| command chaining";
  if (command.includes(";")) return "; command separator";
  if (command.includes("|")) return "| pipe";
  if (command.includes(">")) return "> output redirection";
  if (command.includes("<")) return "< input redirection";
  if (command.includes("$(")) return "$(command substitution)";
  if (command.includes("`")) return "` command substitution";
  if (command.includes("&")) return "& command chaining";
  if (command.includes("^")) return "^ cmd escape";
  if (/%[^%\s]+%/.test(command)) return "%VAR% cmd expansion";
  return undefined;
}

function commandPolicyTimeoutSeconds(
  policy: WorkspacePolicy | undefined,
  requestedSeconds: number | undefined,
  defaultSeconds: number,
): number {
  const requested = requestedSeconds ?? defaultSeconds;
  return policy?.maxRuntimeSeconds ? Math.min(requested, policy.maxRuntimeSeconds) : requested;
}

function managedCommandPolicyTimeoutMs(policy: WorkspacePolicy | undefined, requestedSeconds: number | undefined): number | undefined {
  if (requestedSeconds === undefined && !policy?.maxRuntimeSeconds) return undefined;
  const seconds = policy?.maxRuntimeSeconds
    ? Math.min(requestedSeconds ?? policy.maxRuntimeSeconds, policy.maxRuntimeSeconds)
    : requestedSeconds;
  return normalizeTimeoutMs(seconds, 3600);
}

function commandPolicyOutputBytes(policy: WorkspacePolicy | undefined, requestedBytes: number | undefined): number {
  const policyMax = normalizeBoundedPositiveInteger(policy?.maxOutputBytes, DEFAULT_COMMAND_OUTPUT_BYTES, MAX_COMMAND_OUTPUT_BYTES);
  const capped = requestedBytes === undefined ? policyMax : Math.min(requestedBytes, policyMax);
  return normalizeBoundedPositiveInteger(capped, policyMax, policyMax);
}

function normalizeCommandPolicyText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTimeoutMs(value: number | undefined, defaultSeconds: number): number {
  const seconds = Number.isInteger(value) && value && value > 0 ? Math.min(value, 3600) : defaultSeconds;
  return seconds * 1000;
}

function normalizeBoundedPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, max) : fallback;
}
