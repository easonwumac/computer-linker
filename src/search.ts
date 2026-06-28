import { execFile } from "node:child_process";
import { opendir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { isSensitiveWorkspacePath, sensitiveFileRgGlobArgs } from "./sensitive-files.js";

const execFileAsync = promisify(execFile);

export interface SearchTextOptions {
  cwd: string;
  query: string;
  glob?: string;
  fixedStrings: boolean;
  caseSensitive: boolean;
  maxResults: number;
  beforeContext?: number;
  afterContext?: number;
}

export interface FindFilesOptions {
  cwd: string;
  pattern: string;
  maxResults: number;
}

export interface SearchSymbolsOptions {
  cwd: string;
  query?: string;
  glob?: string;
  caseSensitive: boolean;
  maxResults: number;
  maxBytes: number;
}

export interface SymbolMatch {
  path: string;
  line: number;
  column: number;
  name: string;
  kind: string;
  signature: string;
}

export async function searchText(options: SearchTextOptions): Promise<string> {
  const args = [
    "--line-number",
    "--color",
    "never",
    "--path-separator",
    "/",
    "--hidden",
    "--glob",
    "!{.git,node_modules,dist,build,.next,.cache}/**",
  ];
  if (options.fixedStrings) args.push("--fixed-strings");
  if (!options.caseSensitive) args.push("--ignore-case");
  if (options.beforeContext && options.beforeContext > 0) args.push("--before-context", String(options.beforeContext));
  if (options.afterContext && options.afterContext > 0) args.push("--after-context", String(options.afterContext));
  if (options.glob) args.push("--glob", options.glob);
  args.push(...sensitiveFileRgGlobArgs());
  args.push(options.query, ".");

  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10,
    });
    return normalizeRipgrepMatchPaths(limitLines(stdout, options.maxResults)) || "No matches.";
  } catch (error) {
    if (isExecError(error) && error.code === 1) return "No matches.";
    if (isExecError(error) && error.code === "ENOENT") {
      return fallbackSearchText(options);
    }
    throw error;
  }
}

export async function searchSymbols(options: SearchSymbolsOptions): Promise<SymbolMatch[]> {
  const files = await candidateSymbolFiles(options);
  const matches: SymbolMatch[] = [];
  const query = options.query
    ? options.caseSensitive ? options.query : options.query.toLowerCase()
    : undefined;

  for (const file of files) {
    if (matches.length >= options.maxResults) break;
    let content: string;
    try {
      content = await readFile(join(options.cwd, file), "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    if (Buffer.byteLength(content, "utf8") > options.maxBytes) {
      content = content.slice(0, options.maxBytes);
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      for (const symbol of symbolsFromLine(lines[index])) {
        const haystack = options.caseSensitive
          ? `${symbol.name}\n${symbol.signature}`
          : `${symbol.name}\n${symbol.signature}`.toLowerCase();
        if (query && !haystack.includes(query)) continue;
        matches.push({
          path: file,
          line: index + 1,
          column: symbol.column,
          name: symbol.name,
          kind: symbol.kind,
          signature: symbol.signature,
        });
        if (matches.length >= options.maxResults) return matches;
      }
    }
  }

  return matches;
}

export async function findFiles(options: FindFilesOptions): Promise<string> {
  try {
    const { stdout } = await execFileAsync("rg", [
      "--files",
      "--path-separator",
      "/",
      "--hidden",
      "--glob",
      "!{.git,node_modules,dist,build,.next,.cache}/**",
      "--glob",
      options.pattern,
      ...sensitiveFileRgGlobArgs(),
    ], {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10,
    });
    return normalizePathLines(limitLines(stdout, options.maxResults)) || "No files found.";
  } catch (error) {
    if (isExecError(error) && error.code === 1) return "No files found.";
    if (isExecError(error) && error.code === "ENOENT") {
      const files = await fallbackFindFiles(options.cwd, options.pattern, options.maxResults);
      return files.join("\n") || "No files found.";
    }
    throw error;
  }
}

async function candidateSymbolFiles(options: SearchSymbolsOptions): Promise<string[]> {
  const args = [
    "--files",
    "--path-separator",
    "/",
    "--hidden",
    "--glob",
    "!{.git,node_modules,dist,build,.next,.cache}/**",
  ];
  for (const glob of SYMBOL_FILE_GLOBS) args.push("--glob", glob);
  if (options.glob) args.push("--glob", options.glob);
  args.push(...sensitiveFileRgGlobArgs());

  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10,
    });
    return stdout.trimEnd().split("\n").filter(Boolean).map(toPortablePath);
  } catch (error) {
    if (isExecError(error) && error.code === 1) return [];
    if (isExecError(error) && error.code === "ENOENT") {
      const files = await fallbackFindFiles(options.cwd, options.glob ?? "**/*", options.maxResults * 20);
      return files.filter((file) => SYMBOL_EXTENSIONS.has(fileExtension(file)));
    }
    throw error;
  }
}

