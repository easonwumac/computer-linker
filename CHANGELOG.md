# Changelog

All notable changes to Computer Linker will be documented in this file.

This project follows a small pre-1.0 changelog: breaking contract changes are
called out even when the package version is still `0.x`.

## Unreleased

### Added

- Added workspace package script allow/deny policy so `package.run` and
  `package.start` can allow scripts such as `test` while blocking scripts such
  as `deploy`, even when broad package-manager command patterns are allowed.
- Added explicit `encoding:"base64"` support for `file.read` and
  `file.read_many`, including raw byte bounds, raw-byte sha256, total
  `sizeBytes`, and truncation metadata for binary file reads.
- Added a practical usage guide and command policy guide so daily startup,
  MCP client setup, agent operation flow, troubleshooting, and command safety
  have dedicated teaching documents.
- Added a learning-paths guide that routes new users, tunnel users, agent
  authors, SDK consumers, and maintainers to the right setup and architecture
  documents.

### Changed

- Command policy logic now lives in `src/command-policy.ts`, keeping wildcard
  matching, shell-metacharacter checks, runtime limits, and output limits out
  of the workspace operation dispatcher.
- `file.write` and `file.create` now fail fast when parent directories are
  missing unless the caller explicitly passes `createParents:true`.
- Text file reads now fail with a clear invalid-request error when the file is
  not valid UTF-8, instead of returning lossy replacement characters.
- CLI help and version output now live in `src/cli-help.ts`, keeping long help
  copy and help-topic routing out of the main CLI command dispatcher.
- Shell metacharacters and command chaining are blocked by default before
  command allowlist matching, so broad policies such as `npm *` and `git *`
  do not permit chained raw shell commands unless explicitly enabled for a
  trusted scope.
- Audit preview fields and debug bundles now redact common secret-shaped
  values, including bearer headers, `sk-...` API keys, env-style token/key
  assignments, password assignments, and database URLs with inline
  credentials.
- Fresh bootstrap config created by direct low-level startup now exposes only a
  read-only `current` scope. Normal coding access remains on `here` and
  `start <folder>`, which create explicit workspaces with default execution
  policy.
- Malformed and oversized HTTP request bodies now return JSON-shaped API errors
  or JSON-RPC MCP errors instead of Express fallback pages, while audit events
  record only the failure surface, path, status, and fixed reason.
- Managed command, package, and Codex process startup now handles spawn errors
  as readable exited process snapshots with bounded stderr messages instead of
  risking unhandled child-process errors.
- Operation discovery now filters runtime-unsupported workspace screenshot
  operations and reports scope-level `unavailableOperations` when policy allows
  an operation but the current provider cannot run it.
- Screenshot registry examples now use bounded base64 output for remote MCP
  clients, while docs mark `fileRef` as same-computer local automation only.
- README common operation examples are now covered by a registry validation
  test so invalid option pairings such as `file.list` with tree-only bounds
  cannot drift back in silently.
- Local maintenance state is now bounded: audit history compacts oversized
  JSONL files and reads recent events from the tail, Codex workflow records are
  redacted and capped, screenshot `fileRef` artifacts expire from the temp
  directory, exited managed process snapshots are pruned, and service logs are
  tailed with size diagnostics.
- Operation history now records `computer_operation` ids and HTTP MCP
  session/client metadata, so exact success/failure events can be queried by
  `operationId` and concurrent MCP clients are separated in connection
  summaries without storing full session headers or bearer tokens.
- Failed replay history for primary `computer_operation` calls now returns
  `request.action:"computer_operation"` templates, while legacy
  `workspace_operation` events keep compatibility replay envelopes.
- `get_computer_info` now honors section-based `include` filters for smaller
  discovery payloads and derives its readiness status from configured scopes,
  public-exposure auth, recommended tools, and runtime-unavailable operations.
- `computer_operation` contract tests now validate public registry examples,
  default public-op normalization, and representative runtime success/failure
  envelopes against `docs/computer-operation-v1.schema.json`.
- `target` now maps to `fromPath` for move operations, so `file.move` can use
  the same simple target/input shape as other file operations.
- Codex session operations now use one public id family: `codex.start` returns
  `sessionId`, `codex.read` and `codex.stop` accept that id, and `codex.list`
  includes recent managed sessions plus persisted workflow records.
