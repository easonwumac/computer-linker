import assert from "node:assert/strict";
import {
  assertCommandAllowedByPolicy,
  assertPackageScriptAllowedByPolicy,
  commandPolicyLimits,
  commandPolicyPatternMatches,
  detectDisallowedShellSyntax,
  managedCommandPolicyLimits,
} from "./command-policy.js";
import type { WorkspacePolicy } from "./permissions.js";

const defaultPolicy: WorkspacePolicy = {
  allowedCommands: ["npm *", "git *"],
  deniedCommands: ["git push *"],
  maxRuntimeSeconds: 600,
  maxOutputBytes: 1024,
};

assert.equal(commandPolicyPatternMatches("npm *", "npm test"), true);
assert.equal(commandPolicyPatternMatches("git status", "git   status"), true);
assert.equal(commandPolicyPatternMatches("git push *", "git push origin main"), true);
assert.equal(commandPolicyPatternMatches("npm *", "node test.js"), false);

assert.doesNotThrow(() => assertCommandAllowedByPolicy(defaultPolicy, "npm test"));
assert.doesNotThrow(() => assertCommandAllowedByPolicy(defaultPolicy, "git status"));
assert.throws(
  () => assertCommandAllowedByPolicy(defaultPolicy, "git push origin main"),
  /Command permission denied by workspace policy \(git push \*\)/,
);
assert.throws(
  () => assertCommandAllowedByPolicy(defaultPolicy, "node test.js"),
  /Command permission denied by workspace policy: node test\.js/,
);

assert.doesNotThrow(() => assertPackageScriptAllowedByPolicy(undefined, "deploy"));
assert.doesNotThrow(() => assertPackageScriptAllowedByPolicy(defaultPolicy, "deploy"));
assert.doesNotThrow(() => assertPackageScriptAllowedByPolicy({
  allowedPackageScripts: ["test", "build:*"],
  deniedPackageScripts: ["deploy", "release:*"],
}, "test"));
assert.doesNotThrow(() => assertPackageScriptAllowedByPolicy({
  allowedPackageScripts: ["test", "build:*"],
  deniedPackageScripts: ["deploy", "release:*"],
}, "build:prod"));
assert.throws(
  () => assertPackageScriptAllowedByPolicy({
    allowedPackageScripts: ["*"],
    deniedPackageScripts: ["deploy"],
  }, "deploy"),
  /Package script denied by workspace policy \(deploy\): deploy/,
);
assert.throws(
  () => assertPackageScriptAllowedByPolicy({
    allowedPackageScripts: ["test"],
  }, "deploy"),
  /Package script denied by workspace policy: deploy/,
);

for (const command of [
  "npm test && echo unsafe",
  "git status; echo unsafe",
  "npm test || echo unsafe",
  "npm test | more",
  "npm test > out.txt",
  "npm test < in.txt",
  "npm test $(echo unsafe)",
  "npm test `echo unsafe`",
  "npm test & echo unsafe",
  "npm test ^& echo unsafe",
  "npm test %COMSPEC%",
  "npm test\n echo unsafe",
]) {
  assert.throws(
    () => assertCommandAllowedByPolicy(defaultPolicy, command),
    /Command permission denied by workspace policy \(shell metacharacters are disabled:/,
    command,
  );
  assert.equal(typeof detectDisallowedShellSyntax(command), "string", command);
}

assert.doesNotThrow(() => assertCommandAllowedByPolicy({
  ...defaultPolicy,
  allowShellMetacharacters: true,
}, "npm test && echo explicitly-allowed"));

const limited = commandPolicyLimits(defaultPolicy, "npm test", { timeoutSeconds: 900, maxOutputBytes: 5000 }, 120);
assert.deepEqual(limited, {
  timeoutMs: 600000,
  maxOutputBytes: 1024,
});

const managed = managedCommandPolicyLimits(defaultPolicy, "git status", {});
assert.deepEqual(managed, {
  timeoutMs: 600000,
  maxOutputBytes: 1024,
});
