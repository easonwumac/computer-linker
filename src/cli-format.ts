import { resolve } from "node:path";

export function invocationCommand(...args: string[]): string {
  return formatCliCommand([...invocationCommandParts(), ...args]);
}

export function invocationCommandParts(): string[] {
  if (isNpmDevCliInvocation()) {
    return ["npm", "run", "dev", "--"];
  }
  const scriptArg = process.argv[1];
  const invokedPath = scriptArg ? resolve(scriptArg) : "";
  const checkoutDistCliPath = resolve(process.cwd(), "dist", "cli.js");
  const normalizedInvokedPath = invokedPath.replaceAll("\\", "/").toLowerCase();
  if (
    normalizedInvokedPath.endsWith("/dist/cli.js") &&
    !isInstalledPackageCliPath(normalizedInvokedPath)
  ) {
    if (invokedPath === checkoutDistCliPath) {
      return ["node", process.platform === "win32" ? "dist\\cli.js" : "dist/cli.js"];
    }
    return ["node", invokedPath];
  }
  return ["computer-linker"];
}

function isInstalledPackageCliPath(normalizedInvokedPath: string): boolean {
  return /\/node_modules\/(?:@[^/]+\/)?computer-linker\/dist\/cli\.js$/.test(normalizedInvokedPath);
}

export function isNpmDevCliInvocation(): boolean {
  return (
    process.env.npm_lifecycle_event === "dev" &&
    typeof process.env.npm_lifecycle_script === "string" &&
    /\btsx(?:\s+|$)/.test(process.env.npm_lifecycle_script) &&
    /src[\\/]+cli\.ts\b/.test(process.env.npm_lifecycle_script)
  );
}

export function formatCliCommand(parts: string[]): string {
  return parts.map((part) => quoteCliPart(part)).join(" ");
}

function quoteCliPart(part: string): string {
  if (part === "") return "\"\"";
  if (process.platform === "win32") {
    if (!/[\s"&|<>^()%!:\\/]/.test(part)) return part;
    return `"${part.replaceAll("\"", "\"\"")}"`;
  }
  if (!/[\s"'\\$`!&|;<>(){}[\]*?]/.test(part)) return part;
  return `'${part.replaceAll("'", "'\\''")}'`;
}
