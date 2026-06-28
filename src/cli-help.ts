import { isNpmDevCliInvocation } from "./cli-format.js";
import { workspaceLinkerVersion } from "./package-metadata.js";

export function printHelp(args: string[] = []): void {
  if (args.length === 0) {
    printCoreHelp();
    return;
  }
  const [topic, ...rest] = args;
  if ((topic === "advanced" || topic === "all" || topic === "--advanced") && rest.length === 0) {
    printAdvancedHelp();
    return;
  }
  if (topic === "init" && rest.length === 0) {
    printInitHelp();
    return;
  }
  if (topic === "serve" && rest.length === 0) {
    printServeHelp();
    return;
  }
  if (topic === "here" && rest.length === 0) {
    printHereHelp();
    return;
  }
  if ((topic === "chatgpt" || topic === "client-chatgpt") && rest.length === 0) {
    printChatGptHelp();
    return;
  }
  if (topic === "client") {
    printClientHelpTopic(rest);
    return;
  }
  if (topic === "profile" && rest.length === 0) {
    printProfileHelp();
    return;
  }
  if (topic === "setup") {
    printSetupHelpTopic(rest);
    return;
  }
  if (topic === "expose") {
    printExposeHelpTopic(rest);
    return;
  }
  if (topic === "start" && rest.length === 0) {
    printStartHelp();
    return;
  }
  if (topic === "quickstart" && rest.length === 0) {
    printQuickstartHelp();
    return;
  }
  if (topic === "status" && rest.length === 0) {
    printStatusHelp();
    return;
  }
  if (topic === "check" && rest.length === 0) {
    printCheckHelp();
    return;
  }
  if ((topic === "self-test" || topic === "selftest") && rest.length === 0) {
    printSelfTestHelp();
    return;
  }
  if (topic === "doctor" && rest.length === 0) {
    printDoctorHelp();
    return;
  }
  if (topic === "diagnose" && rest.length === 0) {
    printDiagnoseHelp();
    return;
  }
  if (topic === "history" && rest.length === 0) {
    printHistoryHelp();
    return;
  }
  if (topic === "config") {
    printConfigHelpTopic(rest);
    return;
  }
  if (topic === "tunnel") {
    printTunnelHelpTopic(rest);
    return;
  }
  if (topic === "service") {
    printServiceHelpTopic(rest);
    return;
  }
  if (topic === "workspace") {
    printWorkspaceHelpTopic(rest);
    return;
  }
  throw new Error(`Unknown help topic: ${topic}`);
}

export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

export function printVersion(): void {
  console.log(`computer-linker ${workspaceLinkerVersion()}`);
}

export function printCliHelp(lines: string[]): void {
  console.log(formatCliHelp(lines.join("\n")));
}

export function formatCliHelp(text: string): string {
  if (!isNpmDevCliInvocation()) return text;
  return text
    .replace(/\bcomputer-linker\b/g, "npm run dev --")
    .replace(/npm run dev -- --version/g, "npm run dev -- version");
}

export function printInitHelp(): void {
  printCliHelp(
    [
      "Computer Linker init",
      "",
      "Usage:",
      "  computer-linker init [--show-token]",
      "",
      "What it does:",
      "  Creates the local config and owner token if they do not exist.",
      "  Use --show-token only on a trusted local setup screen.",
      "",
      "Example:",
      "  computer-linker init",
    ],
  );
}

export function printServeHelp(): void {
  printCliHelp(
    [
      "Computer Linker serve",
      "",
      "Usage:",
      "  computer-linker serve",
      "  computer-linker serve --transport http",
      "  computer-linker serve --transport stdio",
      "",
      "What it does:",
      "  Starts the MCP server without changing workspace config.",
      "  For daily use, prefer `computer-linker here` or `computer-linker start <folder>` so setup and server start happen together.",
    ],
  );
}