- README now stays focused on first-run install, folder startup, MCP client
  setup, tunnel basics, and pasteable agent instructions, with deeper material
  linked through the docs map.
- HTTP MCP sessions now expire after a bounded idle timeout, close their
  underlying transport when possible, and write redacted `expired:<id>` session
  events that are visible from operation history.
- MCP tool text responses now stay bounded for large payloads: small responses
  remain readable JSON, while large responses keep complete data in
  `structuredContent` and expose only a compact text preview.
- README now stays focused on first-run install, folder startup, MCP client
  setup, tunnel basics, and pasteable agent instructions, with deeper material
  linked through the docs map.

## 0.1.11 - 2026-06-27

### Added

- Added a docs documentation map and developer guide so setup, client usage,
  service mode, release checks, architecture, and extension workflow have clear
  entrypoints.
- Added CLI quick reference, agent playbook, and SDK quickstart docs so users,
  MCP-capable agents, and integration authors each have a short teaching path.
- Added an installed service smoke checklist for Windows, macOS, and Linux.

### Changed

- GitHub Actions CI now runs the product gate on `main` pushes and pull
  requests while staying bounded to Windows and Node 22; release packaging
  remains manually dispatched.
- Workspace root handling is now split into a shared helper module: CLI setup
  commands create explicit roots, while MCP workspace open validates configured
  roots without creating missing directories.
- npm package metadata now describes Computer Linker as a local MCP server for
  controlled computer operations instead of foregrounding workspace terminology.
- Capability discovery now exposes explicit `networkAccess` semantics so
  shell, package, process, and Codex operations are not mistaken for
  Computer Linker-enforced network sandboxes.
- SDK entrypoint types now expose `ComputerLinker*` names while preserving
  `WorkspaceLinker*` compatibility aliases.
- SDK now includes `client.computer.*` helpers that call the primary
  `computer_operation` JSON action with dotted operation names, while legacy
  workspace helper methods remain available as deprecated compatibility APIs.
- SDK computer helper contract is now split into `src/client-computer-helpers.ts`
  so the public client class stays focused on transport, setup/readiness, and
  compatibility behavior.
- Capability discovery now separates primary MCP/JSON API recommendations from
  compatibility workspace tools, actions, endpoints, and registries.
- Public MCP-only routing now treats forwarded public requests as public even
  when a proxy supplies a local-looking `Host` header, while preserving true
  loopback diagnostics.
- Owner-token authentication now uses timing-safe comparison for direct bearer
  and compatibility token headers, adds bounded repeated-failure backoff, and
  keeps provided token values out of auth-failure audit records.
- README, getting started, architecture, product spec, release checklist, and
  readiness checks now describe the same CI and documentation structure.

## 0.1.10 - 2026-06-27

### Added

- Added `computer-linker here` as the short daily startup command for exposing
  the current folder, equivalent to `computer-linker start .`.
- Added a step-by-step getting started tutorial for install checks, local MCP
  clients, public tunnels, agent instructions, daily commands, and
  troubleshooting.
- Added an implementation module map to the architecture docs so CLI, config,
  MCP transport, operation dispatch, providers, client helpers, tunnels, and
  release tooling have clearer boundaries.

### Changed

- README, client recipes, ChatGPT compatibility setup, manual test docs, and
  CLI help now lead with `here` for current-folder setup while keeping
  `start <folder>` for explicit paths and existing no-argument server startup.

## 0.1.9 - 2026-06-27

### Added

- Added `npm run release -- --otp <code>` as the one-command local npm publish
  path, wrapping publish, tag creation, registry verification, published CLI
  smoke, and Git push.

### Changed

- README, release checklist, and release wrapper help now recommend the
  one-command release path while keeping check, dry-run, and lower-level
  publish commands for diagnostics.

## 0.1.8 - 2026-06-27

### Changed

- Public release audit now scans tracked files, packed files, and Git history
  for npm access-token shaped values before publishing.
- Public release audit now labels tracked, untracked, and packed-file findings
  separately so release failures point at the right source.
- Release validation now locks the npm access-token audit rule and release
  checklist wording so the public gate cannot silently regress.

## 0.1.7 - 2026-06-27

### Changed

- Public release audit now scans tracked and packed text files for suspicious
  third-party provenance markers, including source-copy, adaptation,
  snippet-site, and vendored-code references before public release.
- Public release audit now blocks retired product-name markers without keeping
  that retired name in repository text.
