import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath } from "./config.js";
import { localStatePermissionsReport } from "./local-state.js";

const originalConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
const root = await mkdtemp(join(tmpdir(), "computer-linker-local-state-test-"));

try {
  process.env.COMPUTER_LINKER_CONFIG_DIR = root;
  const path = configPath();
  await writeFile(path, "{}\n", "utf8");
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
  }

  const report = localStatePermissionsReport();
  const config = report.files.find((file) => file.role === "config");
  assert.equal(report.kind, "computer-linker-local-state-permissions");
  assert.equal(config?.path, path);
  assert.equal(config?.desiredMode, "0600");
  if (process.platform === "win32") {
    assert.equal(config?.status, "not_applicable");
    assert.ok(report.warnings.some((warning) => warning.includes("POSIX chmod checks are not enforced")));
  } else {
    assert.equal(config?.status, "repaired");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
} finally {
  if (originalConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
  else process.env.COMPUTER_LINKER_CONFIG_DIR = originalConfigDir;
  await rm(root, { recursive: true, force: true });
}
