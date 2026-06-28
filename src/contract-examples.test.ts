import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "./config.js";
import { normalizeComputerOperationInput, runComputerOperation } from "./computer-contract.js";
import {
  computerOperationRegistry,
  publicComputerOperationRegistry,
  type ComputerOperationEnvelope,
} from "./computer-operation-registry.js";
import { workspaceOperationEntry } from "./workspace-operations.js";

const registryByOp = new Map(computerOperationRegistry.map((entry) => [entry.op, entry]));
const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
const computerOperationSchema = JSON.parse(await readFile(join(process.cwd(), "docs", "computer-operation-v1.schema.json"), "utf8")) as JsonSchemaObject;
const readmeExamples = readmeCommonOperationExamples(readme);

assert.ok(readmeExamples.length >= 6);
for (const example of readmeExamples) {
  validateComputerOperationExample(example.envelope, example.source);
}

for (const op of ["screen.capture", "screen.capture_window", "screen.capture_process"]) {
  const entry = registryByOp.get(op);
  assert.ok(entry, `${op} must exist in computerOperationRegistry`);
  assertRemoteSafeScreenshotExample(entry.example, op);
}

for (const op of ["screen_capture", "screen_capture_window", "screen_capture_process"] as const) {
  assertRemoteSafeScreenshotExample(workspaceOperationEntry(op).example, op);
}

for (const entry of publicComputerOperationRegistry()) {
  validateComputerOperationExample(entry.example, `computerOperationRegistry ${entry.op} example`);
  assert.doesNotThrow(
    () => normalizeComputerOperationInput(entry.example),
    `computerOperationRegistry ${entry.op} example should normalize to ${entry.backendOperation}`,
  );
}

for (const op of ["file.read", "file.search", "command.run", "codex.run", "screen.list", "history.last"]) {
  const entry = registryByOp.get(op);
  assert.ok(entry, `${op} must exist in computerOperationRegistry`);
  validateComputerOperationExample(entry.example, `representative ${op} example`);
  assert.doesNotThrow(() => normalizeComputerOperationInput(entry.example), `representative ${op} example should normalize`);
}

await assertRuntimeComputerOperationContract();

type JsonSchema = boolean | JsonSchemaObject;

interface JsonSchemaObject {
  [key: string]: unknown;
  $ref?: string;
  oneOf?: JsonSchema[];
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  format?: string;
  items?: JsonSchema;
}

async function assertRuntimeComputerOperationContract(): Promise<void> {
  const originalConfigDir = process.env.LOCALPORT_CONFIG_DIR;
  const originalComputerLinkerConfigDir = process.env.COMPUTER_LINKER_CONFIG_DIR;
  const root = await mkdtemp(join(tmpdir(), "computer-operation-contract-test-"));
  const configRoot = join(root, "config");
  const workspaceRoot = join(root, "workspace");
  try {
    process.env.LOCALPORT_CONFIG_DIR = configRoot;
    delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "hello.txt"), "hello contract\n", "utf8");
    writeConfig({
      machineName: "contract-schema-test",
      host: "127.0.0.1",
      port: 3988,
      ownerToken: "contract-token",
      workspaces: [
        {
          id: "app",
          name: "Contract schema app",
          path: workspaceRoot,
          permissions: { read: true, write: false, shell: false, codex: false },
        },
      ],
    });

    const successRequest = { scope: "app", op: "file.read", target: "hello.txt", options: { maxBytes: 5 } };
    const success = await runComputerOperation(successRequest);
    assert.equal(success.ok, true);
    assertSchemaAccepts({ request: successRequest, result: success }, "runtime success envelope");

    const failureRequest = { scope: "app", op: "file.nope", target: "hello.txt" };
    const failure = await runComputerOperation(failureRequest);
    assert.equal(failure.ok, false);
    assert.equal(failure.error?.code, "unknown_operation");
    assertSchemaAccepts({ request: failureRequest, result: failure }, "runtime failure envelope");
  } finally {
    if (originalConfigDir === undefined) delete process.env.LOCALPORT_CONFIG_DIR;
    else process.env.LOCALPORT_CONFIG_DIR = originalConfigDir;
    if (originalComputerLinkerConfigDir === undefined) delete process.env.COMPUTER_LINKER_CONFIG_DIR;
    else process.env.COMPUTER_LINKER_CONFIG_DIR = originalComputerLinkerConfigDir;
    await rm(root, { recursive: true, force: true });
  }
}

function assertSchemaAccepts(value: unknown, source: string): void {
  assert.deepEqual(validateJsonSchema(computerOperationSchema, value, computerOperationSchema), [], `${source} should match docs/computer-operation-v1.schema.json`);
}