- Release checklist now documents the provenance marker scan alongside license
  and secret checks.

## 0.1.6 - 2026-06-27

### Changed

- The local npm release wrapper now loads `NODE_AUTH_TOKEN` from the Windows
  User environment when the current shell process has not inherited it, avoiding
  a false `npm whoami` 401 after saving a token with `setx` or the Windows
  environment UI.
- README and release checklist now document that Windows release token
  hydration behavior.

## 0.1.5 - 2026-06-27

### Changed

- `quickstart --json` now exposes `commands.check` as the productized install
  check command while preserving `commands.selfTest` as a compatibility alias
  for older agents.
- README and release/manual test docs now use `computer-linker check` as the
  primary isolated install check command.

## 0.1.4 - 2026-06-27

### Added

- Added `computer-linker check` as the productized install check command. It
  runs the existing isolated self-test flow while keeping `self-test` as a
  compatibility/advanced command.

## 0.1.3 - 2026-06-27

### Added

- Added `release:verify` to confirm a published npm version's exact metadata,
  dist-tag, and published CLI from a clean temporary directory.

### Changed

- `release:publish` now runs the post-publish npm registry verification
  automatically after npm accepts the package.
- `release:publish -- --push` now pushes `HEAD` and the exact release tag
  explicitly, so lightweight release tags are not skipped by `git push
  --follow-tags`.

## 0.1.2 - 2026-06-27

### Added

- Local npm release wrapper commands: `release:check`, `release:dry-run`, and
  `release:publish`.

### Changed

- Simplified the default setup path so `start <folder>`, `setup <folder>`, and
  `quickstart <folder>` use normal coding access without requiring `--dev` or
  `--coding`.

## 0.1.1 - 2026-06-27

### Changed

- Prepared the renamed Computer Linker package for npm publication under
  `@easonwumac/computer-linker`.
- Aligned release metadata with the GitHub repository rename to
  `easonwumac/computer-linker`.

## 0.1.0 - 2026-06-26

### Added

- Local MCP server and JSON API for permissioned workspace operations.
- `get_computer_info`, `computer_operation`, and `get_operation_history`
  product-level contracts.
- One-minute README onboarding now leads with the installed CLI,
  `computer-linker start <folder> --coding`, and `client setup` instead of
  source-checkout development commands.
- Added MCP client recipes for local clients, OpenAI Secure MCP Tunnel,
  Tailscale Funnel, Cloudflare, and the minimal SDK client.
- File content reads and text searches now block common sensitive files by
  default, including `.env*`, private keys, credential JSON files, and cloud CLI
  credential folders.
- Service mode now supports daily `service install --yes`, `start`, `stop`,
  `logs`, and `uninstall --yes` flows while preserving `--dry-run` previews.
- `computer_operation` v1 request/result JSON Schema in
  `docs/computer-operation-v1.schema.json`.
- Doctor, ChatGPT setup, tunnel diagnostics, service profile, and package
  smoke workflows.
- Command policy support for shell, package, process, and Codex operations.
- Windows primary-display screenshot capture through a PowerShell provider,
  with automated fake-provider coverage that does not read real screen pixels.
- `computer-linker config validate` and `computer-linker config policy`
  commands for release readiness and policy maintenance.
- Cost-capped manual CI product gate on Windows with Node 22.
- Release metadata validation for version, lockfile, changelog, security
  policy, schema, and workflow drift.
- Package smoke now installs the packed `.tgz` into a temporary consumer
  project and verifies the installed CLI and SDK entrypoints.
- SDK `connectReadiness()` now aggregates generic MCP client setup, workspace,
  and operation registry state instead of depending on ChatGPT setup.
- `client_setup` now separates local readiness from remote/tunnel readiness so
  loopback clients are not marked blocked by cloud exposure requirements.
- `workspace add` now accepts a single folder path and derives the scope id and
  display name from that folder, while keeping the legacy `<id> <path>` form.
- `computer-linker --version` and `computer-linker version` now report the
  installed package version.
- MCP server metadata, `get_computer_info`, and capabilities now report the
  installed package version from the same package metadata source.
- Package smoke now verifies that an installed tarball can create and read an
  isolated Computer Linker config through `setup` and `status`.
- `computer-linker self-test` now performs an isolated installed CLI/server/MCP
  smoke test using a temporary config and workspace.
