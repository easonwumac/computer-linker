import { readFileSync } from "node:fs";
import { z } from "zod";

export const CONFIG_SCHEMA_ID = "https://github.com/easonwumac/computer-linker/schemas/config.schema.json";

type JsonObject = Record<string, unknown>;

export interface ConfigSchemaIssue {
  path: string;
  code: string;
  message: string;
}

export interface ConfigSchemaValidation {
  valid: boolean;
  schemaId: string;
  schemaPath: string;
  issues: ConfigSchemaIssue[];
}

const nonBlankString = z.string().min(1, "must be a non-empty string");

const permissionsSchema = z.object({
  read: z.boolean().describe("Allow file reads and read-only project inspection."),
  write: z.boolean().describe("Allow file creation, edits, moves, and deletes inside the configured scope."),
  shell: z.boolean().describe("Allow command and package-script execution inside the configured scope."),
  codex: z.boolean().describe("Allow Codex operations inside the configured scope."),
  screen: z.boolean().optional().describe("Allow screenshot operations when a runtime provider is available."),
}).strict().describe("Permission flags for one folder-backed scope.");

const policySchema = z.object({
  maxRuntimeSeconds: z.number().int().min(1).max(86_400).optional()
    .describe("Maximum runtime for command-like operations in seconds."),
  maxOutputBytes: z.number().int().min(1).max(10 * 1024 * 1024).optional()
    .describe("Maximum captured stdout/stderr bytes for command-like operations."),
  allowedCommands: z.array(nonBlankString).max(100).optional()
    .describe("Command allow patterns such as npm *, pnpm *, node *, or git *."),
  deniedCommands: z.array(nonBlankString).max(100).optional()
    .describe("Command deny patterns that take precedence over allowedCommands."),
  allowShellMetacharacters: z.boolean().optional()
    .describe("Allow command chaining, pipes, redirects, and shell metacharacters before allowlist evaluation."),
  allowSensitivePathMetadata: z.boolean().optional()
    .describe("Allow list/tree/stat style metadata for secret-like path names."),
  allowSensitivePathWrites: z.boolean().optional()
    .describe("Allow write, patch, move, and delete operations for secret-like paths."),
}).strict().describe("Optional execution and sensitive-path policy for one scope.");

const workspaceSchema = z.object({
  id: nonBlankString.describe("Stable scope id used by MCP clients."),
  name: nonBlankString.describe("Human-friendly scope name."),
  path: nonBlankString.describe("Folder path exposed by this scope. ~ is expanded by Computer Linker."),
  permissions: permissionsSchema,
  policy: policySchema.optional(),
}).strict().describe("A folder-backed Computer Linker scope. The durable 0.x config field is workspaces[].");

export const configFileSchema = z.object({
  machineId: nonBlankString.optional().describe("Stable generated machine id. Created automatically when omitted."),
  machineName: nonBlankString.optional().describe("Human-readable computer name. Defaults to the OS hostname when omitted."),
  host: nonBlankString.optional().describe("Local bind host. The default is 127.0.0.1."),
  port: z.number().int().min(1).max(65_535).optional().describe("Local HTTP server port. The default is 3939."),
  publicBaseUrl: z.string().url().optional().describe("Public HTTPS origin or base URL used by public URL tunnels."),
  publicMcpOnly: z.boolean().optional().describe("When true, public-host requests expose only /mcp."),
  ownerToken: nonBlankString.optional().describe("Bearer token for HTTP MCP/API access. Keep this secret."),
  workspaces: z.array(workspaceSchema).min(1).describe(
    "Configured folder-backed scopes. Product docs call these scopes; workspaces[] remains the durable 0.x config field.",
  ),
}).strict().describe("Computer Linker config.json.");

export const CONFIG_SCHEMA_EXAMPLES = [
  {
    machineName: "office",
    workspaces: [
      {
        id: "app",
        name: "App",
        path: "C:\\Projects\\my-app",
        permissions: { read: true, write: false, shell: false, codex: false, screen: false },
      },
    ],
  },
  {
    machineName: "office",
    ownerToken: "replace-with-generated-token",
    publicMcpOnly: true,
    publicBaseUrl: "https://mcp.example.com",
    workspaces: [
      {
        id: "app",
        name: "App",
        path: "C:\\Projects\\my-app",
        permissions: { read: true, write: true, shell: true, codex: false, screen: false },
        policy: {
          allowedCommands: ["npm *", "pnpm *", "yarn *", "bun *", "node *", "npx *", "git *"],
          deniedCommands: ["rm -rf *", "del /s *", "rmdir /s *", "format *", "shutdown *"],
          maxRuntimeSeconds: 600,
          maxOutputBytes: 200000,
          allowShellMetacharacters: false,
        },
      },
    ],
  },
  {
    machineName: "office",
    workspaces: [
      {
        id: "codex-app",
        name: "Codex App",
        path: "C:\\Projects\\my-app",
        permissions: { read: true, write: true, shell: true, codex: true, screen: true },
        policy: {
          allowedCommands: ["npm *", "node *", "git *", "codex *"],
          deniedCommands: ["npm publish *", "git push *"],
          maxRuntimeSeconds: 1800,
          maxOutputBytes: 500000,
          allowSensitivePathMetadata: false,
          allowSensitivePathWrites: false,
        },
      },
    ],
  },
] as const;

export function configJsonSchema(): JsonObject {
  const generated = z.toJSONSchema(configFileSchema, { target: "draft-2020-12" }) as JsonObject;
  const { $schema, description: _description, ...rest } = generated;
  return {
    $schema,
    $id: CONFIG_SCHEMA_ID,
    title: "Computer Linker config.json",
    description: "Durable Computer Linker configuration. Normal setup commands write this file automatically; the schema is for manual editing, service deployments, and diagnostics.",
    ...rest,
    examples: CONFIG_SCHEMA_EXAMPLES,
  };
}

export function validateConfigShape(value: unknown, schemaPath = "docs/config.schema.json"): ConfigSchemaValidation {
  const result = configFileSchema.safeParse(value);
  if (result.success) {
    return {
      valid: true,
      schemaId: CONFIG_SCHEMA_ID,
      schemaPath,
      issues: [],
    };
  }

  return {
    valid: false,
    schemaId: CONFIG_SCHEMA_ID,
    schemaPath,
    issues: result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      code: issue.code,
      message: issue.message,
    })),
  };
}

export function validateConfigJsonText(text: string, schemaPath = "docs/config.schema.json"): ConfigSchemaValidation {
  try {
    return validateConfigShape(JSON.parse(text), schemaPath);
  } catch (error) {
    return {
      valid: false,
      schemaId: CONFIG_SCHEMA_ID,
      schemaPath,
      issues: [
        {
          path: "$",
          code: "invalid_json",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function validateConfigFileAt(path: string, schemaPath = "docs/config.schema.json"): ConfigSchemaValidation {
  try {
    return validateConfigJsonText(readFileSync(path, "utf8"), schemaPath);
  } catch (error) {
    return {
      valid: false,
      schemaId: CONFIG_SCHEMA_ID,
      schemaPath,
      issues: [
        {
          path: "$",
          code: "file_read_error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "$";
  let current = "$";
  for (const part of path) {
    current += typeof part === "number" ? `[${part}]` : `.${String(part)}`;
  }
  return current;
}