export function printCoreHelp(): void {
  printCliHelp(
    [
      "Computer Linker",
      "",
      "Usage:",
      "  computer-linker here",
      "  computer-linker start <workspace-path>",
      "  computer-linker start <workspace-path> --tunnel openai|tailscale|cloudflare",
      "  computer-linker check",
      "  computer-linker client setup",
      "  computer-linker status",
      "  computer-linker help advanced",
      "",
      "First run:",
      "  1. Optional install check: computer-linker check",
      "  2. In your project folder: computer-linker here",
      "  3. Connect client: computer-linker client setup",
      "  4. Check state: computer-linker status",
      "",
      "Cloud client:",
      "  computer-linker here --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker here --tunnel tailscale",
      "  computer-linker here --tunnel cloudflare",
      "",
      "From another folder:",
      "  computer-linker start C:\\Projects\\my-app --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start C:\\Projects\\my-app --tunnel tailscale",
      "  computer-linker start C:\\Projects\\my-app --tunnel cloudflare",
      "",
      "Before changing config:",
      "  computer-linker quickstart C:\\Projects\\my-app",
      "",
      "Notes:",
      "  here exposes the current folder; start <workspace-path> exposes another folder.",
      "  here and start <workspace-path> create config, token, and a workspace entry when needed, then run a local startup check.",
      "  Workspace names default to the folder name.",
      "  By default, here and start allow file edits and approved project commands for normal development work.",
      "  Use --read-only to inspect only; use --full-trust only when Codex and screen capture are intended.",
      "  Tokens stay hidden by default; use client setup --show-token only on a trusted local setup screen.",
      "  Details: computer-linker help here | computer-linker help check | computer-linker help start | computer-linker help client setup | computer-linker help advanced",
    ],
  );
}

export function printHereHelp(): void {
  printCliHelp(
    [
      "Computer Linker here",
      "",
      "Usage:",
      "  computer-linker here",
      "  computer-linker here --read-only",
      "  computer-linker here --full-trust",
      "  computer-linker here --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker here --tunnel tailscale",
      "  computer-linker here --tunnel cloudflare",
      "",
      "What it does:",
      "  Exposes the current folder and starts the local HTTP MCP server.",
      "  Equivalent to `computer-linker start .`, with a clearer daily-use name.",
      "  Uses the current folder name as the workspace name unless --name is provided.",
      "  A new workspace defaults to coding mode: file edits plus approved project commands.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --full-trust   Writes, approved commands, Codex operations, and screen capture.",
      "  --tunnel openai|tailscale|cloudflare",
      "  --name <name>  Override the workspace display name.",
      "  --id <id>      Override the stable workspace id.",
      "",
      "Examples:",
      "  computer-linker here",
      "  computer-linker here --read-only",
      "  computer-linker here --tunnel tailscale",
      "",
      "For another folder, use:",
      "  computer-linker start C:\\Projects\\my-app",
    ],
  );
}

export function printStartHelp(): void {
  printCliHelp(
    [
      "Computer Linker start",
      "",
      "Usage:",
      "  computer-linker start <workspace-path> [--codex] [--screen]",
      "  computer-linker start <workspace-path> --read-only",
      "  computer-linker start <workspace-path> --full-trust",
      "  computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start <workspace-path> --tunnel tailscale",
      "  computer-linker start <workspace-path> --tunnel cloudflare",
      "  computer-linker start",
      "",
      "What it does:",
      "  Creates config, owner token, and a workspace entry when needed.",
      "  Use `computer-linker here` when you are already inside the folder to expose.",
      "  Uses the folder name as the workspace name unless --name is provided.",
      "  Starts the local HTTP MCP server, runs a local startup check, and keeps running until you stop it.",
      "  A new workspace defaults to coding mode: file edits plus approved project commands.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --full-trust   Writes, approved commands, Codex operations, and screen capture.",
      "  --write        Allow file edits in this workspace.",
      "  --shell        Allow approved local commands and package scripts.",
      "  --codex        Allow Codex operations in this workspace.",
      "  --screen       Allow screen capture operations.",
      "  --tunnel openai|tailscale|cloudflare",
      "  --show-token   Print the owner token on this trusted local screen.",
      "  OpenAI tunnel requires CONTROL_PLANE_API_KEY or OPENAI_API_KEY with Tunnels Read+Use permissions.",
      "",
      "Examples:",
      "  computer-linker start C:\\Projects\\my-app",
      "  computer-linker start C:\\Projects\\my-app --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start C:\\Projects\\my-app --tunnel tailscale",
    ],
  );
}

export function printQuickstartHelp(): void {
  printCliHelp(
    [
      "Computer Linker quickstart",
      "",
      "Usage:",
      "  computer-linker quickstart [workspace-path]",
      "  computer-linker quickstart [workspace-path] --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker quickstart [workspace-path] --tunnel tailscale",
      "  computer-linker quickstart [workspace-path] --tunnel cloudflare",
      "",
      "What it does:",
      "  Prints the exact commands to test, start, configure, and verify Computer Linker.",
      "  Does not read or write config.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --full-trust   Include write, shell, Codex, and screen permission.",
      "  --write        Include write permission in the generated start command.",
      "  --shell        Include shell/package command permission in the generated start command.",
      "  --codex        Include Codex permission in the generated start command.",
      "  --screen       Include screen capture permission in the generated start command.",
      "  --json         Print the quickstart plan as JSON.",
      "",
      "Examples:",
      "  computer-linker quickstart C:\\Projects\\my-app",
      "  computer-linker quickstart C:\\Projects\\my-app --tunnel openai --tunnel-id tunnel_...",
    ],
  );
}

