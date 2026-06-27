#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const skipNpmAudit = args.has("--skip-npm-audit");
const strictHistory = args.has("--strict-history");

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function runGit(gitArgs, options = {}) {
  try {
    return execFileSync("git", gitArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    if (options.allowFailure) return error.stdout?.toString() ?? "";
    fail(`git ${gitArgs.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
    return "";
  }
}

function runNpm(npmArgs) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...npmArgs] : npmArgs;
  return execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runNpmChecked(npmArgs, label) {
  try {
    return runNpm(npmArgs);
  } catch (error) {
    fail(`${label} failed: ${error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message}`);
    return "";
  }
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parsePackJson(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    fail("npm pack --dry-run --json did not return package metadata");
    return null;
  }

  try {
    return JSON.parse(output.slice(start, end + 1))[0] ?? null;
  } catch (error) {
    fail(`npm pack --dry-run --json output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function collectGitFiles() {
  const output = runGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return output.split("\0").filter(Boolean).map(normalizePath);
}

function collectPackedFiles() {
  const output = runNpmChecked(["pack", "--dry-run", "--json"], "npm pack audit");
  const pack = parsePackJson(output);
  if (!pack) return [];
  return pack.files.map((file) => normalizePath(file.path));
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function compactMatch(value) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

const scanPatterns = [
  { id: "openai-key", regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { id: "github-token", regex: /ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}/g },
  { id: "slack-token", regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  { id: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/g },
  { id: "google-api-key", regex: /AIza[0-9A-Za-z_-]{35}/g },
  { id: "private-key", regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g },
  { id: "bearer-token", regex: /Bearer\s+(?!<)[A-Za-z0-9._~+/=-]{24,}/g },
  { id: "openai-tunnel-id", regex: /tunnel_[A-Za-z0-9_-]{20,}/g },
  {
    id: "quoted-secret-env-assignment",
    regex: /(?:OPENAI_API_KEY|CONTROL_PLANE_API_KEY|WORKSPACE_LINKER_OWNER_TOKEN|LOCALPORT_OWNER_TOKEN)\s*=\s*["'](?!<|sk-\.\.\.|token\b|test\b|smoke\b)[A-Za-z0-9._~+/=-]{16,}["']/g,
  },
  {
    id: "env-file-secret-assignment",
    regex: /(?:^|\n)(?:OPENAI_API_KEY|CONTROL_PLANE_API_KEY|WORKSPACE_LINKER_OWNER_TOKEN|LOCALPORT_OWNER_TOKEN)\s*=\s*(?!<|sk-\.\.\.|token\b|test\b|smoke\b)[A-Za-z0-9._~+/=-]{16,}/g,
  },
  { id: "url-embedded-credential", regex: /https?:\/\/[^/\s:@]+:[^/\s:@]+@[^/\s]+/g },
  { id: "private-windows-path", regex: /[A-Z]:\\(?:Users|code|workspaces)\\[^\s"'`<>]+/gi },
  { id: "real-tailscale-hostname", regex: /(?:https:\/\/)?[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/gi },
];

function allowedMatch(patternId, value) {
  if (patternId === "private-windows-path") {
    return value === "C:\\Projects\\my-app" || value.startsWith("C:\\Windows\\System32");
  }
  if (patternId === "real-tailscale-hostname") {
    return value.toLowerCase().endsWith(".example.ts.net");
  }
  return false;
}

function scanFile(path, source) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return;

  const buffer = readFileSync(path);
  if (buffer.includes(0)) return;

  const text = buffer.toString("utf8");
  for (const pattern of scanPatterns) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      if (allowedMatch(pattern.id, value)) continue;
      fail(`${source}:${path}:${lineNumberAt(text, match.index ?? 0)} matched ${pattern.id}: ${compactMatch(value)}`);
    }
  }
}

function checkPackedFiles(packedFiles) {
  const packed = new Set(packedFiles);
  for (const path of ["package.json", "README.md", "LICENSE", "SECURITY.md", "dist/cli.js", "dist/client.js"]) {
    assert(packed.has(path), `packed package is missing ${path}; run npm run product:check before public release`);
  }

  for (const path of packedFiles) {
    const parts = path.split("/");
    assert(!parts.includes(".env"), `packed package contains environment file: ${path}`);
    assert(!path.startsWith(".workspace-linker/"), `packed package contains local Workspace Linker state: ${path}`);
    assert(!path.startsWith(".localport/"), `packed package contains legacy local state: ${path}`);
    assert(!path.endsWith(".tgz"), `packed package contains package artifact: ${path}`);
  }
}

function checkLocalEvidenceFiles(gitFiles, packedFiles) {
  const localEvidencePath = ".workspace-linker-alpha-evidence.json";
  if (gitFiles.includes(localEvidencePath)) {
    fail(`${localEvidencePath} is local dogfooding evidence and must not be tracked; keep it gitignored and publish docs/alpha-evidence.example.json as the schema example`);
  }
  if (packedFiles.includes(localEvidencePath)) {
    fail(`${localEvidencePath} must not be included in the npm package; publish docs/alpha-evidence.example.json as the schema example`);
  }
}

function checkLicenses(packageJson, lockJson) {
  assert(packageJson.license === "MIT", "package.json license must stay MIT before public release");
  const licenseText = existsSync("LICENSE") ? readFileSync("LICENSE", "utf8") : "";
  assert(licenseText.includes("MIT License"), "LICENSE must contain the MIT License text");

  const allowedLicenses = new Set([
    "MIT",
    "ISC",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
    "0BSD",
  ]);

  const packages = Object.entries(lockJson.packages ?? {}).filter(([path]) => path);
  let checked = 0;
  for (const [path, metadata] of packages) {
    const license = metadata.license;
    if (!license) {
      fail(`dependency is missing license metadata: ${path}`);
      continue;
    }

    checked += 1;
    const tokens = String(license).match(/[A-Za-z0-9-.+]+/g)?.filter((token) => !["AND", "OR", "WITH"].includes(token)) ?? [];
    const disallowed = tokens.filter((token) => !allowedLicenses.has(token));
    if (disallowed.length > 0) {
      fail(`dependency uses unreviewed license ${license}: ${path}`);
    }
  }

  return checked;
}

function checkHistoryForSecrets() {
  const highRiskHistoryRegex = [
    "sk-[A-Za-z0-9_-]{20,}",
    "ghp_[A-Za-z0-9_]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "AKIA[0-9A-Z]{16}",
    "-----BEGIN .*PRIVATE KEY-----",
    "Bearer [A-Za-z0-9._~+/=-]{24,}",
    "tunnel_[A-Za-z0-9_-]{20,}",
  ].join("|");
  const highRiskHits = runGit([
    "log",
    "-G",
    highRiskHistoryRegex,
    "--all",
    "--oneline",
    "--",
    ".",
    ":(exclude)scripts/alpha-evidence.mjs",
    ":(exclude)scripts/public-release-audit.mjs",
    ":(exclude)scripts/create-public-snapshot.mjs",
  ], { allowFailure: true }).trim();
  if (highRiskHits) {
    fail(`Git history contains high-risk secret-shaped changes:\n${highRiskHits}`);
  }

  if (!strictHistory) {
    warn("Git history local-fingerprint scan is skipped by default; run npm run public:audit -- --strict-history before publishing preserved history.");
    return;
  }

  const historyFingerprintRegex = "[A-Z]:\\\\(Users|code|workspaces)\\\\|[a-z0-9-]+\\.[a-z0-9-]+\\.ts\\.net";
  const revisions = runGit(["rev-list", "--all"]).trim().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const revision of revisions) {
    const output = runGit(["grep", "-n", "-I", "-E", historyFingerprintRegex, revision, "--", "."], { allowFailure: true });
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      if (line.includes("C:\\Projects\\my-app")) continue;
      if (line.includes("C:\\Windows\\System32")) continue;
      if (line.includes("example.ts.net")) continue;
      hits.push(line);
      if (hits.length >= 20) break;
    }
    if (hits.length >= 20) break;
  }

  if (hits.length > 0) {
    fail([
      "Git history contains local fingerprints.",
      "Do not change this existing repository to public visibility with preserved history.",
      "Publish a fresh single-commit public mirror instead:",
      "  npm run public:mirror -- --remote <github-owner>/<public-repo>",
      "",
      "First hits:",
      hits.join("\n"),
    ].join("\n"));
  }
}

const packageJson = readJson("package.json");
const lockJson = readJson("package-lock.json");
const gitFiles = collectGitFiles();
const packedFiles = collectPackedFiles();
const filesToScan = [...new Set([...gitFiles, ...packedFiles])].sort();

checkPackedFiles(packedFiles);
checkLocalEvidenceFiles(gitFiles, packedFiles);
const dependencyLicenseCount = checkLicenses(packageJson, lockJson);
for (const path of filesToScan) scanFile(path, gitFiles.includes(path) ? "tracked" : "packed");
checkHistoryForSecrets();

if (!skipNpmAudit) {
  runNpmChecked(["audit", "--omit=dev"], "production dependency audit");
} else {
  warn("production dependency audit skipped by --skip-npm-audit");
}

if (warnings.length > 0) {
  for (const message of warnings) console.warn(`public audit warning: ${message}`);
}

if (failures.length > 0) {
  for (const message of failures) console.error(`public audit failed: ${message}`);
  process.exit(1);
}

console.log(
  `public audit ok: scanned ${filesToScan.length} files, checked ${dependencyLicenseCount} dependency licenses`,
);