- `computer-linker client setup` now prints generic MCP client connection,
  auth, readiness, tool, and first-prompt guidance without using ChatGPT
  profile formats.
- `computer-linker client setup` now keeps the default text output to a short
  MCP connection summary and moves tool lists, first prompt, and full agent
  instructions behind `--details`.
- `computer-linker client smoke` now runs generic MCP client HTTP/MCP
  reachability checks without ChatGPT-specific output.
- `computer-linker diagnose client` now combines MCP client setup readiness,
  a minimal MCP SDK smoke test, and redacted connection-history inspection into
  one troubleshooting report.
- Setup, start, quickstart, and workspace management now accept `--read-only`,
  `--coding`, and `--full-trust` permission presets while preserving `--dev`
  as the coding-mode alias.
- Added a minimal MCP SDK client example at `examples/minimal-mcp-client.mjs`
  for validating the default three-tool surface outside the CLI.
- Added API compatibility and reusable agent instruction docs for the stable
  `get_computer_info`, `computer_operation`, and `get_operation_history`
  product contract.
- SDK `smoke()` now runs generic local/trusted-private HTTP API and MCP
  reachability checks and returns a `computer-linker-client-smoke` report.
- Local/trusted-private client smoke now verifies authenticated
  `get_computer_info` and one read-only `computer_operation` `file.list`
  instead of only checking reachability.
- Generic CLI and SDK smoke checks now share a client smoke core instead of
  routing the generic CLI command through ChatGPT compatibility helpers.
- ChatGPT smoke checks now wrap the same generic client smoke core while
  preserving ChatGPT-specific output shape and setup wording.
- Default MCP tool exposure is now limited to `get_computer_info`,
  `computer_operation`, and `get_operation_history`; legacy workspace and
  direct file tools require `COMPUTER_LINKER_MCP_TOOL_SURFACE=compatibility`.
- Generic `computer_operation` registry now includes product-level dotted ops
  for code context/symbol search, Git, package scripts, managed processes, and
  Codex stop/read/list flows instead of relying on legacy workspace op names.
- Public release audit for packed files, secret-shaped values, dependency
  licenses, and production dependency advisories.
- Clean public snapshot workflow for publishing from a single-commit public
  repository without rewriting private dogfooding history.
- Public snapshots omit the private source commit reference by default, with an
  explicit `--include-source-ref` option when traceability is desired.
- Public mirror snapshots now create a `v<package.version>` tag, verify that it
  points at the generated one-commit mirror, and print `--follow-tags` push
  guidance for release workflows.
- Publishable public mirrors now require the matching changelog heading to be
  dated before creating a release tag; remote dry-runs report whether a real run
  would be blocked.
- `public:mirror --remote` now prechecks the publishable release tag/changelog
  before running long readiness gates, so real publish attempts fail fast and
  dry-runs show the blocker up front.
- Alpha evidence smoke defaults now use a generic external MCP client label
  instead of naming ChatGPT unless the caller passes `--client "ChatGPT web"`.
- Alpha evidence preflight now describes missing current-HEAD observations as
  tool calls or tunnel dispatcher traffic after the commit, avoiding ambiguous
  "fresh tool calls" wording in failure output.
- `alpha:check --require-evidence` next actions now collapse external evidence
  recovery into a shorter preflight, smoke-record, and rerun sequence instead of
  repeating the same guidance in several forms.
- Added `npm run public:release-ready` as the final local public-alpha preflight,
  combining alpha readiness, required external MCP evidence, and dated
  changelog enforcement in one command.
- Local `alpha:check` readiness report for the source checkout, covering the
  product gate, public audit, public snapshot dry-run, and cost-capped workflow
  checks without triggering GitHub Actions.
- `alpha:evidence` release tooling for generating and validating local external
  MCP client/tunnel evidence before announcing a public alpha.
- `alpha:evidence init` now accepts client, exposure, tunnel/URL, and scope
  options, and `alpha:evidence check` validates concrete target details before
  accepting external client/tunnel proof.
- `alpha:evidence record` now marks individual external-alpha evidence checks
  as passed and can set redaction confirmation without hand-editing JSON.
- `alpha:evidence record-smoke` now records one external MCP/tunnel smoke pass
  across all required evidence checks with one redaction-confirmed command.
- `alpha:evidence smoke` now combines external alpha evidence creation and
  full smoke-pass recording into one redaction-confirmed command.
