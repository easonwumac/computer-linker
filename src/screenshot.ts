import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { executableCommand, findExecutableCommand, windowsVerbatimArgumentsOption } from "./platform-shell.js";

const execFileAsync = promisify(execFile);
const windowsScreenshotCommandEnv = "WORKSPACE_LINKER_WINDOWS_SCREENSHOT_COMMAND";

export interface ScreenshotPermission {
  status: "granted" | "unknown" | "unsupported" | "os_permission_required";
  detail: string | null;
}

export interface ScreenshotListResult {
  permission: ScreenshotPermission;
  provider: string;
  supported: boolean;
  modes: string[];
  displays: Array<{ id: string; primary: boolean; width?: number; height?: number }>;
  windows: Array<{ id: string; title?: string; processId?: number; processName?: string }>;
}

export interface ScreenshotCaptureOptions {
  source: "display" | "window" | "process";
  target?: string;
  format?: string;
  returnMode?: string;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ScreenshotCaptureResult {
  format: "png";
  width?: number;
  height?: number;
  bytesBase64?: string;
  fileRef?: string;
  sizeBytes: number;
  source: {
    type: "display" | "window" | "process";
    id: string;
  };
  permission: ScreenshotPermission;
  provider: string;
}

export function screenshotCapability(): ScreenshotListResult {
  const provider = screenshotProvider();
  if (!provider.available) {
    return {
      permission: provider.permission,
      provider: provider.name,
      supported: false,
      modes: [],
      displays: [],
      windows: [],
    };
  }

  return {
    permission: provider.permission,
    provider: provider.name,
    supported: true,
    modes: provider.modes,
    displays: [{ id: "primary", primary: true }],
    windows: [],
  };
}

export function listScreenshotTargets(): ScreenshotListResult {
  return screenshotCapability();
}

export async function captureScreenshot(options: ScreenshotCaptureOptions): Promise<ScreenshotCaptureResult> {
  const provider = screenshotProvider();
  if (!provider.available) {
    throw new Error(provider.permission.detail ?? "screenshot provider is unavailable on this platform");
  }
  if (options.format && options.format !== "png") {
    throw new Error("only png screenshot format is currently supported");
  }
  validateScreenshotBounds(options);
  if (options.source === "process") {
    throw new Error("screen.capture_process is not implemented for this platform provider yet");
  }
  if (options.source === "display" && options.target && options.target !== "primary") {
    throw new Error("only the primary display target is currently supported");
  }
  if (options.source === "window" && !options.target) {
    throw new Error("window id is required for screen.capture_window");
  }
  if (!provider.modes.includes(options.source)) {
    throw new Error(`screen.${options.source} capture is not implemented for ${provider.name}`);
  }

  const dir = join(tmpdir(), "workspace-linker-screenshots");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `screenshot-${randomUUID()}.png`);
  const args = provider.captureArgs(options, file);

