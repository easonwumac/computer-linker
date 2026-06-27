export type McpToolSurface = "generic" | "compatibility";

export const genericMcpTools = ["get_computer_info", "computer_operation", "get_operation_history"] as const;
export const compatibilityMcpTools = [
  "get_capabilities",
  "list_workspaces",
  "open_workspace",
  "read",
  "ls",
  "grep",
  "glob",
  "create_file",
  "workspace_operation",
] as const;

export function mcpToolSurface(): McpToolSurface {
  const raw = (process.env.WORKSPACE_LINKER_MCP_TOOL_SURFACE ?? process.env.LOCALPORT_MCP_TOOL_SURFACE ?? "generic")
    .trim()
    .toLowerCase();
  if (raw === "compatibility" || raw === "legacy" || raw === "all") return "compatibility";
  return "generic";
}

export function exposedMcpTools(surface: McpToolSurface = mcpToolSurface()): string[] {
  return surface === "compatibility"
    ? [...genericMcpTools, ...compatibilityMcpTools]
    : [...genericMcpTools];
}