- `alpha:evidence preflight` now inspects local config, audit history, and
  tunnel runtime state and prints a read-only external-client prompt before
  recording alpha evidence.
- `alpha:evidence smoke`, `init`, `record-smoke`, and `record` now reject common
  secret-shaped values before writing local release evidence.
- `npm test` now covers `alpha:evidence` init/check success and target
  rejection cases so external-alpha evidence validation cannot silently regress.
- `alpha:check` now points missing external-evidence guidance at
  `alpha:evidence smoke`, with lightweight report coverage in `npm test`.
- Agent setup guidance now tells connected clients to use generic
  `computer_operation` dotted ops and avoid compatibility workspace tools
  unless explicitly exposed.
- `computer-linker client setup` now prints copy-pasteable generic agent
  instructions in text output and includes them in JSON output.
- Package smoke now verifies the installed `computer-linker client setup
  --json` output, including generic tools, redacted auth, first prompt, and
  agent instructions.
- Default CLI help, startup readiness, and ChatGPT setup guidance now show
  tunnel startup as one-command folder setup examples instead of tunnel-only
  commands.
- SDK `clientSetup()` typings now expose `firstPrompt` and
  `agentInstructions`.
- npm publish guard that requires a clean worktree, matching version tag, dated
  changelog, and the public release gate before publishing.
- OpenAI Secure MCP Tunnel support now treats tunnel-id mode as remote-ready
  without requiring `publicBaseUrl`, auto-downloads the official tunnel client
  when needed, and keeps bearer-token setup out of ChatGPT Tunnel mode.
- OpenAI tunnel quickstart, start help, and missing-key errors now surface the
  `CONTROL_PLANE_API_KEY` / `OPENAI_API_KEY` prerequisite directly in the CLI
  before users reach tunnel startup.
- Quickstart text and JSON now explain that `start` stays running and client
  setup / verification commands should be run from another terminal.
- Product spec guidance for the CLI management surface now matches the concise
  first-run help contract and keeps self-test, smoke, repair, history, and
  compatibility commands in focused help.
- `alpha:check` preserved-history warnings now include the exact
  `npm run public:mirror -- --remote <github-owner>/<public-repo>` command in
  next actions.
- `computer-linker tunnel status` now explains that OpenAI Secure MCP Tunnel
  mode intentionally has no public URL instead of reporting the URL as merely
  not detected.
- `alpha:evidence preflight` now shows the current Git HEAD and the exact
  fresh external smoke evidence missing for that commit.
- `alpha:check --require-evidence` now summarizes stale external smoke evidence
  as a current-HEAD freshness issue with the current commit shown in text output.
- MIT license file included in the package.

### Changed

- Removed legacy ChatGPT profile shortcuts from the generic CLI surface:
  `connect-profile`, top-level `chatgpt`, and `profile --chatgpt` now point
  users to `client chatgpt ...` compatibility helpers instead.
- Daily-use CLI output for `status`, `start`, `setup`, and generic
  `client setup` now favors concise summaries, with diagnostics and long setup
  details available through `--details`, `--json`, or focused follow-up
  commands.
- Default CLI help now keeps the first-run surface to start, tunnel, status,
  client setup, and quickstart preview while moving self-test, smoke, repair,
  service, config, API, and compatibility commands behind focused help topics.
- Package metadata now positions Computer Linker as a generic MCP/local
  automation package instead of using ChatGPT as the product keyword.

### Security

- File, search, patch, and direct Git operations validate workspace paths
  before execution.
- Screenshot capture history records are marked non-replayable by default so a
  failed replay cannot silently capture the current screen again.
- Debug bundles explicitly redact screenshot image bytes.
- Default help and local smoke docs now prefer redacted `profile` output and
  reserve `--show-token` for trusted MCP client setup screens.
- `init` and HTTP server startup now redact owner-token values by default and
  point users to `profile --show-token` for trusted local setup screens.
- Manual smoke docs now pin the `app` scope id where later API and process
  examples depend on that id.
- Shell, package, process, and Codex operations are explicitly documented as
  workspace-cwd local execution, not OS filesystem sandboxes.
- Release readiness now warns on shell or Codex scopes without an
  `allowedCommands` policy.
- Public release audit now blocks tracked or packed
  `.computer-linker-alpha-evidence.json`, keeping real dogfooding tunnel and
  client evidence local while publishing only the example schema.