  try {
    const command = executableCommand(provider.command, args);
    await execFileAsync(command.command, command.args, {
      timeout: 30_000,
      windowsHide: true,
      ...windowsVerbatimArgumentsOption(command),
    });
  } catch (error) {
    await rm(file, { force: true });
    throw new Error(`screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await downscaleScreenshotIfNeeded(file, options);
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }

  const bytes = await readFile(file);
  const dimensions = pngDimensions(bytes);
  const returnMode = options.returnMode ?? "fileRef";
  const result: ScreenshotCaptureResult = {
    format: "png",
    ...dimensions,
    sizeBytes: bytes.byteLength,
    source: {
      type: options.source,
      id: options.target || "primary",
    },
    permission: provider.permission,
    provider: provider.name,
  };

  if (returnMode === "base64" || returnMode === "bytes") {
    result.bytesBase64 = bytes.toString("base64");
    await rm(file, { force: true });
    return result;
  }
  if (returnMode !== "fileRef") {
    await rm(file, { force: true });
    throw new Error("screenshot return must be one of: fileRef, base64, bytes");
  }

  result.fileRef = file;
  return result;
}

function screenshotProvider(): {
  name: string;
  available: boolean;
  command: string;
  modes: string[];
  permission: ScreenshotPermission;
  captureArgs: (options: ScreenshotCaptureOptions, file: string) => string[];
} {
  if (platform() === "darwin") {
    const command = findExecutableCommand("screencapture") ?? "/usr/sbin/screencapture";
    return {
      name: "macos-screencapture",
      available: true,
      command,
      modes: ["display", "window"],
      permission: {
        status: "unknown",
        detail: "macOS may prompt for Screen Recording permission when capture is requested.",
      },
      captureArgs: (options, file) => options.source === "window"
        ? ["-x", "-t", "png", "-l", String(options.target), file]
        : ["-x", "-t", "png", file],
    };
  }

  if (platform() === "win32") {
    const command = process.env[windowsScreenshotCommandEnv]
      ?? findExecutableCommand("powershell")
      ?? findExecutableCommand("powershell.exe")
      ?? findExecutableCommand("pwsh");
    if (!command) {
      return {
        name: "windows-powershell-screenshot",
        available: false,
        command: "",
        modes: [],
        permission: {
          status: "unsupported",
          detail: "Windows screenshot capture requires PowerShell or PowerShell Core on PATH.",
        },
        captureArgs: () => [],
      };
    }

    return {
      name: "windows-powershell-screenshot",
      available: true,
      command,
      modes: ["display"],
      permission: {
        status: "unknown",
        detail: "Windows desktop capture uses PowerShell and may fail in headless or non-interactive sessions.",
      },
      captureArgs: (_options, file) => [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        powershellScriptBlock(windowsDisplayCaptureScript()),
        file,
      ],
    };
  }

  return {
    name: `${platform()}-screenshot`,
    available: false,
    command: "",
    modes: [],
    permission: {
      status: "unsupported",
      detail: `screenshot capture provider is not implemented for ${platform()} yet`,
    },
    captureArgs: () => [],
  };
}

async function downscaleScreenshotIfNeeded(file: string, options: ScreenshotCaptureOptions): Promise<void> {
  if (!options.maxWidth && !options.maxHeight) return;

  const dimensions = pngDimensions(await readFile(file));
  if (!dimensions.width || !dimensions.height) {
    throw new Error("unable to determine PNG dimensions for screenshot downscaling");
  }
  const target = downscaledDimensions(dimensions.width, dimensions.height, options);
  if (target.width === dimensions.width && target.height === dimensions.height) {
    return;
  }

  const tempFile = join(tmpdir(), "workspace-linker-screenshots", `screenshot-resized-${randomUUID()}.png`);
  try {
    if (platform() === "win32") {
      await downscalePngWithPowerShell(file, tempFile, target);
    } else if (platform() === "darwin") {
      await downscalePngWithSips(file, tempFile, target);
    } else {
      throw new Error(`screenshot downscaling is not supported on ${platform()} yet`);
    }
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw new Error(`screenshot downscaling failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function downscaledDimensions(width: number, height: number, options: ScreenshotCaptureOptions): { width: number; height: number } {
  const widthScale = options.maxWidth && width > options.maxWidth ? options.maxWidth / width : 1;
  const heightScale = options.maxHeight && height > options.maxHeight ? options.maxHeight / height : 1;
  const scale = Math.min(widthScale, heightScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function downscalePngWithPowerShell(file: string, tempFile: string, target: { width: number; height: number }): Promise<void> {
  const command = findExecutableCommand("powershell")
    ?? findExecutableCommand("powershell.exe")
    ?? findExecutableCommand("pwsh");
  if (!command) {
    throw new Error("PowerShell is required for Windows screenshot downscaling");
  }
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    powershellScriptBlock(windowsDownscaleScript()),
    file,
    tempFile,
    String(target.width),
    String(target.height),
  ];
  const executable = executableCommand(command, args);
  await execFileAsync(executable.command, executable.args, {
    timeout: 30_000,
    windowsHide: true,
    ...windowsVerbatimArgumentsOption(executable),
  });
}

async function downscalePngWithSips(file: string, tempFile: string, target: { width: number; height: number }): Promise<void> {
  const command = findExecutableCommand("sips") ?? "/usr/bin/sips";
  await execFileAsync(command, ["-s", "format", "png", "-z", String(target.height), String(target.width), file, "--out", tempFile], {
    timeout: 30_000,
  });
}

function validateScreenshotBounds(options: ScreenshotCaptureOptions): void {
  for (const [label, value] of [["maxWidth", options.maxWidth], ["maxHeight", options.maxHeight]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`screenshot ${label} must be a positive integer`);
    }
  }
}

function windowsDisplayCaptureScript(): string {
  return [
    "param([string]$Path)",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "try {",
    "  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
    "  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)",
    "} finally {",
    "  $graphics.Dispose()",
    "  $bitmap.Dispose()",
    "}",
  ].join("; ");
}

function powershellScriptBlock(script: string): string {
  return `& { ${script} }`;
}

function windowsDownscaleScript(): string {
  return [
    "param([string]$Path, [string]$Output, [int]$Width, [int]$Height)",
    "Add-Type -AssemblyName System.Drawing",
    "$image = [System.Drawing.Image]::FromFile($Path)",
    "$bitmap = $null",
    "$graphics = $null",
    "try {",
    "  $bitmap = New-Object System.Drawing.Bitmap $Width, $Height",
    "  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "  $graphics.DrawImage($image, 0, 0, $Width, $Height)",
    "  $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)",
    "} finally {",
    "  if ($graphics -ne $null) { $graphics.Dispose() }",
    "  if ($bitmap -ne $null) { $bitmap.Dispose() }",
    "  $image.Dispose()",
    "}",
  ].join("; ");
}

function pngDimensions(bytes: Buffer): { width?: number; height?: number } {
  if (
    bytes.byteLength >= 24 &&
    bytes.toString("ascii", 1, 4) === "PNG" &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  return {};
}
