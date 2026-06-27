import { accessSync, constants } from "node:fs";
import { delimiter, extname, join } from "node:path";

export interface ShellCommand {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export function shellCommand(command: string, options: {
  platform?: NodeJS.Platform;
  shell?: string;
  comSpec?: string;
} = {}): ShellCommand {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return {
      command: options.comSpec ?? process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }
  return {
    command: options.shell ?? process.env.SHELL ?? "/bin/sh",
    args: ["-lc", command],
  };
}

export function resolveExecutableCommand(command: string, options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return command;

  const env = options.env ?? process.env;
  const pathEntries = (env.PATH ?? env.Path ?? env.path ?? "")
    .split(delimiter)
    .filter(Boolean);
  const extensions = windowsExecutableExtensions(env);
  const hasDirectory = command.includes("/") || command.includes("\\");
  const hasExtension = Boolean(extname(command));
  const commandCandidates = hasExtension
    ? [command]
    : extensions.map((extension) => `${command}${extension}`);
  const candidates = hasDirectory
    ? commandCandidates
    : pathEntries.flatMap((entry) => commandCandidates.map((candidate) => join(entry, candidate)));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH/PATHEXT candidate.
    }
  }

  return command;
}

export function executableCommand(command: string, args: string[], options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  comSpec?: string;
} = {}): ShellCommand {
  const platform = options.platform ?? process.platform;
  const executable = resolveExecutableCommand(command, {
    platform,
    env: options.env,
  });
  if (!shouldRunExecutableThroughShell(executable, { platform })) {
    return { command: executable, args };
  }

  const line = commandLine([executable, ...args], platform);
  if (platform === "win32") {
    return {
      command: options.comSpec ?? process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${line}"`],
      windowsVerbatimArguments: true,
    };
  }

  return shellCommand(line, {
    platform,
    shell: options.shell,
    comSpec: options.comSpec,
  });
}

export function windowsVerbatimArgumentsOption(command: ShellCommand): object {
  return command.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {};
}

export function findExecutableCommand(command: string, options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
} = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathEntries = (env.PATH ?? env.Path ?? env.path ?? "")
    .split(delimiter)
    .filter(Boolean);
  const extensions = platform === "win32" ? windowsExecutableExtensions(env) : [""];
  const hasDirectory = command.includes("/") || command.includes("\\");
  const hasExtension = Boolean(extname(command));
  const commandCandidates = platform === "win32" && !hasExtension
    ? extensions.map((extension) => `${command}${extension}`)
    : [command];
  const candidates = hasDirectory
    ? commandCandidates
    : pathEntries.flatMap((entry) => commandCandidates.map((candidate) => join(entry, candidate)));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH/PATHEXT candidate.
    }
  }

  return undefined;
}

export function shouldRunExecutableThroughShell(command: string, options: {
  platform?: NodeJS.Platform;
} = {}): boolean {
  const platform = options.platform ?? process.platform;
  return platform === "win32" && [".bat", ".cmd"].includes(extname(command).toLowerCase());
}

function commandLine(parts: string[], platform: NodeJS.Platform): string {
  return parts.map((part) => quoteCommandPart(part, platform)).join(" ");
}

function quoteCommandPart(part: string, platform: NodeJS.Platform): string {
  if (part === "") return "\"\"";
  if (platform === "win32") return quoteWindowsCommandPart(part);
  if (!/[\s"'\\$`!&|;<>(){}[\]*?]/.test(part)) return part;
  return `'${part.replaceAll("'", "'\\''")}'`;
}

function quoteWindowsCommandPart(part: string): string {
  if (!/[\s"&|<>^()%!:\\/]/.test(part)) return part;
  return `"${part.replaceAll("\"", "\"\"")}"`;
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return raw
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`).toLowerCase());
}