export function printProfileHelp(): void {
  printCliHelp(
    [
      "Computer Linker profile",
      "",
      "Usage:",
      "  computer-linker profile [--show-token]",
      "",
      "What it does:",
      "  Prints MCP connection profile JSON for local setup screens and clients.",
      "  Tokens are redacted unless --show-token is passed on a trusted local screen.",
      "",
      "Example:",
      "  computer-linker profile",
    ],
  );
}

export function printClientHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic) {
    printClientHelp();
    return;
  }
  if (topic === "setup" && rest.length === 0) {
    printClientSetupHelp();
    return;
  }
  if (topic === "smoke" && rest.length === 0) {
    printClientSmokeHelp();
    return;
  }
  if (topic === "diagnose" && rest.length === 0) {
    printClientDiagnoseHelp();
    return;
  }
  if (topic === "chatgpt" && rest.length === 0) {
    printChatGptHelp();
    return;
  }
  throw new Error(`Unknown client help topic: ${args.join(" ")}`);
}

export function printClientHelp(): void {
  printCliHelp(
    [
      "Computer Linker client",
      "",
      "Usage:",
      "  computer-linker client setup [--details] [--show-token] [--json]",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json]",
      "  computer-linker client diagnose [--local|--remote|--url https://.../mcp] [--json]",
      "  computer-linker client chatgpt <subcommand>",
      "",
      "What it does:",
      "  Prints generic MCP client setup details and runs connection smoke tests.",
      "  ChatGPT-specific exports are compatibility helpers; prefer generic setup first.",
      "",
      "More help:",
      "  computer-linker client help setup",
      "  computer-linker client help smoke",
      "  computer-linker client help diagnose",
    ],
  );
}

export function printClientSetupHelp(): void {
  printCliHelp(
    [
      "Computer Linker client setup",
      "",
      "Usage:",
      "  computer-linker client setup [--details] [--show-token] [--json]",
      "",
      "What it does:",
      "  Prints a short MCP client connection summary by default.",
      "  Use --details for tool names, first prompt, and copy-pasteable agent instructions.",
      "  Use --show-token only on a trusted local setup screen when the client needs a bearer token.",
      "",
      "Examples:",
      "  computer-linker client setup",
      "  computer-linker client setup --details",
      "  computer-linker client setup --show-token",
    ],
  );
}

export function printClientSmokeHelp(): void {
  printCliHelp(
    [
      "Computer Linker client smoke",
      "",
      "Usage:",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Runs a small MCP client smoke test against the configured or provided MCP URL.",
      "  Use --allow-http only for trusted local loopback tests.",
      "  Token lookup uses config first, then COMPUTER_LINKER_TOKEN. Use --token only for CI or non-interactive automation.",
      "",
      "Example:",
      "  computer-linker client smoke --allow-http --url http://127.0.0.1:3939/mcp",
    ],
  );
}

export function printClientDiagnoseHelp(): void {
  printCliHelp(
    [
      "Computer Linker client diagnose",
      "",
      "Usage:",
      "  computer-linker client diagnose [--local|--remote|--url https://.../mcp] [--json] [--timeout-ms ms]",
      "  computer-linker diagnose client [--local|--remote|--url https://.../mcp] [--json] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Runs MCP client setup checks, a minimal MCP client smoke test, and redacted connection-history inspection.",
      "  Defaults to local loopback. Use --remote for the configured public URL or --url for one explicit endpoint.",
      "",
      "Examples:",
      "  computer-linker diagnose client",
      "  computer-linker diagnose client --remote",
      "  computer-linker diagnose client --url https://example.com/mcp",
    ],
  );
}

export function printDiagnoseHelp(): void {
  printClientDiagnoseHelp();
}

export function printSetupHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "mcp-only" || topic === "cloudflare-mcp") {
    if (rest.length > 0) throw new Error(`Unknown setup help topic: ${args.join(" ")}`);
    printSetupHelp();
    return;
  }
  throw new Error(`Unknown setup help topic: ${args.join(" ")}`);
}

export function printSetupHelp(): void {
  printCliHelp(
    [
      "Computer Linker setup",
      "",
      "Usage:",
      "  computer-linker setup <workspace-path> [--read-only|--full-trust]",
      "  computer-linker setup <workspace-path> --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker setup <workspace-path> --tunnel tailscale",
      "  computer-linker setup <workspace-path> --tunnel cloudflare",
      "",
      "What it does:",
      "  Creates or updates config, owner token, public MCP-only mode, and one workspace entry without starting the server.",
      "  Workspace names default to the folder name.",
      "  For one-command daily use, prefer `computer-linker here` inside the folder or `computer-linker start <workspace-path>` from elsewhere.",
      "  New setup entries default to coding mode: file edits plus approved project commands.",
      "  Use --read-only to inspect only; use --full-trust only when Codex and screen capture are intended.",
      "",
      "Example:",
      "  computer-linker setup C:\\Projects\\my-app",
    ],
  );
}

