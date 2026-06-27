# Release Checklist

Computer Linker's first productized target is an alpha release for trusted
local development machines. Do not treat alpha as an unattended public service.

## Alpha Gate

Run the same gate locally and in CI:

```bash
npm run release:validate
npm run product:check
```

This performs:

- Release metadata validation.
- TypeScript typecheck.
- Full test suite.
- Runtime build.
- Package smoke check with `npm pack --dry-run`, real `.tgz` creation,
  temporary consumer install, installed CLI execution, isolated installed
  `check`, `setup` / `status` config smoke, and installed SDK import.

Before publishing a public npm/package artifact, run:

```bash
npm run public:check
```

## Local npm Release Automation

Use the local wrapper when you are ready to publish from the current repository:

```bash
npm run release -- --otp <code>
```

`release:check` runs the local product and public package gates without
publishing. It does not require a clean worktree, so it is useful before the
final release commit.

`release:dry-run` requires the release commit to be clean and on main/master.
It runs `npm publish --dry-run`; if `v<package.version>` is missing, it creates
a temporary local tag for the dry-run and removes it afterward. If that tag
already exists on another commit, bump the package version before releasing.

`release:publish` performs the real npm publish. It requires a clean
main/master worktree, a dated `CHANGELOG.md` heading for the package version,
npm login, and a release tag on `HEAD`. Pass `--create-tag` to create the
release tag automatically before publishing, `--otp <code>` for npm 2FA, and
`--push` only when the script should push `HEAD` and the release tag to
`origin` after a successful publish. After npm accepts the publish, it also waits for exact
version metadata, verifies the configured npm dist-tag, and runs the published
CLI from a clean temporary directory. `release:verify` repeats only that
post-publish registry check for the current `package.json` version.
`release` is the productized one-command path for normal local publishing; it
uses the lower-level `release:publish` behavior with automatic tag creation and
push enabled. Use `npm run release:publish -- --create-tag --push --otp <code>`
only when debugging that lower-level publish wrapper directly.
On Windows, a `NODE_AUTH_TOKEN` saved in the User environment is loaded into
the release process automatically when the current shell has not inherited it.

For the one-command local alpha readiness gate, run:

```bash
npm run alpha:check
```

This runs `product:check`, `public:audit`, a preserved-history public repo
audit, and a public snapshot dry-run, then prints a readiness report. It is
intentionally local-only and does not trigger GitHub Actions or tunnel
providers. If the report is `needs_attention` only because
`preserved-history-audit` found private dogfooding fingerprints, do not change
the existing GitHub repository to public visibility; publish a fresh
`public:mirror` instead.

For that fresh public mirror release path, run:

```bash
npm run public:mirror -- --remote <github-owner>/<public-repo>
```

This accepts the preserved-history warning only for a detached snapshot release;
it does not mean the private repository can be made public with existing
history. `public:ready` and `alpha:snapshot-check` remain lower-level aliases
for checking readiness without writing the mirror.

Before announcing a public alpha, capture one external MCP client/tunnel pass as
machine-readable evidence:

```bash
npm run alpha:evidence -- preflight
npm run alpha:evidence -- smoke --redaction-confirmed
npm run alpha:check -- --require-evidence
```

