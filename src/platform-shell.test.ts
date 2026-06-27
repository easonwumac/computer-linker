import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { executableCommand, findExecutableCommand, resolveExecutableCommand, shellCommand, shouldRunExecutableThroughShell } from "./platform-shell.js";

assert.deepEqual(shellCommand("echo ok", {
  platform: "win32",
  comSpec: "C:\\Windows\\System32\\cmd.exe",
}), {
  command: "C:\\Windows\\System32\\cmd.exe",
  args: ["/d", "/s", "/c", "echo ok"],
});

assert.deepEqual(shellCommand("echo ok", {
  platform: "darwin",
  shell: "/bin/zsh",
}), {
  command: "/bin/zsh",
  args: ["-lc", "echo ok"],
});

assert.deepEqual(shellCommand("echo ok", {
  platform: "linux",
  shell: "/bin/sh",
}), {
  command: "/bin/sh",
  args: ["-lc", "echo ok"],
});

const root = await mkdtemp(join(tmpdir(), "computer-linker-platform-shell-"));
try {
  const commandPath = join(root, "codex.cmd");
  await writeFile(commandPath, "@echo off\r\n", "utf8");
  await chmod(commandPath, 0o755);
  assert.equal(resolveExecutableCommand("codex", {
    platform: "win32",
    env: {
      PATH: `${root}${delimiter}C:\\Windows\\System32`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    },
  }), commandPath);

  assert.equal(resolveExecutableCommand("missing-tool", {
    platform: "win32",
    env: {
      PATH: root,
      PATHEXT: ".CMD",
    },
  }), "missing-tool");

  assert.equal(resolveExecutableCommand("codex", { platform: "linux" }), "codex");
  assert.equal(findExecutableCommand("codex", {
    platform: "win32",
    env: {
      PATH: `${root}${delimiter}C:\\Windows\\System32`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    },
  }), commandPath);
  assert.equal(findExecutableCommand("codex.cmd", {
    platform: "win32",
    env: {
      PATH: root,
      PATHEXT: ".CMD",
    },
  }), commandPath);
  assert.equal(findExecutableCommand("codex.cmd", {
    platform: "linux",
    env: {
      PATH: root,
    },
  }), commandPath);
  assert.equal(findExecutableCommand("missing-tool", {
    platform: "linux",
    env: {
      PATH: root,
    },
  }), undefined);
  assert.deepEqual(executableCommand("codex", ["exec", "-"], {
    platform: "win32",
    comSpec: "C:\\Windows\\System32\\cmd.exe",
    env: {
      PATH: `${root}${delimiter}C:\\Windows\\System32`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    },
  }), {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", `""${commandPath}" exec -"`],
    windowsVerbatimArguments: true,
  });
  assert.deepEqual(executableCommand("node", ["--version"], {
    platform: "linux",
    env: {
      PATH: root,
    },
  }), {
    command: "node",
    args: ["--version"],
  });
  assert.equal(shouldRunExecutableThroughShell(commandPath, { platform: "win32" }), true);
  assert.equal(shouldRunExecutableThroughShell("codex.exe", { platform: "win32" }), false);
  assert.equal(shouldRunExecutableThroughShell(commandPath, { platform: "linux" }), false);
} finally {
  await rm(root, { recursive: true, force: true });
}