export function printExposeHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic) {
    printExposeHelp();
    return;
  }
  if ((topic === "tailscale" || topic === "cloudflare") && rest.length === 0) {
    printExposeProviderHelp(topic);
    return;
  }
  throw new Error(`Unknown expose help topic: ${args.join(" ")}`);
}

export function printExposeHelp(): void {
  console.log(
    [
      "Computer Linker expose",
      "",
      "Usage:",
      "  computer-linker expose tailscale [--mode funnel]",
      "  computer-linker expose cloudflare",
      "",
      "What it does:",
      "  Starts an HTTP MCP server and opens a tunnel to it.",
      "  `here --tunnel ...` or `start <workspace-path> --tunnel ...` is the simpler development path.",
      "",
      "More help:",
      "  computer-linker expose help tailscale",
      "  computer-linker expose help cloudflare",
    ].join("\n"),
  );
}

export function printExposeProviderHelp(provider: string): void {
  console.log(
    [
      `Computer Linker expose ${provider}`,
      "",
      "Usage:",
      provider === "tailscale"
        ? "  computer-linker expose tailscale [--mode funnel]"
        : "  computer-linker expose cloudflare",
      "",
      "What it does:",
      provider === "tailscale"
        ? "  Opens a Tailscale Funnel tunnel to the local HTTP MCP server."
        : "  Opens a Cloudflare tunnel to the local HTTP MCP server.",
      "  Public host requests are restricted to the MCP endpoint by Computer Linker.",
    ].join("\n"),
  );
}

export function printStatusHelp(): void {
  console.log(
    [
      "Computer Linker status",
      "",
      "Usage:",
      "  computer-linker status [--details] [--json]",
      "",
      "What it does:",
      "  Prints the daily readiness summary: connection mode, local MCP URL, workspace/tunnel counts, and the next few actions.",
      "  Use --details for warnings, workspace rows, running tunnel rows, and all next actions.",
      "",
      "Example:",
      "  computer-linker status",
    ].join("\n"),
  );
}

export function printSelfTestHelp(): void {
  console.log(
    [
      "Computer Linker self-test",
      "",
      "Usage:",
      "  computer-linker self-test [--json] [--keep-temp] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Starts a temporary local MCP server, runs a safe client smoke test, then cleans up.",
      "  It does not use your configured workspaces unless --keep-temp leaves the temporary files for inspection.",
      "",
      "Example:",
      "  computer-linker self-test",
    ].join("\n"),
  );
}

export function printCheckHelp(): void {
  console.log(
    [
      "Computer Linker check",
      "",
      "Usage:",
      "  computer-linker check [--json] [--keep-temp] [--timeout-ms ms]",
      "",
      "What it does:",
      "  Runs an isolated install check without touching your real config or folders.",
      "  Creates a temporary config and workspace, starts a loopback MCP server,",
      "  verifies health, MCP initialize, tools/list, get_computer_info, and one read-only computer_operation.",
      "",
      "Example:",
      "  computer-linker check",
    ].join("\n"),
  );
}

export function printDoctorHelp(): void {
  console.log(
    [
      "Computer Linker doctor",
      "",
      "Usage:",
      "  computer-linker doctor [--json]",
      "  computer-linker doctor --fix [--dry-run] [--json]",
      "",
      "What it does:",
      "  Checks config, auth, tunnel tools, local tools, startup readiness, and release readiness.",
      "  --fix applies low-risk config repairs, such as removing exact duplicate scopes and filling execution policy defaults.",
      "",
      "Examples:",
      "  computer-linker doctor",
      "  computer-linker doctor --fix --dry-run",
    ].join("\n"),
  );
}

export function printHistoryHelp(): void {
  console.log(
    [
      "Computer Linker history",
      "",
      "Usage:",
      "  computer-linker history [--view summary|last|timeline|sessions|connections|failed_replay|debug_bundle] [--workspace id] [--query text] [--limit n] [--json] [--output file]",
      "",
      "What it does:",
      "  Reads redacted local operation history for troubleshooting MCP client behavior.",
      "",
      "Examples:",
      "  computer-linker history --view last",
      "  computer-linker history --view connections",
    ].join("\n"),
  );
}