The generated evidence file is gitignored and should remain local. It records
which client, exposure path, generic MCP tool flow, MCP-only public surface, and
history review were tested. It must not contain owner tokens, API keys, bearer
headers, screenshots, or private file contents. The check rejects placeholder
client names, placeholder tunnel targets, non-HTTPS public URLs, non-`/mcp` MCP
paths, and stale evidence. Use `alpha:evidence smoke` to create or refresh the
evidence file and mark the full external smoke pass without hand-editing JSON;
it auto-detects exposure, tunnel target, and scope from local preflight state
when possible. Pass explicit `--client`, `--exposure`, `--tunnel-or-url`, or
`--scope` only when auto-detection cannot infer the tested target. `smoke` can
refresh an existing Computer Linker alpha evidence file, but still requires
`--force` before replacing unrelated files. Use `alpha:evidence init`,
`record-smoke`, or `record` only when you want to split the steps or keep
separate notes per check. `smoke`, `init`, `record-smoke`, and `record` refuse
common secret-shaped values before writing the evidence file. Use
`alpha:evidence preflight` before recording evidence to inspect local
config, audit history, and tunnel runtime state for missing external smoke
signals and print a read-only prompt to paste into the external MCP client.
When a previous attempt already completed some calls, `nextExternalClientPrompt`
narrows the prompt to the missing operation. It is a preflight only; it does not
replace manual redaction and client-instruction confirmation. `recordCommand`
shows the short evidence command to run when the preflight no longer fails. Use
[alpha-evidence.example.json](alpha-evidence.example.json) for the schema.
The public release audit blocks `.computer-linker-alpha-evidence.json` if it
is ever tracked or packed; only the example schema belongs in the public repo.

Before publishing the detached public mirror, run the final local release
preflight:

```bash
npm run public:release-ready
```

This is the release-oriented alpha readiness gate. It requires fresh external
MCP evidence and a dated `CHANGELOG.md` heading for the current package version,
so it reports both final blockers in one place before `public:mirror`.

This adds the public-release audit: packed-file inspection, tracked and
non-ignored untracked file secret-shape scanning, production `npm audit`,
dependency license allowlist checks, npm access-token scanning, third-party provenance marker scanning, retired product-name marker scanning, and a high-risk Git history secret scan.

Before changing the current GitHub repository to public visibility while
preserving its Git history, run the stricter one-command gate:

```bash
npm run public:repo-ready
```

If strict history fails because private dogfooding commits contain local
fingerprints, do not rewrite `main` unless every collaborator agrees. Publish a
fresh public mirror instead:

```bash
npm run public:mirror -- --remote <github-owner>/<public-repo>
cd ../computer-linker-public
git push -u origin main --follow-tags
```

`public:mirror` runs the public readiness gate once, then calls the lower-level
`public:snapshot` path with the already-checked commit. `public:snapshot`
refuses a dirty worktree, copies the committed `HEAD` tree only, and creates a
new single-commit repository using your configured Git author identity. The
generated commit bypasses local Git hooks because the script performs its own
snapshot verification. It verifies that the generated repository has exactly
one clean commit, a `v<package.version>` tag pointing at that commit, and no
strict-history local fingerprints before printing push instructions. Use
`--remote <github-owner>/<public-repo>` for publishable mirrors; the shorthand is
normalized to `https://github.com/<github-owner>/<public-repo>.git`, and full
GitHub URLs also work. The remote is added during snapshot creation, and when
that remote is a GitHub repository, the snapshot's `package.json` repository,
issue, and homepage links are rewritten to the public repository. Public-facing
GitHub links in files such as issue-template config and schema ids are also
rewritten. Real publishable mirrors require the matching changelog heading to
be dated instead of `Unreleased`; remote dry-runs print whether the real run
would be blocked. The default output directory is `../computer-linker-public`; pass
`--output <path>` only when you need a different disposable mirror directory.
When the default directory already contains a clean one-commit snapshot created
by Computer Linker, `public:snapshot` replaces it automatically so the short
publish command is repeatable.
Without `--remote`, the output is a local verification snapshot and the package
metadata remains unchanged; do not push that verification-only mirror. Use
`--force` only when replacing a non-default disposable output directory or a
manually changed generated mirror. `--allow-dirty` is accepted only with `--dry-run`; committed `HEAD`
must be clean before creating a real public snapshot. Snapshot commits omit the
private source commit reference by default; use `--include-source-ref` only when
release traceability is more important than keeping the public mirror detached
from the private dogfooding history.

Use `npm run public:ready` and `npm run public:snapshot` directly only when
debugging a failed release gate.

`computer-linker doctor` and `/api/v1/control` with `action: "doctor"` also
return `releaseReadiness`. The release is blocked when that object has
`status: "blocked"` or non-empty `blockingReasons`.
`computer-linker config validate` exposes the same config, security, and
release-readiness subset for release scripts and exits non-zero when the status
is blocked.

