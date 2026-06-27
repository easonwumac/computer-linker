export function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function readClientTokenOption(args: string[]): string | undefined {
  return readOption(args, "--token") ??
    firstNonBlankEnvironmentValue([
      "COMPUTER_LINKER_TOKEN",
      "COMPUTER_LINKER_OWNER_TOKEN",
      "WORKSPACE_LINKER_TOKEN",
      "WORKSPACE_LINKER_OWNER_TOKEN",
    ]);
}

function firstNonBlankEnvironmentValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function readRepeatedOptions(args: string[], name: string, command: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${command} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

export function readOptionalStringOption(args: string[], name: string, command: string): string | undefined {
  const value = readOption(args, name);
  if (!args.includes(name)) return undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${command} requires a value`);
  }
  return value;
}

export function readOptionalIntegerOption(args: string[], name: string, command: string): number | undefined {
  const value = readOption(args, name);
  if (!args.includes(name)) return undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${command} requires a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${command} requires a positive integer`);
  }
  return parsed;
}

export function booleanFlag(args: string[], name: string, current: boolean): boolean {
  if (args.includes(`--${name}`)) return true;
  if (args.includes(`--no-${name}`)) return false;
  return current;
}
