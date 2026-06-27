# Service Mode

Computer Linker can run as a background service on Linux, macOS, and Windows.
The default service flow is conservative: preview with `--dry-run`, then apply
install/uninstall with `--yes`.

Generate a profile for the current platform:

```bash
computer-linker service profile
```

Generate a specific platform manifest:

```bash
computer-linker service profile --platform linux --format manifest
computer-linker service profile --platform macos --format manifest
computer-linker service profile --platform windows --format manifest
```

Write a complete service bundle:

```bash
computer-linker service profile --platform linux --output-dir ./service-profile
```

The bundle contains:

- `service-profile.json`
- the native service manifest (`.service`, `.plist`, or `.ps1`)
- `install-service.sh` or `install-service.ps1`
- `uninstall-service.sh` or `uninstall-service.ps1`

Check what Computer Linker expects on this machine:

```bash
computer-linker service status
computer-linker service status --json
```

Preview install or uninstall commands without changing the OS:

```bash
computer-linker service install --dry-run
computer-linker service install --dry-run --json
computer-linker service uninstall --dry-run
```

Install or remove the service on the current platform:

```bash
computer-linker service install --yes
computer-linker service start
computer-linker service status
computer-linker service logs
computer-linker service stop
computer-linker service uninstall --yes
```

`install --yes` writes the service bundle under the Computer Linker config
directory by default, then runs the generated install script. Pass
`--output-dir ./service-profile` when you want the bundle somewhere else.
`service start` and `service stop` control the already-installed service on the
current platform. Use `--dry-run` for cross-platform plans such as
`--platform linux` while working on Windows.

Before installing:

```bash
computer-linker init
computer-linker doctor
```

`doctor` includes a machine-readable `startup` block with foreground start,
HTTP, stdio, and persistent service startup modes. It also includes the current
platform service status commands, profile command, bundle command, and install
dry-run command, so a setup script or MCP client can discover the right service
workflow without parsing this document.

The generated service runs:

```bash
computer-linker serve --transport http
```

It uses `COMPUTER_LINKER_CONFIG_DIR` so the service reads the same bounded
workspace config as the interactive CLI. Host, port, owner token, public URL,
and workspace permissions stay in `config.json`.

Platform notes:

- Linux uses `systemd`.
- macOS uses a per-user `launchd` agent in `~/Library/LaunchAgents`.
- Windows uses `sc.exe`; install/uninstall require an elevated PowerShell
  prompt. Generated Windows services write `service.out.log` and
  `service.err.log` under the Computer Linker config directory.

Keep the HTTP service loopback-only unless it is protected by Tailscale,
Cloudflare Access, or equivalent network controls.
