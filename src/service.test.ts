import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceLogPolicy } from "./retention.js";
import { serviceControlExecutionCommand, serviceLogs, servicePlan, serviceStatus } from "./service.js";
import type { LocalPortConfig } from "./permissions.js";

const root = await mkdtemp(join(tmpdir(), "computer-linker-service-test-"));

try {
  const config: LocalPortConfig = {
    machineName: "service-test",
    host: "127.0.0.1",
    port: 3939,
    ownerToken: "owner-token",
    workspaces: [],
  };
  const stdoutPath = join(root, "service.out.log");
  const largeLog = `${"old-line\n".repeat(Math.ceil(serviceLogPolicy.tailReadMaxBytes / 8) + 10)}last-1\nlast-2\n`;
  await writeFile(stdoutPath, largeLog, "utf8");

  const logs = serviceLogs(config, { platform: "windows", configDirectory: root, lines: 2 });
  assert.equal(logs.policy.tailReadMaxBytes, serviceLogPolicy.tailReadMaxBytes);
  assert.equal(logs.stdout.exists, true);
  assert.equal(logs.stdout.truncated, true);
  assert.ok(logs.stdout.sizeBytes > logs.stdout.readBytes);
  assert.equal(logs.stdout.tail, "last-1\nlast-2");
  assert.equal(logs.stderr.exists, false);

  const status = serviceStatus(config, { platform: "windows", configDirectory: root });
  assert.equal(status.logFileStatus.stdout.exists, true);
  assert.equal(status.logFileStatus.stdout.sizeBytes, logs.stdout.sizeBytes);
  assert.equal(status.logPolicy.warnBytes, serviceLogPolicy.warnBytes);

  const linuxStartPlan = servicePlan(config, "start", { platform: "linux" });
  const linuxStartCommand = serviceControlExecutionCommand("linux", "start", "computer-linker", "computer-linker");
  assert.deepEqual(linuxStartCommand, {
    command: "sudo",
    args: ["systemctl", "start", "computer-linker"],
    display: "sudo systemctl start computer-linker",
  });
  assert.deepEqual(linuxStartPlan.commands, [linuxStartCommand.display]);

  const linuxStatus = serviceStatus(config, { platform: "linux", configDirectory: root });
  assert.deepEqual(linuxStatus.startCommands, [linuxStartCommand.display]);
  assert.deepEqual(linuxStatus.stopCommands, ["sudo systemctl stop computer-linker"]);
} finally {
  await rm(root, { recursive: true, force: true });
}
