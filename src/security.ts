import { execFileSync } from "node:child_process";
import { loadConfig } from "./config.js";
import type { LocalPortConfig } from "./permissions.js";
import { executableCommand, windowsVerbatimArgumentsOption } from "./platform-shell.js";

export type SecuritySeverity = "info" | "warning" | "critical";

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  workspaceId?: string;
}

export function securityDiagnostics(config: LocalPortConfig = loadConfig()): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const host = config.host ?? "127.0.0.1";
  const ownerTokenConfigured = Boolean(config.ownerToken);

  if (!ownerTokenConfigured) {
    findings.push({
      id: "owner-token-missing",
      severity: isLoopbackHost(host) ? "info" : "critical",
      title: "Owner token is not configured",
      detail: isLoopbackHost(host)
        ? "HTTP mode is loopback-only without an owner token. Configure one before using a tunnel."
        : "A non-loopback HTTP server without an owner token must not be exposed.",
    });
  }

  if (ownerTokenConfigured && !config.publicBaseUrl) {
    findings.push({
      id: "public-base-url-missing",
      severity: "warning",
      title: "Public base URL is not configured",
      detail: "OAuth clients behind Cloudflare or Tailscale need publicBaseUrl to match the reachable origin.",
    });
  }

  if (config.publicBaseUrl && !isHttpsUrl(config.publicBaseUrl)) {
    findings.push({
      id: "public-base-url-not-https",
      severity: "warning",
      title: "Public base URL is not HTTPS",
      detail: "Cloud-hosted MCP clients such as ChatGPT need a reachable HTTPS origin rather than localhost or plain HTTP.",
    });
  }

  if (!isLoopbackHost(host)) {
    findings.push({
      id: "non-loopback-host",
      severity: "warning",
      title: "HTTP server listens beyond loopback",
      detail: `host is ${host}. Use owner token, OAuth, and a network layer such as Tailscale or Cloudflare Access.`,
    });
  }

  for (const workspace of config.workspaces) {
    if (workspace.permissions.shell) {
      findings.push({
        id: "shell-broad-access",
        severity: "warning",
        title: "Shell permission is broad",
        detail: "Workspace Linker starts commands in the workspace, but the OS shell itself is not a filesystem sandbox.",
        workspaceId: workspace.id,
      });
    }

    if ((workspace.permissions.shell || workspace.permissions.codex) && !workspace.policy?.allowedCommands?.length) {
      findings.push({
        id: "command-allowlist-missing",
        severity: "warning",
        title: "Command allowlist is missing",
        detail: "This scope allows local execution without an allowedCommands policy. Commands remain cwd-bound, not filesystem-sandboxed.",
        workspaceId: workspace.id,
      });
    }

    if (workspace.permissions.codex) {
      findings.push({
        id: "codex-broad-access",
        severity: commandAvailable("codex") ? "warning" : "critical",
        title: "Codex permission is broad",
        detail: commandAvailable("codex")
          ? "Workspace Linker starts codex in the workspace, but codex may invoke tools with broader OS access."
          : "This workspace allows codex, but the codex CLI was not found on PATH.",
        workspaceId: workspace.id,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "security-baseline-ok",
      severity: "info",
      title: "No immediate security findings",
      detail: "Workspace access is limited to read/write operations unless shell or codex permissions are enabled.",
    });
  }

  return findings;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function commandAvailable(command: string): boolean {
  try {
    const invocation = executableCommand(command, ["--version"]);
    execFileSync(invocation.command, invocation.args, {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "pipe"],
      ...windowsVerbatimArgumentsOption(invocation),
    });
    return true;
  } catch {
    return false;
  }
}
