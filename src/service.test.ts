import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceLogPolicy } from "./retention.js";
import { serviceControlExecutionCommand, serviceLogs, servicePlan, serviceStatus, writeServiceProfileFiles } from "./service.js";
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

  const linuxInstallPlan = servicePlan(config, "install", { platform: "linux" });
  assert.match(linuxInstallPlan.effect, /install or update/);
  assert.ok(linuxInstallPlan.commands.includes("sudo systemctl enable computer-linker"));
  assert.ok(linuxInstallPlan.commands.includes("sudo systemctl restart computer-linker"));

  const linuxFiles = writeServiceProfileFiles(config, { platform: "linux", outputDir: join(root, "linux-service") });
  const linuxInstallScript = await readFile(linuxFiles.files.install, "utf8");
  const linuxUninstallScript = await readFile(linuxFiles.files.uninstall, "utf8");
  assert.match(linuxInstallScript, /sudo systemctl enable computer-linker/);
  assert.match(linuxInstallScript, /sudo systemctl restart computer-linker/);
  assert.doesNotMatch(linuxInstallScript, /enable --now/);
  assert.match(linuxUninstallScript, /sudo systemctl disable --now computer-linker \|\| true/);
  assert.match(linuxUninstallScript, /sudo systemctl reset-failed computer-linker \|\| true/);

  const macosFiles = writeServiceProfileFiles(config, { platform: "macos", outputDir: join(root, "macos-service") });
  const macosInstallScript = await readFile(macosFiles.files.install, "utf8");
  const macosBootoutIndex = macosInstallScript.indexOf("launchctl bootout gui/$(id -u)/com.computer-linker.computer-linker 2>/dev/null || true");
  const macosBootstrapIndex = macosInstallScript.indexOf("launchctl bootstrap gui/$(id -u)");
  assert.notEqual(macosBootoutIndex, -1);
  assert.notEqual(macosBootstrapIndex, -1);
  assert.ok(macosBootoutIndex < macosBootstrapIndex);
  assert.match(await readFile(macosFiles.files.uninstall, "utf8"), /launchctl bootout .* \|\| true/);

  const windowsFiles = writeServiceProfileFiles(config, { platform: "windows", serviceName: "Computer Linker Test", outputDir: join(root, "windows-service") });
  const windowsInstallScript = await readFile(windowsFiles.files.install, "utf8");
  const windowsUninstallScript = await readFile(windowsFiles.files.uninstall, "utf8");
  assert.match(windowsInstallScript, /Get-Service -Name \$serviceName -ErrorAction SilentlyContinue/);
  assert.match(windowsInstallScript, /sc\.exe delete \$serviceName/);
  assert.match(windowsInstallScript, /sc\.exe create \$serviceName/);
  assert.match(windowsUninstallScript, /Service \$serviceName is not installed; nothing to remove\./);
  assert.match(windowsUninstallScript, /sc\.exe delete \$serviceName/);
} finally {
  await rm(root, { recursive: true, force: true });
}