## Required Before Tagging

- `npm run product:check` passes locally, and the automatic Windows/Node 22 CI
  gate passes for the target `main` push or pull request.
- `npm run alpha:check` passes locally before sharing an alpha build or public
  snapshot; a `preserved-history-audit` warning is acceptable only when the
  release will use `public:mirror` instead of preserving private repo history.
- `npm run public:mirror -- --dry-run --remote <github-owner>/<public-repo>`
  passes before publishing from a fresh public mirror.
- `npm run alpha:check -- --require-evidence` passes before announcing a public
  alpha outside private dogfooding.
- Broader OS or Node coverage is run manually before a wider release when the
  Actions budget allows it.
- `npm run public:check` passes before publishing a package artifact.
- `npm run public:repo-ready` passes before changing the existing GitHub
  repository to public visibility with preserved history. If it fails only on
  local history fingerprints, publish from `public:mirror` instead.
- `computer-linker doctor --json` reports no `releaseReadiness.blockingReasons`
  on the target machine.
- `computer-linker config validate` exits successfully on the target machine.
- At least one workspace scope is configured and its path exists.
- HTTP exposure has an owner token before any tunnel is started.
- Shell or Codex scopes have an explicit command allowlist when used outside
  local dogfooding.
- README, product spec, architecture docs, changelog, security policy, and
  `computer_operation` schema match the shipped contract.
- Tagged releases use `v<package.version>` and replace the current changelog
  heading's `Unreleased` suffix with a release date before pushing the tag.
  Fresh public mirrors create this tag automatically; push it with
  `--follow-tags`.
- Manual `npm publish` is guarded by `prepublishOnly`, which requires a clean
  worktree, `v<package.version>` on `HEAD`, a dated changelog heading,
  `npm run public:check`, and strict public-history audit before npm prepares
  the package.

## Security Review

For each shell or Codex-enabled scope, verify:

- The scope points at a trusted project directory.
- `allowedCommands` is narrow enough for expected workflows.
- `deniedCommands` blocks known destructive local patterns for that team.
- `maxRuntimeSeconds` and `maxOutputBytes` are finite.
- `allowShellMetacharacters` is left disabled unless a trusted scope genuinely
  needs raw shell syntax.
- The user understands that shell and Codex are cwd-bound execution, not an OS
  filesystem sandbox.

## Smoke Commands

```bash
computer-linker init
computer-linker check
computer-linker self-test
computer-linker status
computer-linker status --details
computer-linker status --json
computer-linker doctor
computer-linker doctor --json
computer-linker config validate
computer-linker config policy app --json
computer-linker client setup
computer-linker client setup --details
computer-linker client setup --show-token
computer-linker client setup --json
computer-linker client smoke --url http://127.0.0.1:3939/mcp --allow-http
computer-linker client chatgpt verify --mode coding
npm run alpha:evidence -- check
```

For package validation from a checkout:

```bash
npm ci
npm run release:validate
npm run product:check
npm run public:audit
```

For preserved-history GitHub repository publication, replace the last two
commands with:

```bash
npm run public:repo-ready
```

The manual GitHub Actions `Release Package` workflow runs `public:repo-ready`
and uploads the resulting `computer-linker-*.tgz` artifact for final
inspection. It must be launched manually from the `v<package.version>` tag in a
repo whose preserved history is safe for public packaging, such as the
`--remote` public snapshot. The workflow also rejects an `Unreleased` changelog
heading before spending time on the full public gate.
The default CI workflow is cost-capped but automatic: it runs `npm run
product:check` on `windows-latest` with Node 22 for pushes to `main` and pull
requests targeting `main`, with `workflow_dispatch` available for reruns. Run
broader OS or Node coverage manually only for a wider release. `npm run
release:validate` rejects matrix jobs, non-Windows runners, extra Node
versions, background triggers, and accidental automatic release packaging.
Use [manual-test-plan.md](manual-test-plan.md) for the local dogfooding pass.
