import { compatibilityMcpTools, genericMcpTools } from "./mcp-surface.js";

export interface ComputerLinkerDiscovery {
  kind: "computer-linker-discovery";
  schemaVersion: 1;
  recommended: "primary";
  primary: {
    mcpTools: string[];
    mcpFlow: string[];
    jsonApi: {
      controlEndpoint: "POST /control";
      actions: string[];
      preferredAction: "computer_operation";
      exposure: "local-or-trusted-private";
    };
    endpoints: string[];
    registries: string[];
  };
  compatibility: {
    mcpTools: string[];
    mcpOptIn: "COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility";
    jsonApi: {
      actions: string[];
      endpoints: string[];
    };
    registries: string[];
    guidance: string;
  };
}

export const primaryJsonApiActions = [
  "get_computer_info",
  "client_setup",
  "computer_operation",
  "get_operation_history",
] as const;

export const compatibilityJsonApiActions = [
  "get_capabilities",
  "doctor",
  "list_workspaces",
  "history",
  "history_insight",
  "operation_registry",
  "computer_operation_registry",
  "workspace_operation_registry",
  "workspace_operation",
  "operation",
] as const;

export const primaryJsonApiEndpoints = ["POST /control"] as const;

export const compatibilityJsonApiEndpoints = [
  "GET /health",
  "GET /capabilities",
  "GET /workspaces",
  "GET /history",
  "POST /workspace-operation",
  "POST /control",
] as const;

export const primaryDiscoveryRegistries = [
  "get_computer_info.operationRegistry",
  "computerOperationRegistry",
  "operation_registry?contract=computer",
] as const;

export const compatibilityDiscoveryRegistries = [
  "operationRegistry",
  "workspace_operation_registry",
  "operation_registry?contract=workspace",
] as const;

export function computerLinkerDiscovery(): ComputerLinkerDiscovery {
  return {
    kind: "computer-linker-discovery",
    schemaVersion: 1,
    recommended: "primary",
    primary: {
      mcpTools: [...genericMcpTools],
      mcpFlow: [...genericMcpTools],
      jsonApi: {
        controlEndpoint: "POST /control",
        actions: [...primaryJsonApiActions],
        preferredAction: "computer_operation",
        exposure: "local-or-trusted-private",
      },
      endpoints: [...primaryJsonApiEndpoints],
      registries: [...primaryDiscoveryRegistries],
    },
    compatibility: {
      mcpTools: [...compatibilityMcpTools],
      mcpOptIn: "COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility",
      jsonApi: {
        actions: [...compatibilityJsonApiActions],
        endpoints: [...compatibilityJsonApiEndpoints],
      },
      registries: [...compatibilityDiscoveryRegistries],
      guidance: "Compatibility entries are for migration only; new clients should use primary MCP tools and computer_operation.",
    },
  };
}
