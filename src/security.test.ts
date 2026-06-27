import assert from "node:assert/strict";
import { securityDiagnostics } from "./security.js";

const findings = securityDiagnostics({
  machineName: "security-test",
  host: "0.0.0.0",
  ownerToken: undefined,
  workspaces: [
    {
      id: "runner",
      name: "Runner",
      path: "/tmp/runner",
      permissions: { read: true, write: false, shell: true, codex: true },
    },
  ],
});

assert.ok(findings.some((finding) => finding.id === "owner-token-missing" && finding.severity === "critical"));
assert.ok(findings.some((finding) => finding.id === "non-loopback-host"));
assert.ok(findings.some((finding) => finding.id === "shell-broad-access" && finding.workspaceId === "runner"));
assert.ok(findings.some((finding) => finding.id === "codex-broad-access" && finding.workspaceId === "runner"));
assert.ok(findings.some((finding) => finding.id === "command-allowlist-missing" && finding.workspaceId === "runner"));

const insecurePublicUrl = securityDiagnostics({
  machineName: "insecure-public-url",
  host: "127.0.0.1",
  ownerToken: "token",
  publicBaseUrl: "http://127.0.0.1:3939",
  workspaces: [],
});

assert.ok(insecurePublicUrl.some((finding) => finding.id === "public-base-url-not-https"));

const baseline = securityDiagnostics({
  machineName: "baseline",
  host: "127.0.0.1",
  ownerToken: "token",
  publicBaseUrl: "https://workspace-linker.example.com",
  workspaces: [
    {
      id: "read-only",
      name: "Read only",
      path: "/tmp/read-only",
      permissions: { read: true, write: false, shell: false, codex: false },
    },
  ],
});

assert.equal(baseline.length, 1);
assert.equal(baseline[0].id, "security-baseline-ok");
