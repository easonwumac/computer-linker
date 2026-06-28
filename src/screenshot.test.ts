import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { captureScreenshot, cleanupScreenshotArtifacts, listScreenshotTargets, screenshotArtifactStatus, screenshotCapability } from "./screenshot.js";

const originalWindowsScreenshotCommand = process.env.COMPUTER_LINKER_WINDOWS_SCREENSHOT_COMMAND;
const originalScreenshotDirectory = process.env.COMPUTER_LINKER_SCREENSHOT_DIR;
const originalScreenshotPlatform = process.env.COMPUTER_LINKER_SCREENSHOT_PLATFORM;
const originalPath = process.env.PATH;
const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
const originalDisplay = process.env.DISPLAY;
const root = await mkdtemp(join(tmpdir(), "computer-linker-screenshot-test-"));
const twoByTwoPng = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP4/7/hPwMYMzT8ZwBiAGO/CfnRtiYIAAAAAElFTkSuQmCC";

try {
  const artifactDirectory = join(root, "screenshots");
  process.env.COMPUTER_LINKER_SCREENSHOT_DIR = artifactDirectory;
  await mkdir(artifactDirectory, { recursive: true });
  const staleArtifact = join(artifactDirectory, "screenshot-00000000-0000-4000-8000-000000000001.png");
  const freshArtifact = join(artifactDirectory, "screenshot-00000000-0000-4000-8000-000000000002.png");
  const unrelatedArtifact = join(artifactDirectory, "not-computer-linker.png");
  await writeFile(staleArtifact, Buffer.from(twoByTwoPng, "base64"));
  await writeFile(freshArtifact, Buffer.from(twoByTwoPng, "base64"));
  await writeFile(unrelatedArtifact, "keep");
  const oldDate = new Date(Date.now() - 10_000);
  await utimes(staleArtifact, oldDate, oldDate);

  const cleanup = await cleanupScreenshotArtifacts({ nowMs: Date.now(), maxAgeMs: 1000, maxFiles: 10, maxTotalBytes: 1024 });
  assert.equal(cleanup.removed, 1);
  await assert.rejects(() => access(staleArtifact));
  await access(freshArtifact);
  await access(unrelatedArtifact);
  const artifactStatus = screenshotArtifactStatus({ nowMs: Date.now(), maxAgeMs: 1000 });
  assert.equal(artifactStatus.fileCount, 1);
  assert.equal(artifactStatus.staleCount, 0);

  if (process.platform === "win32") {
    const fakeProvider = await installFakeWindowsScreenshotProvider(root);
    process.env.COMPUTER_LINKER_WINDOWS_SCREENSHOT_COMMAND = fakeProvider;

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

  const fakeLinuxBin = join(root, "fake-linux-bin");
  await mkdir(fakeLinuxBin, { recursive: true });
  process.env.COMPUTER_LINKER_SCREENSHOT_PLATFORM = "linux";
  process.env.PATH = [fakeLinuxBin, originalPath ?? ""].filter(Boolean).join(delimiter);
  process.env.WAYLAND_DISPLAY = "wayland-test";
  delete process.env.DISPLAY;

  await installFakeScreenshotTool(fakeLinuxBin, "grim");
  const grimCapability = screenshotCapability();
  assert.equal(grimCapability.provider, "linux-grim");
  assert.equal(grimCapability.supported, true);
  assert.deepEqual(grimCapability.modes, ["display"]);
  assert.deepEqual(grimCapability.displays, [{ id: "primary", primary: true }]);

  const linuxInline = await captureScreenshot({
    source: "display",
    target: "primary",
    returnMode: "base64",
  });
  assert.equal(linuxInline.provider, "linux-grim");
  assert.equal(linuxInline.width, 2);
  assert.equal(linuxInline.height, 2);
  assert.equal(linuxInline.bytesBase64, twoByTwoPng);

  await installFakeScreenshotTool(fakeLinuxBin, "grim", { fail: true });
  await assert.rejects(
    async () => {
      try {
        await captureScreenshot({ source: "display", returnMode: "base64" });
      } catch (error) {
        assert.equal((error as { code?: string }).code, "os_permission_required");
        throw error;
      }
    },
    /screenshot capture failed/,
  );

  await rm(join(fakeLinuxBin, process.platform === "win32" ? "grim.cmd" : "grim"), { force: true });
  await installFakeScreenshotTool(fakeLinuxBin, "gnome-screenshot");
  const gnomeCapability = screenshotCapability();
  assert.equal(gnomeCapability.provider, "linux-gnome-screenshot");
  assert.equal(gnomeCapability.supported, true);

  delete process.env.WAYLAND_DISPLAY;
  delete process.env.DISPLAY;
  const noSessionCapability = screenshotCapability();
  assert.equal(noSessionCapability.provider, "linux-gnome-screenshot");
  assert.equal(noSessionCapability.supported, false);
  assert.equal(noSessionCapability.permission.status, "os_permission_required");
  assert.match(noSessionCapability.permission.detail ?? "", /active desktop session/);

  await rm(join(fakeLinuxBin, process.platform === "win32" ? "gnome-screenshot.cmd" : "gnome-screenshot"), { force: true });
  const unsupportedLinuxCapability = screenshotCapability();
  assert.equal(unsupportedLinuxCapability.provider, "linux-screenshot");
  assert.equal(unsupportedLinuxCapability.supported, false);
  assert.match(unsupportedLinuxCapability.permission.detail ?? "", /Install grim, gnome-screenshot, or ImageMagick import/);
} finally {
  if (originalWindowsScreenshotCommand === undefined) {
    delete process.env.COMPUTER_LINKER_WINDOWS_SCREENSHOT_COMMAND;
  } else {
    process.env.COMPUTER_LINKER_WINDOWS_SCREENSHOT_COMMAND = originalWindowsScreenshotCommand;
  }
  if (originalScreenshotDirectory === undefined) {
    delete process.env.COMPUTER_LINKER_SCREENSHOT_DIR;
  } else {
    process.env.COMPUTER_LINKER_SCREENSHOT_DIR = originalScreenshotDirectory;
  }
  if (originalScreenshotPlatform === undefined) {
    delete process.env.COMPUTER_LINKER_SCREENSHOT_PLATFORM;
  } else {
    process.env.COMPUTER_LINKER_SCREENSHOT_PLATFORM = originalScreenshotPlatform;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalWaylandDisplay === undefined) {
    delete process.env.WAYLAND_DISPLAY;
  } else {
    process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
  }
  if (originalDisplay === undefined) {
    delete process.env.DISPLAY;
  } else {
    process.env.DISPLAY = originalDisplay;
  }
  await rm(root, { recursive: true, force: true });
}

async function installFakeScreenshotTool(directory: string, name: string, options: { fail?: boolean } = {}): Promise<string> {
  const scriptPath = join(directory, `${name}.cjs`);
  await writeFile(scriptPath, options.fail
    ? [
        "process.stderr.write('capture denied');",
        "process.exit(9);",
        "",
      ].join("\n")
    : [
        "const { writeFileSync } = require('node:fs');",
        `const png = Buffer.from(${JSON.stringify(twoByTwoPng)}, 'base64');`,
        "const output = process.argv[process.argv.length - 1];",
        "if (!output) throw new Error('missing screenshot output path');",
        "writeFileSync(output, png);",
        "",
      ].join("\n"));

  if (process.platform === "win32") {
    const commandPath = join(directory, `${name}.cmd`);
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

  const commandPath = join(directory, name);
  await writeFile(commandPath, [
    "#!/usr/bin/env sh",
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"`,
    "",
  ].join("\n"));
  await chmod(commandPath, 0o755);
  return commandPath;
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