export function printConfigHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "path") {
    if (rest.length > 0) throw new Error(`Unknown config help topic: ${args.join(" ")}`);
    printConfigHelp();
    return;
  }
  if (topic === "show" && rest.length === 0) {
    printConfigShowHelp();
    return;
  }
  if (topic === "validate" && rest.length === 0) {
    printConfigValidateHelp();
    return;
  }
  if (topic === "token" && rest.length === 0) {
    printConfigTokenHelp();
    return;
  }
  if (topic === "policy" && rest.length === 0) {
    printConfigPolicyHelp();
    return;
  }
  if ((topic === "set-public-url" || topic === "set-public-base-url") && rest.length === 0) {
    printConfigPublicUrlHelp();
    return;
  }
  if ((topic === "clear-public-url" || topic === "clear-public-base-url") && rest.length === 0) {
    printConfigClearPublicUrlHelp();
    return;
  }
  throw new Error(`Unknown config help topic: ${args.join(" ")}`);
}

export function printConfigHelp(): void {
  console.log(
    [
      "Computer Linker config",
      "",
      "Usage:",
      "  computer-linker config path",
      "  computer-linker config show [--show-token]",
      "  computer-linker config validate [--json]",
      "  computer-linker config token [rotate] [--show-token] [--json]",
      "  computer-linker config policy <workspace-id> [--json] [--allow pattern] [--deny pattern] [--allow-shell-metacharacters|--block-shell-metacharacters]",
      "  computer-linker config policy <workspace-id> [--allow-sensitive-path-metadata|--block-sensitive-path-metadata] [--allow-sensitive-path-writes|--block-sensitive-path-writes]",
      "  computer-linker config set-public-url <https-url>",
      "  computer-linker config clear-public-url",
      "",
      "What it does:",
      "  Inspects and updates the local Computer Linker config file.",
      "  Tokens are redacted unless --show-token is explicitly passed on a trusted local screen.",
      "",
      "More help:",
      "  computer-linker config help token",
      "  computer-linker config help policy",
    ].join("\n"),
  );
}

export function printConfigShowHelp(): void {
  console.log(
    [
      "Computer Linker config show",
      "",
      "Usage:",
      "  computer-linker config show [--show-token]",
      "",
      "What it does:",
      "  Prints the local config as JSON. The owner token is redacted unless --show-token is passed.",
    ].join("\n"),
  );
}

export function printConfigValidateHelp(): void {
  console.log(
    [
      "Computer Linker config validate",
      "",
      "Usage:",
      "  computer-linker config validate [--json]",
      "",
      "What it does:",
      "  Checks config and security diagnostics without modifying the config.",
    ].join("\n"),
  );
}

export function printConfigTokenHelp(): void {
  console.log(
    [
      "Computer Linker config token",
      "",
      "Usage:",
      "  computer-linker config token [rotate] [--show-token] [--json]",
      "",
      "What it does:",
      "  Shows token status or rotates the owner token.",
      "  Use --show-token only on a trusted local setup screen.",
    ].join("\n"),
  );
}

export function printConfigPolicyHelp(): void {
  console.log(
    [
      "Computer Linker config policy",
      "",
      "Usage:",
      "  computer-linker config policy <workspace-id> [--json]",
      "  computer-linker config policy <workspace-id> [--allow pattern] [--deny pattern] [--max-runtime-seconds n] [--max-output-bytes n]",
      "  computer-linker config policy <workspace-id> [--allow-shell-metacharacters|--block-shell-metacharacters]",
      "  computer-linker config policy <workspace-id> [--allow-sensitive-path-metadata|--block-sensitive-path-metadata] [--allow-sensitive-path-writes|--block-sensitive-path-writes]",
      "",
      "What it does:",
      "  Reads or updates workspace policy for command execution and sensitive path handling.",
      "  Shell metacharacters are blocked unless explicitly allowed for a trusted scope.",
      "  Sensitive path metadata and writes stay blocked unless explicitly allowed for a trusted scope.",
    ].join("\n"),
  );
}

export function printConfigPublicUrlHelp(): void {
  console.log(
    [
      "Computer Linker config set-public-url",
      "",
      "Usage:",
      "  computer-linker config set-public-url <https-url>",
      "",
      "What it does:",
      "  Stores the public HTTPS base URL used by URL-based remote MCP clients.",
    ].join("\n"),
  );
}

export function printConfigClearPublicUrlHelp(): void {
  console.log(
    [
      "Computer Linker config clear-public-url",
      "",
      "Usage:",
      "  computer-linker config clear-public-url",
      "",
      "What it does:",
      "  Removes the configured public base URL. This does not stop any running tunnel.",
    ].join("\n"),
  );
}

