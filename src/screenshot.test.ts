import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureScreenshot, listScreenshotTargets, screenshotCapability } from "./screenshot.js";

const originalWindowsScreenshotCommand = process.env.WORKSPACE_LINKER_WINDOWS_SCREENSHOT_COMMAND;
const root = await mkdtemp(join(tmpdir(), "workspace-linker-screenshot-test-"));
const twoByTwoPng = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP4/7/hPwMYMzT8ZwBiAGO/CfnRtiYIAAAAAElFTkSuQmCC";

try {
  if (process.platform === "win32") {
    const fakeProvider = await installFakeWindowsScreenshotProvider(root);
    process.env.WORKSPACE_LINKER_WINDOWS_SCREENSHOT_COMMAND = fakeProvider;

    const capability = screenshotCapability();
    assert.equal(capability.provider, "windows-powershell-screenshot");
    assert.equal(capability.supported, true);
    assert.deepEqual(capability.modes, ["display"]);
    assert.deepEqual(capability.displays, [{ id: "primary", primary: true }]);
    assert.equal(listScreenshotTargets().supported, true);

    const inline = await captureScreenshot({
      source: "display",
      target: "primary",
      returnMode: "base64",
    });
    assert.equal(inline.format, "png");
    assert.equal(inline.width, 2);
    assert.equal(inline.height, 2);
    assert.equal(inline.source.type, "display");
    assert.equal(inline.source.id, "primary");
    assert.equal(inline.bytesBase64, twoByTwoPng);
    assert.equal(inline.fileRef, undefined);

    const downscaled = await captureScreenshot({
      source: "display",
      target: "primary",
      maxWidth: 1,
      maxHeight: 1,
      returnMode: "base64",
    });
    assert.equal(downscaled.format, "png");
    assert.equal(downscaled.width, 1);
    assert.equal(downscaled.height, 1);
    assert.equal(typeof downscaled.bytesBase64, "string");

    const fileRef = await captureScreenshot({
      source: "display",
      returnMode: "fileRef",
    });
    assert.equal(fileRef.width, 2);
    assert.equal(fileRef.height, 2);
    assert.equal(typeof fileRef.fileRef, "string");
    await access(fileRef.fileRef ?? "");
    await rm(fileRef.fileRef ?? "", { force: true });

    await assert.rejects(
      () => captureScreenshot({ source: "display", maxWidth: 0 }),
      /screenshot maxWidth must be a positive integer/,
    );

    await assert.rejects(
      () => captureScreenshot({ source: "display", target: "secondary" }),
      /only the primary display target is currently supported/,
    );
    await assert.rejects(
      () => captureScreenshot({ source: "window", target: "window-1" }),
      /screen\.window capture is not implemented for windows-powershell-screenshot/,
    );
  } else {
    const capability = screenshotCapability();
    assert.equal(typeof capability.provider, "string");
    assert.equal(typeof capability.supported, "boolean");
    assert.ok(Array.isArray(capability.modes));
    assert.ok(Array.isArray(capability.displays));
    assert.ok(Array.isArray(capability.windows));
  }
} finally {
  if (originalWindowsScreenshotCommand === undefined) {
    delete process.env.WORKSPACE_LINKER_WINDOWS_SCREENSHOT_COMMAND;
  } else {
    process.env.WORKSPACE_LINKER_WINDOWS_SCREENSHOT_COMMAND = originalWindowsScreenshotCommand;
  }
  await rm(root, { recursive: true, force: true });
}

async function installFakeWindowsScreenshotProvider(directory: string): Promise<string> {
  const scriptPath = join(directory, "fake-windows-screenshot.cjs");
  await writeFile(scriptPath, [
    "const { writeFileSync } = require('node:fs');",
    `const png = Buffer.from(${JSON.stringify(twoByTwoPng)}, 'base64');`,
    "const output = process.argv[process.argv.length - 1];",
    "if (!output) throw new Error('missing screenshot output path');",
    "writeFileSync(output, png);",
    "",
  ].join("\n"));

  if (process.platform === "win32") {
    const commandPath = join(directory, "fake-powershell.cmd");
    const nodePath = process.execPath.replaceAll("%", "%%");
    const escapedScriptPath = scriptPath.replaceAll("%", "%%");
    await writeFile(commandPath, [
      "@echo off",
      "setlocal",
      `set "NODE_EXE=${nodePath}"`,
      `set "SCRIPT_PATH=${escapedScriptPath}"`,
      "\"%NODE_EXE%\" \"%SCRIPT_PATH%\" %*",
      "",
    ].join("\r\n"));
    return commandPath;
  }

  const commandPath = join(directory, "fake-powershell");
  await writeFile(commandPath, [
    "#!/usr/bin/env sh",
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"`,
    "",
  ].join("\n"));
  await chmod(commandPath, 0o755);
  return commandPath;
}
