export type OperationErrorCode =
  | "invalid_request"
  | "unknown_scope"
  | "unknown_operation"
  | "permission_denied"
  | "path_out_of_scope"
  | "unsupported_platform"
  | "provider_unavailable"
  | "timeout"
  | "process_not_found"
  | "os_permission_required"
  | "execution_failed";

export class OperationError extends Error {
  readonly code: OperationErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OperationErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OperationError";
    this.code = code;
    this.retryable = options.retryable ?? defaultRetryable(code);
    this.details = options.details;
  }
}

export function operationError(
  code: OperationErrorCode,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
): OperationError {
  return new OperationError(code, message, options);
}

export function isOperationError(error: unknown): error is OperationError {
  return error instanceof OperationError;
}

function defaultRetryable(code: OperationErrorCode): boolean {
  return code === "timeout" ||
    code === "provider_unavailable" ||
    code === "os_permission_required";
}