export function printTunnelHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "status") {
    if (rest.length > 0) throw new Error(`Unknown tunnel help topic: ${args.join(" ")}`);
    printTunnelHelp();
    return;
  }
  throw new Error(`Unknown tunnel help topic: ${args.join(" ")}`);
}

export function printTunnelHelp(): void {
  console.log(
    [
      "Computer Linker tunnel",
      "",
      "Usage:",
      "  computer-linker tunnel status [--json]",
      "",
      "What it does:",
      "  Shows detected tunnel tools, running tunnel processes, effective public URL, and suggested commands.",
      "  OpenAI Secure MCP Tunnel mode reports a tunnel id, not a public URL.",
      "",
      "Example:",
      "  computer-linker tunnel status",
    ].join("\n"),
  );
}

export function printServiceHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "profile") {
    if (rest.length > 0) throw new Error(`Unknown service help topic: ${args.join(" ")}`);
    printServiceHelp();
    return;
  }
  if (topic === "status" && rest.length === 0) {
    printServiceStatusHelp();
    return;
  }
  if ((topic === "install" || topic === "uninstall") && rest.length === 0) {
    printServiceInstallHelp(topic);
    return;
  }
  if ((topic === "start" || topic === "stop") && rest.length === 0) {
    printServiceControlHelp(topic);
    return;
  }
  if (topic === "logs" && rest.length === 0) {
    printServiceLogsHelp();
    return;
  }
  throw new Error(`Unknown service help topic: ${args.join(" ")}`);
}

export function printServiceHelp(): void {
  console.log(
    [
      "Computer Linker service",
      "",
      "Usage:",
      "  computer-linker service profile [--platform linux|macos|windows] [--format profile|manifest]",
      "  computer-linker service profile --output-dir ./service-profile [--platform linux|macos|windows]",
      "  computer-linker service status [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --dry-run [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service uninstall --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service start|stop [--platform linux|macos|windows] [--json]",
      "  computer-linker service logs [--lines 100] [--platform linux|macos|windows] [--json]",
      "",
      "What it does:",
      "  Generates service-manager profiles and controls the local background service.",
      "  Install and uninstall require --yes; use --dry-run to preview without changing the OS.",
      "",
      "More help:",
      "  computer-linker service help status",
      "  computer-linker service help install",
      "  computer-linker service help logs",
    ].join("\n"),
  );
}

export function printServiceStatusHelp(): void {
  console.log(
    [
      "Computer Linker service status",
      "",
      "Usage:",
      "  computer-linker service status [--platform linux|macos|windows] [--json]",
      "",
      "What it does:",
      "  Prints service-manager status metadata, daily start/stop commands, and log locations.",
    ].join("\n"),
  );
}

export function printServiceInstallHelp(action: string): void {
  console.log(
    [
      `Computer Linker service ${action}`,
      "",
      "Usage:",
      `  computer-linker service ${action} --dry-run [--platform linux|macos|windows] [--json]`,
      `  computer-linker service ${action} --yes [--platform linux|macos|windows] [--json]`,
      "",
      "What it does:",
      `  Prints the ${action} plan with --dry-run, or applies it with --yes.`,
    ].join("\n"),
  );
}

export function printServiceControlHelp(action: string): void {
  console.log(
    [
      `Computer Linker service ${action}`,
      "",
      "Usage:",
      `  computer-linker service ${action} [--platform linux|macos|windows] [--json]`,
      `  computer-linker service ${action} --dry-run [--platform linux|macos|windows] [--json]`,
      "",
      "What it does:",
      `  ${action === "start" ? "Starts" : "Stops"} the installed service on the current platform.`,
    ].join("\n"),
  );
}

export function printServiceLogsHelp(): void {
  console.log(
    [
      "Computer Linker service logs",
      "",
      "Usage:",
      "  computer-linker service logs [--lines 100] [--platform linux|macos|windows] [--json]",
      "",
      "What it does:",
      "  Reads generated service stdout/stderr logs when available and prints the native log command.",
    ].join("\n"),
  );
}

export function printWorkspaceHelpTopic(args: string[]): void {
  const [topic, ...rest] = args;
  if (!topic || topic === "list") {
    if (rest.length > 0) throw new Error(`Unknown workspace help topic: ${args.join(" ")}`);
    printWorkspaceHelp();
    return;
  }
  if (topic === "add" && rest.length === 0) {
    printWorkspaceAddHelp();
    return;
  }
  if (topic === "update" && rest.length === 0) {
    printWorkspaceUpdateHelp();
    return;
  }
  if (topic === "remove" && rest.length === 0) {
    printWorkspaceRemoveHelp();
    return;
  }
  throw new Error(`Unknown workspace help topic: ${args.join(" ")}`);
}

