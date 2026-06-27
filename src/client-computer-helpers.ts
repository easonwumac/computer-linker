export type ComputerLinkerOperationName =
  | "file.stat"
  | "file.list"
  | "file.tree"
  | "file.read"
  | "file.read_many"
  | "file.write"
  | "file.create"
  | "file.patch"
  | "file.move"
  | "file.delete"
  | "file.find"
  | "file.search"
  | "code.context"
  | "code.search_symbols"
  | "git.status"
  | "git.changes"
  | "git.diff"
  | "git.log"
  | "git.show"
  | "git.stage"
  | "git.unstage"
  | "git.commit"
  | "package.run"
  | "package.start"
  | "command.run"
  | "command.start"
  | "command.read"
  | "command.stop"
  | "command.list"
  | "process.start"
  | "process.read"
  | "process.stop"
  | "process.list"
  | "codex.run"
  | "codex.start"
  | "codex.read"
  | "codex.stop"
  | "codex.list"
  | "history.last"
  | "history.timeline"
  | "history.sessions"
  | "history.connections"
  | "history.failed_replay"
  | "history.debug_bundle"
  | "screen.list"
  | "screen.capture"
  | "screen.capture_window"
  | "screen.capture_process";

export interface ComputerLinkerOperationRequest {
  scope: string;
  op: ComputerLinkerOperationName | (string & {});
  target?: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export type ComputerLinkerOperationCaller = <T = unknown>(
  request: ComputerLinkerOperationRequest,
) => Promise<T>;

export interface ComputerLinkerComputerHelpers {
  file: {
    stat<T = unknown>(scope: string, target: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, target?: string, options?: Record<string, unknown>): Promise<T>;
    tree<T = unknown>(scope: string, target?: string, options?: Record<string, unknown>): Promise<T>;
    read<T = unknown>(scope: string, target: string, options?: Record<string, unknown>): Promise<T>;
    readMany<T = unknown>(scope: string, paths: string[], options?: Record<string, unknown>): Promise<T>;
    write<T = unknown>(scope: string, target: string, content: string, options?: Record<string, unknown>): Promise<T>;
    create<T = unknown>(scope: string, target: string, content: string, options?: Record<string, unknown>): Promise<T>;
    patch<T = unknown>(scope: string, patch: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    move<T = unknown>(scope: string, fromPath: string, toPath: string, options?: Record<string, unknown>): Promise<T>;
    delete<T = unknown>(scope: string, target: string, input?: Record<string, unknown>, options?: Record<string, unknown>): Promise<T>;
    find<T = unknown>(scope: string, pattern: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    search<T = unknown>(scope: string, query: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  code: {
    context<T = unknown>(scope: string, target?: string, options?: Record<string, unknown>): Promise<T>;
    searchSymbols<T = unknown>(scope: string, query: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  git: {
    status<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    changes<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    diff<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    log<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    show<T = unknown>(scope: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    stage<T = unknown>(scope: string, paths: string[], options?: Record<string, unknown>, target?: string): Promise<T>;
    unstage<T = unknown>(scope: string, paths: string[], options?: Record<string, unknown>, target?: string): Promise<T>;
    commit<T = unknown>(scope: string, message: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  package: {
    run<T = unknown>(scope: string, script: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
    start<T = unknown>(scope: string, script: string, input?: Record<string, unknown>, options?: Record<string, unknown>, target?: string): Promise<T>;
  };
  command: {
    run<T = unknown>(scope: string, command: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    start<T = unknown>(scope: string, command: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    read<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    stop<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
  process: {
    start<T = unknown>(scope: string, command: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    read<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    stop<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
  codex: {
    run<T = unknown>(scope: string, prompt: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    start<T = unknown>(scope: string, prompt: string, options?: Record<string, unknown>, target?: string): Promise<T>;
    read<T = unknown>(scope: string, workflowId: string, options?: Record<string, unknown>): Promise<T>;
    stop<T = unknown>(scope: string, processId: string, options?: Record<string, unknown>): Promise<T>;
    list<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
  history: {
    last<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    timeline<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    sessions<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    connections<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    failedReplay<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
    debugBundle<T = unknown>(scope: string, options?: Record<string, unknown>): Promise<T>;
  };
}

export function createComputerLinkerComputerHelpers(
  computerOperation: ComputerLinkerOperationCaller,
): ComputerLinkerComputerHelpers {
  return {
    file: {
      stat: <T = unknown>(scope: string, target: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.stat", target, options })
      ),
      list: <T = unknown>(scope: string, target = ".", options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.list", target, options })
      ),
      tree: <T = unknown>(scope: string, target = ".", options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.tree", target, options })
      ),
      read: <T = unknown>(scope: string, target: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.read", target, options })
      ),
      readMany: <T = unknown>(scope: string, paths: string[], options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.read_many", input: { paths }, options })
      ),
      write: <T = unknown>(scope: string, target: string, content: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.write", target, input: { content }, options })
      ),
      create: <T = unknown>(scope: string, target: string, content: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.create", target, input: { content }, options })
      ),
      patch: <T = unknown>(scope: string, patch: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "file.patch", target, input: { patch }, options })
      ),
      move: <T = unknown>(scope: string, fromPath: string, toPath: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.move", target: fromPath, input: { toPath }, options })
      ),
      delete: <T = unknown>(scope: string, target: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "file.delete", target, input, options })
      ),
      find: <T = unknown>(scope: string, pattern: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "file.find", target, input: { pattern }, options })
      ),
      search: <T = unknown>(scope: string, query: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "file.search", target, input: { query, ...input }, options })
      ),
    },
    code: {
      context: <T = unknown>(scope: string, target = ".", options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "code.context", target, options })
      ),
      searchSymbols: <T = unknown>(scope: string, query: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "code.search_symbols", target, input: { query, ...input }, options })
      ),
    },
    git: {
      status: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.status", target, input, options })
      ),
      changes: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.changes", target, input, options })
      ),
      diff: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.diff", target, input, options })
      ),
      log: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.log", target, input, options })
      ),
      show: <T = unknown>(scope: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.show", target, input, options })
      ),
      stage: <T = unknown>(scope: string, paths: string[], options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.stage", target, input: { paths }, options })
      ),
      unstage: <T = unknown>(scope: string, paths: string[], options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.unstage", target, input: { paths }, options })
      ),
      commit: <T = unknown>(scope: string, message: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "git.commit", target, input: { message, ...input }, options })
      ),
    },
    package: {
      run: <T = unknown>(scope: string, script: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "package.run", target, input: { script, ...input }, options })
      ),
      start: <T = unknown>(scope: string, script: string, input: Record<string, unknown> = {}, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "package.start", target, input: { script, ...input }, options })
      ),
    },
    command: {
      run: <T = unknown>(scope: string, command: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "command.run", target, input: { command }, options })
      ),
      start: <T = unknown>(scope: string, command: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "command.start", target, input: { command }, options })
      ),
      read: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "command.read", target: processId, options })
      ),
      stop: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "command.stop", target: processId, options })
      ),
      list: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "command.list", options })
      ),
    },
    process: {
      start: <T = unknown>(scope: string, command: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "process.start", target, input: { command }, options })
      ),
      read: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "process.read", target: processId, options })
      ),
      stop: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "process.stop", target: processId, options })
      ),
      list: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "process.list", options })
      ),
    },
    codex: {
      run: <T = unknown>(scope: string, prompt: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "codex.run", target, input: { prompt }, options })
      ),
      start: <T = unknown>(scope: string, prompt: string, options: Record<string, unknown> = {}, target = ".") => (
        computerOperation<T>({ scope, op: "codex.start", target, input: { prompt }, options })
      ),
      read: <T = unknown>(scope: string, workflowId: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "codex.read", target: workflowId, options })
      ),
      stop: <T = unknown>(scope: string, processId: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "codex.stop", target: processId, options })
      ),
      list: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "codex.list", options })
      ),
    },
    history: {
      last: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "history.last", options })
      ),
      timeline: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "history.timeline", options })
      ),
      sessions: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "history.sessions", options })
      ),
      connections: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "history.connections", options })
      ),
      failedReplay: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "history.failed_replay", options })
      ),
      debugBundle: <T = unknown>(scope: string, options: Record<string, unknown> = {}) => (
        computerOperation<T>({ scope, op: "history.debug_bundle", options })
      ),
    },
  };
}