function validateJsonSchema(schema: JsonSchema, value: unknown, root: JsonSchemaObject, path = "$"): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${path} is not allowed`];
  if (schema.$ref) {
    return validateJsonSchema(resolveSchemaRef(root, schema.$ref), value, root, path);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => validateJsonSchema(candidate, value, root, path).length === 0);
    return matches.length === 1 ? [] : [`${path} should match exactly one oneOf schema, matched ${matches.length}`];
  }
  const errors: string[] = [];
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} should equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} should be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  if (schema.type) {
    errors.push(...validateJsonSchemaType(schema.type, value, path));
  }
  if (schema.type === "object" && isRecord(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${path}.${required} is required`);
    }
    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (!propertySchema) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
        continue;
      }
      errors.push(...validateJsonSchema(propertySchema, propertyValue, root, `${path}.${key}`));
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(schema.items as JsonSchema, item, root, `${path}[${index}]`));
    });
  }
  if (typeof value === "string" && schema.pattern && !(new RegExp(schema.pattern).test(value))) {
    errors.push(`${path} should match ${schema.pattern}`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path} should be >= ${schema.minimum}`);
  }
  if (schema.format === "date-time" && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
    errors.push(`${path} should be date-time`);
  }
  return errors;
}

function validateJsonSchemaType(type: string, value: unknown, path: string): string[] {
  if (type === "object") return isRecord(value) ? [] : [`${path} should be object`];
  if (type === "array") return Array.isArray(value) ? [] : [`${path} should be array`];
  if (type === "string") return typeof value === "string" ? [] : [`${path} should be string`];
  if (type === "boolean") return typeof value === "boolean" ? [] : [`${path} should be boolean`];
  if (type === "integer") return Number.isInteger(value) ? [] : [`${path} should be integer`];
  return [];
}

function resolveSchemaRef(root: JsonSchemaObject, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported JSON schema ref: ${ref}`);
  const value = ref.slice(2).split("/").reduce<unknown>((current, rawPart) => {
    if (!isRecord(current)) throw new Error(`Invalid JSON schema ref: ${ref}`);
    return current[rawPart.replace(/~1/g, "/").replace(/~0/g, "~")];
  }, root);
  if (value === undefined) throw new Error(`Unknown JSON schema ref: ${ref}`);
  return value as JsonSchema;
}

function readmeCommonOperationExamples(markdown: string): Array<{ source: string; envelope: ComputerOperationEnvelope }> {
  const section = markdownSection(markdown, "### Common Operations", "### Operation Shape");
  const examples: Array<{ source: string; envelope: ComputerOperationEnvelope }> = [];

  for (const match of section.matchAll(/`(\{[^`\r\n]*"op"[^`\r\n]*\})`/g)) {
    examples.push({
      source: "README Common Operations inline example",
      envelope: parseJsonObject(match[1], "README Common Operations inline example"),
    });
  }

  for (const match of section.matchAll(/```json\s*([\s\S]*?)```/g)) {
    examples.push({
      source: "README Common Operations JSON block",
      envelope: parseJsonObject(match[1], "README Common Operations JSON block"),
    });
  }

  return examples;
}

function markdownSection(markdown: string, startHeading: string, endHeading: string): string {
  const start = markdown.indexOf(startHeading);
  assert.notEqual(start, -1, `${startHeading} must exist`);
  const end = markdown.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(end, -1, `${endHeading} must exist after ${startHeading}`);
  return markdown.slice(start, end);
}

function parseJsonObject(text: string, source: string): ComputerOperationEnvelope {
  const parsed: unknown = JSON.parse(text.trim());
  assert.ok(isRecord(parsed), `${source} must be a JSON object`);
  return parsed as ComputerOperationEnvelope;
}

function validateComputerOperationExample(envelope: ComputerOperationEnvelope, source: string): void {
  assert.equal(typeof envelope.scope, "string", `${source} must include scope`);
  const op = envelope.op;
  if (typeof op !== "string") {
    assert.fail(`${source} must include op`);
  }
  const entry = registryByOp.get(op);
  assert.ok(entry, `${source} uses unknown op ${op}`);

  const input = optionalRecord(envelope.input, `${source} input`);
  const options = optionalRecord(envelope.options, `${source} options`);
  const acceptedInput = new Set([...entry.requiredInput, ...entry.optionalInput]);

  for (const requiredInput of entry.requiredInput) {
    assert.ok(requiredInput in input, `${source} ${entry.op} must include input.${requiredInput}`);
  }
  for (const key of Object.keys(input)) {
    assert.ok(acceptedInput.has(key), `${source} ${entry.op} does not accept input.${key}`);
  }
  for (const key of Object.keys(options)) {
    assert.ok(entry.options.includes(key), `${source} ${entry.op} does not accept options.${key}`);
  }
}

function assertRemoteSafeScreenshotExample(example: ComputerOperationEnvelope | { returnMode?: string }, source: string): void {
  const options = "options" in example
    ? optionalRecord(example.options, `${source} options`)
    : optionalRecord(example, `${source} example`);
  assert.equal(options.returnMode, "base64", `${source} example should be usable by remote MCP clients`);
  assert.equal(options.format, "png", `${source} example should request png output`);
  assert.equal(typeof options.maxWidth, "number", `${source} example should bound image width`);
  assert.equal(typeof options.maxHeight, "number", `${source} example should bound image height`);
}

function optionalRecord(value: unknown, source: string): Record<string, unknown> {
  if (value === undefined) return {};
  assert.ok(isRecord(value), `${source} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