export function printWorkspaceHelp(): void {
  console.log(
    [
      "Computer Linker workspace",
      "",
      "Usage:",
      "  computer-linker workspace list",
      "  computer-linker workspace add <path> [--id workspace-id] [--name name] [--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]",
      "  computer-linker workspace update <id> [--name name] [--path path] [--read-only|--full-trust] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen]",
      "  computer-linker workspace remove <id>",
      "",
      "What it does:",
      "  Manages the local list of folders exposed to MCP clients.",
      "  Direct workspace add entries are read-only by default; add --write/--shell only when needed.",
      "  For daily setup, prefer `computer-linker start <path>`; it creates a normal coding workspace automatically.",
      "  Workspace names default to the folder name when omitted.",
      "  This does not delete the folder on disk when removing a workspace entry.",
      "",
      "Examples:",
      "  computer-linker workspace add C:\\Projects\\my-app --write --shell",
      "  computer-linker workspace update my-app --no-shell",
      "  computer-linker workspace remove my-app",
      "",
      "More help:",
      "  computer-linker workspace help add",
      "  computer-linker workspace help update",
      "  computer-linker workspace help remove",
    ].join("\n"),
  );
}

export function printWorkspaceAddHelp(): void {
  console.log(
    [
      "Computer Linker workspace add",
      "",
      "Usage:",
      "  computer-linker workspace add <path> [--id workspace-id] [--name name] [--read-only|--full-trust] [--write] [--shell] [--codex] [--screen]",
      "",
      "What it does:",
      "  Adds one folder to the local MCP workspace list.",
      "  If --id is omitted, the id is derived from the folder name.",
      "  If --name is omitted, the workspace name is the folder name.",
      "",
      "Common options:",
      "  --read-only    Read/search/history only.",
      "  --full-trust   Allow writes, local commands, Codex operations, and screen capture.",
      "  --write        Allow file edits in this workspace.",
      "  --shell        Allow local commands and package scripts.",
      "  --codex        Allow Codex operations in this workspace.",
      "  --screen       Allow screen capture operations.",
      "",
      "Example:",
      "  computer-linker workspace add C:\\Projects\\my-app --write --shell",
    ].join("\n"),
  );
}

export function printWorkspaceUpdateHelp(): void {
  console.log(
    [
      "Computer Linker workspace update",
      "",
      "Usage:",
      "  computer-linker workspace update <id> [--name name] [--path path] [--read-only|--full-trust] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen]",
      "",
      "What it does:",
      "  Updates an existing workspace entry without changing unrelated entries.",
      "",
      "Examples:",
      "  computer-linker workspace update my-app --write --shell",
      "  computer-linker workspace update my-app --no-shell",
    ].join("\n"),
  );
}

export function printWorkspaceRemoveHelp(): void {
  console.log(
    [
      "Computer Linker workspace remove",
      "",
      "Usage:",
      "  computer-linker workspace remove <id>",
      "",
      "What it does:",
      "  Removes one workspace entry from the local MCP workspace list.",
      "  This does not delete the folder on disk.",
      "",
      "Example:",
      "  computer-linker workspace remove my-app",
    ].join("\n"),
  );
}

