import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isLegacyUnsafeBootstrapDefaultWorkspace, isSafeBootstrapDefaultWorkspace } from "./permissions.js";
import type { LocalPortConfig } from "./permissions.js";

export type ConfigDiagnosticSeverity = "info" | "warning" | "critical";

export interface ConfigDiagnostic {
  id: string;
  severity: ConfigDiagnosticSeverity;
  title: string;
  detail: string;
  workspaceId?: string;
  path?: string;
}

export function configDiagnostics(config: LocalPortConfig): ConfigDiagnostic[] {
  const findings: ConfigDiagnostic[] = [];
  const workspaceIds = new Set<string>();
  const workspacePaths = new Map<string, { workspaceId?: string; path: string }>();

  if (!config.machineName?.trim()) {
    findings.push({
      id: "machine-name-missing",
      severity: "critical",
      title: "Machine name is missing",
      detail: "machineName is required so clients can identify this computer.",
    });
  }

  if (config.publicBaseUrl && !validUrl(config.publicBaseUrl)) {
    findings.push({
      id: "public-base-url-invalid",
      severity: "critical",
      title: "Public base URL is invalid",
      detail: "publicBaseUrl must be a valid URL origin.",
    });
  }

  if (config.workspaces.length === 0) {
    findings.push({
      id: "workspace-missing",
      severity: "critical",
      title: "No workspace scopes are configured",
      detail: "At least one folder-backed scope is required before clients can operate this computer.",
    });
  }

  for (const workspace of config.workspaces) {
    if (isSafeBootstrapDefaultWorkspace(workspace)) {
      findings.push({
        id: "bootstrap-current-read-only",
        severity: "info",
        title: "Bootstrap current-directory scope is read-only",
        detail: "Direct server startup created a read-only current-directory scope. Use `computer-linker start <folder>` or `computer-linker here` for normal coding access.",
        workspaceId: workspace.id,
        path: workspace.path,
      });
    } else if (isLegacyUnsafeBootstrapDefaultWorkspace(workspace)) {
      findings.push({
        id: "bootstrap-current-legacy-unsafe",
        severity: "warning",
        title: "Legacy bootstrap current-directory scope has write and shell access",
        detail: "Older bootstrap config exposed the current directory with write and shell access. Add an explicit folder with `computer-linker start <folder>`, then run `computer-linker doctor --fix`.",
        workspaceId: workspace.id,
        path: workspace.path,
      });
    }

    const workspaceId = workspace.id?.trim();
    if (!workspaceId) {
      findings.push({
        id: "workspace-id-missing",
        severity: "critical",
        title: "Workspace id is missing",
        detail: "Each configured scope needs a stable id.",
        path: workspace.path,
      });
    } else if (workspaceIds.has(workspaceId)) {
      findings.push({
        id: "workspace-id-duplicate",
        severity: "critical",
        title: "Workspace id is duplicated",
        detail: `More than one configured scope uses id ${workspaceId}.`,
        workspaceId,
        path: workspace.path,
      });
    } else {
      workspaceIds.add(workspaceId);
    }

    const pathFinding = workspacePathFinding(workspace.path, workspaceId);
    if (pathFinding) findings.push(pathFinding);
    const pathKey = normalizedWorkspacePathKey(workspace.path);
    if (pathKey) {
      const first = workspacePaths.get(pathKey);
      if (first) {
        findings.push({
          id: "workspace-path-duplicate",
          severity: "warning",
          title: "Workspace path is duplicated",
          detail: `This scope points at the same folder as ${first.workspaceId ?? first.path}. Keep one scope per folder unless separate permissions are intentional.`,
          workspaceId,
          path: workspace.path,
        });
      } else {
        workspacePaths.set(pathKey, { workspaceId, path: workspace.path });
      }
    }

    if (!workspace.permissions.read && !workspace.permissions.write && !workspace.permissions.shell && !workspace.permissions.codex && !workspace.permissions.screen) {
      findings.push({
        id: "workspace-no-permissions",
        severity: "warning",
        title: "Workspace has no enabled permissions",
        detail: "This scope is visible to clients but has no useful operation permissions.",
        workspaceId,
        path: workspace.path,
      });
    }

    if (workspace.permissions.write && !workspace.permissions.read) {
      findings.push({
        id: "workspace-write-without-read",
        severity: "warning",
        title: "Write permission is enabled without read",
        detail: "Most editing workflows need read permission to verify current content before writing.",
        workspaceId,
        path: workspace.path,
      });
    }

    if ((workspace.permissions.shell || workspace.permissions.codex) && !workspace.policy) {
      findings.push({
        id: "workspace-execution-policy-missing",
        severity: "warning",
        title: "Execution policy is missing",
        detail: "Shell or Codex scopes should set allowedCommands, maxRuntimeSeconds, and maxOutputBytes before broad use.",
        workspaceId,
        path: workspace.path,
      });
    } else if ((workspace.permissions.shell || workspace.permissions.codex) && !workspace.policy?.allowedCommands?.length) {
      findings.push({
        id: "workspace-command-allowlist-missing",
        severity: "warning",
        title: "Command allowlist is missing",
        detail: "Without allowedCommands, any command can run from this scope when shell or Codex permission is enabled.",
        workspaceId,
        path: workspace.path,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "config-baseline-ok",
      severity: "info",
      title: "Configuration baseline is valid",
      detail: "Configured scopes are usable and no immediate config issues were found.",
    });
  }

  return findings;
}

function normalizedWorkspacePathKey(path: string | undefined): string | undefined {
  const text = path?.trim();
  if (!text) return undefined;
  const resolved = resolve(text);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function workspacePathFinding(path: string, workspaceId: string | undefined): ConfigDiagnostic | undefined {
  if (!path?.trim()) {
    return {
      id: "workspace-path-missing",
      severity: "critical",
      title: "Workspace path is missing",
      detail: "Folder-backed scopes require a path.",
      workspaceId,
    };
  }
  if (!existsSync(path)) {
    return {
      id: "workspace-path-missing-on-disk",
      severity: "critical",
      title: "Workspace path does not exist",
      detail: "Operations cannot run until the configured path exists.",
      workspaceId,
      path,
    };
  }
  try {
    if (!statSync(path).isDirectory()) {
      return {
        id: "workspace-path-not-directory",
        severity: "critical",
        title: "Workspace path is not a directory",
        detail: "Folder-backed scopes must point at a directory.",
        workspaceId,
        path,
      };
    }
  } catch (error) {
    return {
      id: "workspace-path-unreadable",
      severity: "critical",
      title: "Workspace path cannot be inspected",
      detail: error instanceof Error ? error.message : String(error),
      workspaceId,
      path,
    };
  }
  return undefined;
}

function validUrl(value: string): boolean {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}