function symbolsFromLine(line: string): Array<{ name: string; kind: string; signature: string; column: number }> {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) return [];
  const symbols = [];

  for (const rule of SYMBOL_RULES) {
    const match = rule.pattern.exec(line);
    if (!match?.groups?.name) continue;
    if (SYMBOL_KEYWORDS.has(match.groups.name)) continue;
    symbols.push({
      name: match.groups.name,
      kind: rule.kind,
      signature: trimmed,
      column: line.indexOf(match.groups.name) + 1,
    });
  }

  return symbols;
}

async function fallbackSearchText(options: SearchTextOptions): Promise<string> {
  const files = await fallbackFindFiles(options.cwd, options.glob ?? "**/*", options.maxResults * 10);
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  const matches: string[] = [];

  for (const file of files) {
    let content;
    try {
      content = await readFile(join(options.cwd, file), "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const haystack = options.caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (haystack.includes(needle)) {
        for (let contextIndex = Math.max(0, index - (options.beforeContext ?? 0)); contextIndex <= Math.min(lines.length - 1, index + (options.afterContext ?? 0)); contextIndex++) {
          const separator = contextIndex === index ? ":" : "-";
          matches.push(`${file}${separator}${contextIndex + 1}${separator}${lines[contextIndex]}`);
        }
        if (matches.length >= options.maxResults) return matches.join("\n");
      }
    }
  }

  return matches.join("\n") || "No matches.";
}

function fileExtension(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

async function fallbackFindFiles(root: string, pattern: string, maxResults: number): Promise<string[]> {
  const results: string[] = [];
  const matchesGlob = fallbackGlobMatcher(pattern);

  async function walk(directory: string): Promise<void> {
    if (results.length >= maxResults) return;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      return;
    }

    for await (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const relativePath = toPortablePath(relative(root, path));
      if (isSensitiveWorkspacePath(relativePath)) continue;
      if (matchesGlob(relativePath)) {
        results.push(relativePath);
        if (results.length >= maxResults) return;
      }
    }
  }

  await walk(root);
  return results;
}

function fallbackGlobMatcher(pattern: string): (path: string) => boolean {
  const normalizedPattern = toPortablePath(pattern || "**/*").replace(/^\.\//, "");
  const patterns = expandBracePatterns(normalizedPattern);
  const matchers = patterns.map((item) => {
    const subject = item.includes("/") ? "path" : "basename";
    const regex = globPatternRegex(item);
    return { subject, regex };
  });
  return (path) => {
    const normalizedPath = toPortablePath(path);
    const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
    return matchers.some((matcher) => matcher.regex.test(matcher.subject === "path" ? normalizedPath : basename));
  };
}

function expandBracePatterns(pattern: string, limit = 32): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index + match[0].length);
  const parts = match[1].split(",").filter((part) => part.length > 0);
  const expanded: string[] = [];
  for (const part of parts) {
    for (const value of expandBracePatterns(`${prefix}${part}${suffix}`, limit)) {
      expanded.push(value);
      if (expanded.length >= limit) return expanded;
    }
  }
  return expanded;
}

function globPatternRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (char === "*" && next === "*") {
      source += ".*";
      index += 2;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += escapeRegex(char);
    index += 1;
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function limitLines(text: string, maxLines: number): string {
  const lines = text.trimEnd().split("\n");
  return lines.slice(0, maxLines).join("\n");
}

function normalizePathLines(text: string): string {
  return text
    .split("\n")
    .map(toPortablePath)
    .join("\n");
}

function normalizeRipgrepMatchPaths(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line === "--") return line;
      const match = /^(.*?)([:-]\d+[:-].*)$/.exec(line);
      if (!match) return line;
      return `${toPortablePath(match[1])}${match[2]}`;
    })
    .join("\n");
}

function toPortablePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isExecError(error: unknown): error is Error & { code: number | string } {
  return error instanceof Error && "code" in error;
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
]);

const SYMBOL_FILE_GLOBS = [
  "*.{ts,tsx,js,jsx,mjs,cjs}",
  "*.{py,rb,go,rs,java,kt,kts,swift}",
  "*.{c,h,cc,cpp,cxx,hpp,cs,php}",
];

const SYMBOL_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".cs",
  ".php",
]);

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const SYMBOL_RULES: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "function", pattern: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+(?<name>${IDENTIFIER})\\s*\\(`) },
  { kind: "function", pattern: new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(?<name>${IDENTIFIER})\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${IDENTIFIER})\\s*=>`) },
  { kind: "class", pattern: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?class\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "interface", pattern: new RegExp(`^\\s*(?:export\\s+)?interface\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "type", pattern: new RegExp(`^\\s*(?:export\\s+)?type\\s+(?<name>${IDENTIFIER})\\b[^=]*=`) },
  { kind: "enum", pattern: new RegExp(`^\\s*(?:export\\s+)?enum\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "function", pattern: new RegExp(`^\\s*(?:async\\s+)?def\\s+(?<name>${IDENTIFIER})\\s*\\(`) },
  { kind: "class", pattern: new RegExp(`^\\s*class\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "function", pattern: new RegExp(`^\\s*def\\s+(?<name>[A-Za-z_]\\w*[!?=]?)\\b`) },
  { kind: "module", pattern: new RegExp(`^\\s*module\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "function", pattern: new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?(?<name>${IDENTIFIER})\\s*\\(`) },
  { kind: "type", pattern: new RegExp(`^\\s*type\\s+(?<name>${IDENTIFIER})\\s+(?:struct|interface)\\b`) },
  { kind: "function", pattern: new RegExp(`^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+(?<name>${IDENTIFIER})\\s*\\(`) },
  { kind: "class", pattern: new RegExp(`^\\s*(?:pub\\s+)?(?:struct|trait)\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "enum", pattern: new RegExp(`^\\s*(?:pub\\s+)?enum\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "class", pattern: new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|internal\\s+|final\\s+|open\\s+|data\\s+|sealed\\s+|abstract\\s+)*class\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "interface", pattern: new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|internal\\s+)*interface\\s+(?<name>${IDENTIFIER})\\b`) },
  { kind: "enum", pattern: new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|internal\\s+)*enum\\s+(?:class\\s+)?(?<name>${IDENTIFIER})\\b`) },
  { kind: "function", pattern: new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|internal\\s+|static\\s+|final\\s+|override\\s+|suspend\\s+)*fun\\s+(?<name>${IDENTIFIER})\\s*\\(`) },
  { kind: "function", pattern: new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+|override\\s+|async\\s+)*[^=;{}()]+\\s+(?<name>${IDENTIFIER})\\s*\\([^;]*\\)\\s*(?:\\{|=>)`) },
  { kind: "function", pattern: new RegExp(`^\\s*func\\s+(?<name>${IDENTIFIER})\\s*\\([^)]*\\)\\s*(?:async\\s+)?(?:throws\\s+)?(?:->\\s*[^{}]+\\s*)?\\{`) },
  { kind: "class", pattern: new RegExp(`^\\s*(?:public\\s+|private\\s+|final\\s+|open\\s+)?(?:struct|protocol|actor)\\s+(?<name>${IDENTIFIER})\\b`) },
];

const SYMBOL_KEYWORDS = new Set([
  "async",
  "await",
  "catch",
  "do",
  "else",
  "for",
  "if",
  "return",
  "switch",
  "try",
  "while",
]);
