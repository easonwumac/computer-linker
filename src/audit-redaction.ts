const AUTHORIZATION_BEARER_RE = /\b(Authorization\s*:\s*Bearer\s+)([^\s"',;]+)/gi;
const GENERIC_BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{3,})/g;
const OPENAI_KEY_RE = /\bsk-(?:proj-)?[A-Za-z0-9_-]{6,}\b/g;
const SECRET_ASSIGNMENT_RE = /(^|[^A-Z0-9])([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASS|_KEY)[A-Z0-9_]*|API_KEY|TOKEN|SECRET|PASSWORD|KEY)\s*=\s*("[^"]*"|'[^']*'|[^\s;&|]+)/gi;
const BASIC_AUTH_URL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^:@\s/]+):([^@\s/]+)@/gi;

export function redactAuditText(value: string): string {
  return value
    .replace(AUTHORIZATION_BEARER_RE, "$1<redacted>")
    .replace(GENERIC_BEARER_RE, "$1<redacted>")
    .replace(SECRET_ASSIGNMENT_RE, "$1$2=<redacted>")
    .replace(OPENAI_KEY_RE, "sk-<redacted>")
    .replace(BASIC_AUTH_URL_RE, "$1<redacted>@");
}

export function redactAuditValue<T>(value: T): T {
  if (typeof value === "string") return redactAuditText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item)) as T;
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = redactAuditValue(item);
  }
  return redacted as T;
}
