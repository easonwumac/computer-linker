import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  computerOperationRegistry,
  type ComputerOperationEnvelope,
} from "./computer-operation-registry.js";
import { workspaceOperationEntry } from "./workspace-operations.js";

const registryByOp = new Map(computerOperationRegistry.map((entry) => [entry.op, entry]));
const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
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
