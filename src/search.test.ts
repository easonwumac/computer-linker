import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFiles, searchSymbols, searchText } from "./search.js";

const root = await mkdtemp(join(tmpdir(), "localport-search-test-"));

function assertNoEnvSecretResult(output: string): void {
  assert.equal(
    output.split(/\r?\n/).some((line) => /^\.env(?::|-|$)/.test(line) || /\/\.env(?::|-|$)/.test(line)),
    false,
  );
}

try {
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, "empty-bin"), { recursive: true });
  await writeFile(join(root, "src", "alpha.ts"), "export const Alpha = 'needle';\n");
  await writeFile(join(root, "src", "symbols.ts"), [
    "import {",
    "  type ImportedThing,",
    "} from './types';",
    "export type LocalThing = { id: string };",
    "export interface SymbolTarget { id: string }",
    "export class SymbolRunner {}",
    "export function openSymbolTarget(id: string): SymbolTarget {",
    "  return { id };",
    "}",
    "async () => openSymbolTarget('callback');",
    "",
  ].join("\n"));
  await writeFile(join(root, "src", "beta.md"), "Needle in docs\n");
  await writeFile(join(root, "src", "context.ts"), "before\nneedle\nAfter\n");
  await writeFile(join(root, "src", "nested", "gamma.ts"), "export const Gamma = 'fallback-needle';\n");
  await writeFile(join(root, "src", "nested", "gamma.js"), "export const gammaJs = 'fallback-needle';\n");
  await writeFile(join(root, ".env"), "SEARCH_SECRET=needle\n");
  await writeFile(join(root, ".env.example"), "EXAMPLE=needle\n");
  await writeFile(join(root, "src", "private.pem"), "needle\n");

  const files = await findFiles({
    cwd: root,
    pattern: "*.ts",
    maxResults: 20,
  });
  assert.match(files, /src\/alpha\.ts|alpha\.ts/);
  assert.doesNotMatch(files, /beta\.md/);

  const sensitiveFiles = await findFiles({
    cwd: root,
    pattern: "*",
    maxResults: 50,
  });
  assertNoEnvSecretResult(sensitiveFiles);
  assert.doesNotMatch(sensitiveFiles, /private\.pem/);

  const text = await searchText({
    cwd: root,
    query: "needle",
    fixedStrings: true,
    caseSensitive: false,
    maxResults: 20,
  });
  assert.match(text, /alpha\.ts/);
  assert.match(text, /beta\.md/);
  assertNoEnvSecretResult(text);
  assert.doesNotMatch(text, /private\.pem/);

  const limited = await searchText({
    cwd: root,
    query: "needle",
    fixedStrings: true,
    caseSensitive: false,
    maxResults: 1,
  });
  assert.equal(limited.trim().split("\n").length, 1);

  const context = await searchText({
    cwd: root,
    query: "needle",
    glob: "context.ts",
    fixedStrings: true,
    caseSensitive: false,
    beforeContext: 1,
    afterContext: 1,
    maxResults: 20,
  });
  assert.match(context, /context\.ts[-:]1[-:]before/);
  assert.match(context, /context\.ts:2:needle/);
  assert.match(context, /context\.ts[-:]3[-:]After/);

  const symbols = await searchSymbols({
    cwd: root,
    query: undefined,
    glob: "*.ts",
    caseSensitive: true,
    maxResults: 20,
    maxBytes: 64 * 1024,
  });
  assert.ok(symbols.some((symbol) => symbol.name === "SymbolRunner" && symbol.kind === "class"));
  assert.ok(symbols.some((symbol) => symbol.name === "SymbolTarget" && symbol.kind === "interface"));
  assert.ok(symbols.some((symbol) => symbol.name === "openSymbolTarget" && symbol.kind === "function"));
  assert.ok(symbols.some((symbol) => symbol.name === "LocalThing" && symbol.kind === "type"));
  assert.equal(symbols.some((symbol) => symbol.name === "ImportedThing"), false);
  assert.equal(symbols.some((symbol) => symbol.name === "async"), false);

  const originalPath = process.env.PATH;
  process.env.PATH = join(root, "empty-bin");
  try {
    const fallbackAllTs = await findFiles({
      cwd: root,
      pattern: "*.ts",
      maxResults: 20,
    });
    assert.match(fallbackAllTs, /src\/alpha\.ts/);
    assert.match(fallbackAllTs, /src\/nested\/gamma\.ts/);
    assert.doesNotMatch(fallbackAllTs, /gamma\.js/);

    const fallbackDirectTs = await findFiles({
      cwd: root,
      pattern: "src/*.ts",
      maxResults: 20,
    });
    assert.match(fallbackDirectTs, /src\/alpha\.ts/);
    assert.doesNotMatch(fallbackDirectTs, /src\/nested\/gamma\.ts/);

    const fallbackNestedTs = await findFiles({
      cwd: root,
      pattern: "src/**/*.ts",
      maxResults: 20,
    });
    assert.match(fallbackNestedTs, /src\/alpha\.ts/);
    assert.match(fallbackNestedTs, /src\/nested\/gamma\.ts/);

    const fallbackBrace = await findFiles({
      cwd: root,
      pattern: "src/**/*.{ts,js}",
      maxResults: 20,
    });
    assert.match(fallbackBrace, /src\/nested\/gamma\.ts/);
    assert.match(fallbackBrace, /src\/nested\/gamma\.js/);

    const fallbackSearch = await searchText({
      cwd: root,
      query: "fallback-needle",
      glob: "src/**/*.ts",
      fixedStrings: true,
      caseSensitive: true,
      maxResults: 20,
    });
    assert.match(fallbackSearch, /src\/nested\/gamma\.ts/);
    assert.doesNotMatch(fallbackSearch, /gamma\.js/);
    assertNoEnvSecretResult(fallbackSearch);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