export function printAdvancedHelp(): void {
  printCliHelp(
    [
      "Computer Linker",
      "",
      "Advanced Usage:",
      "  computer-linker init [--show-token]",
      "  computer-linker --version",
      "  computer-linker here [--tunnel cloudflare|tailscale|openai] [--read-only|--full-trust]",
      "  computer-linker quickstart [workspace-path] [--tunnel cloudflare|tailscale|openai] [--tunnel-id tunnel_...] [--url https://...] [--write] [--shell] [--codex] [--screen] [--read-only|--full-trust] [--json]",
      "  computer-linker serve      Start the stdio MCP server",
      "  computer-linker serve --transport http",
      "  computer-linker start [workspace-path] [--write] [--shell] [--codex] [--screen] [--read-only|--full-trust]",
      "                           Configure a workspace when provided, then start the HTTP MCP server",
      "  computer-linker start      Start local HTTP MCP server",
      "  computer-linker start --tunnel cloudflare",
      "  computer-linker start --no-tunnel",
      "  computer-linker start --tunnel tailscale",
      "  computer-linker start --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker status [--details] [--json]",
      "  computer-linker check [--json] [--keep-temp] [--timeout-ms ms]",
      "  computer-linker self-test [--json] [--keep-temp] [--timeout-ms ms]",
      "  computer-linker process list <workspace-id> [--json]",
      "  computer-linker process read <workspace-id> <process-id> [--json]",
      "  computer-linker process stop <workspace-id> <process-id> [--signal SIGTERM|SIGINT|SIGKILL] [--json]",
      "  computer-linker screen status [--json]",
      "  computer-linker expose cloudflare",
      "  computer-linker expose tailscale --mode funnel",
      "  computer-linker tunnel status [--json]",
      "  computer-linker service profile [--platform linux|macos|windows] [--format profile|manifest]",
      "  computer-linker service profile --output-dir ./service-profile [--platform linux|macos|windows]",
      "  computer-linker service status [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --dry-run [--platform linux|macos|windows] [--json]",
      "  computer-linker service install --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service uninstall --dry-run [--platform linux|macos|windows] [--json]",
      "  computer-linker service uninstall --yes [--platform linux|macos|windows] [--json]",
      "  computer-linker service start|stop [--platform linux|macos|windows] [--json]",
      "  computer-linker service logs [--lines 100] [--platform linux|macos|windows] [--json]",
      "  computer-linker doctor",
      "  computer-linker doctor --json",
      "  computer-linker doctor --fix [--dry-run] [--json]",
      "  computer-linker diagnose client [--local|--remote|--url https://.../mcp] [--json]",
      "  computer-linker profile [--show-token]",
      "  computer-linker client setup [--details] [--show-token] [--json]",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json]",
      "  computer-linker client diagnose [--local|--remote|--url https://.../mcp] [--json]",
      "  computer-linker setup <workspace-path> [--tunnel cloudflare|tailscale|openai] [--tunnel-id tunnel_...] [--id workspace-id] [--name name] [--write] [--shell] [--codex] [--screen] [--read-only|--full-trust] [--show-token] [--json]",
      "  computer-linker history [--view summary|last|timeline|sessions|connections|failed_replay|debug_bundle] [--workspace id] [--query text] [--limit n] [--json] [--output file]",
      "  computer-linker config path",
      "  computer-linker config show [--show-token]",
      "  computer-linker config validate [--json]",
      "  computer-linker config token [rotate] [--show-token] [--json]",
      "  computer-linker config policy <workspace-id> [--json]",
      "  computer-linker config policy <workspace-id> [--allow pattern] [--deny pattern] [--max-runtime-seconds n] [--max-output-bytes n] [--allow-shell-metacharacters|--block-shell-metacharacters] [--allow-sensitive-path-metadata|--block-sensitive-path-metadata] [--allow-sensitive-path-writes|--block-sensitive-path-writes]",
      "  computer-linker config set-public-url <https-url>",
      "  computer-linker config clear-public-url",
      "  computer-linker workspace list",
      "  computer-linker workspace add <path> [--id workspace-id] [--name name] [--write] [--shell] [--codex] [--screen] [--read-only|--full-trust]",
      "  computer-linker workspace update <id> [--name name] [--path path] [--write|--no-write] [--shell|--no-shell] [--codex|--no-codex] [--screen|--no-screen] [--read-only|--full-trust]",
      "  computer-linker workspace remove <id>",
      "  computer-linker help",
      "  computer-linker help chatgpt",
      "",
      "Client-specific helpers are compatibility exports layered over the generic MCP contract.",
      "Compatibility: LOCALPORT_* env vars and x-localport-token still work for existing configs.",
    ],
  );
}

export function printChatGptHelp(): void {
  printCliHelp(
    [
      "Computer Linker ChatGPT Compatibility Helpers",
      "",
      "ChatGPT is one MCP client, not the product axis. Prefer the generic setup commands first:",
      "  computer-linker client setup",
      "  computer-linker client smoke [--url https://.../mcp] [--token token] [--allow-http]",
      "  Prefer config or COMPUTER_LINKER_TOKEN for auth; --token is a CI/automation fallback.",
      "",
      "Use these only when ChatGPT asks for connector-specific fields or files:",
      "  computer-linker client chatgpt url [--show-token] [--json]",
      "  computer-linker client chatgpt smoke [--url https://.../mcp] [--token token] [--allow-http] [--show-token] [--json]",
      "  computer-linker client chatgpt verify [--mode safe|coding|full] [--json]",
      "  computer-linker client chatgpt profile [--mode safe|coding|full] [--url https://...] [--show-token]",
      "  computer-linker client chatgpt manifest [--mode safe|coding|full] [--url https://...]",
      "  computer-linker client chatgpt connector [--mode safe|coding|full] [--url https://...] [--show-token]",
      "  computer-linker client chatgpt files ./chatgpt-config [--mode safe|coding|full] [--url https://...] [--show-token]",
      "",
      "For OpenAI Secure MCP Tunnel, start with:",
      "  computer-linker here --tunnel openai --tunnel-id tunnel_...",
      "  computer-linker start <workspace-path> --tunnel openai --tunnel-id tunnel_...",
    ],
  );
}
