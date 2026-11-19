// Structured logs, one JSON line per event (NFR13, SEC06). Never log request bodies, cookies or
// the Authorization header. Passwords, tokens, auth links, chat text and card images must never
// reach a log: fields with sensitive names are dropped, and values that look like tokens, JWTs,
// keys or links carrying a token are masked.
const REDACTED = "[REDACTED]";

/** Fields this logger writes itself; their names are safe, their values are still scanned. */
const OWN_FIELDS = new Set([
  "time",
  "level",
  "event",
  "trace_id",
  "route",
  "method",
  "path",
  "status",
  "duration_ms",
  "code",
]);

const SENSITIVE_NAME =
  /pass(word)?|secret|token|cookie|authori[sz]ation|jwt|otp|api[-_]?key|credential|session|(^|_)code$/i;

const SENSITIVE_VALUES: readonly [RegExp, string][] = [
  // JWTs: three base64url parts, the first starting with {" encoded.
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],
  // Supabase keys.
  [/sb_(secret|publishable)_[\w-]+/g, REDACTED],
  // Bearer credentials.
  [/Bearer\s+[\w.~+/-]+=*/gi, `Bearer ${REDACTED}`],
  // Credentials in connection strings: scheme://user:password@host.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Tokens in links: token_hash=..., token=..., code=..., access_token=..., refresh_token=...
  [
    /([?&#](?:token_hash|token|code|access_token|refresh_token|password)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  ],
  // Sensitive key=value or key: value pairs anywhere in text, e.g. in an exception message.
  [
    /(^|[^\w])((?:password|passwd|secret|[\w-]*token|api[-_]?key)\s*[=:]\s*)[^\s&,;"']+/gi,
    `$1$2${REDACTED}`,
  ],
];

export function redactText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SENSITIVE_VALUES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

const MAX_DEPTH = 5;

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack === undefined ? undefined : redactText(value.stack),
    };
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  return redactFields(value as Record<string, unknown>, depth + 1);
}

export function redactFields(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] =
      !OWN_FIELDS.has(key) && SENSITIVE_NAME.test(key) ? REDACTED : redactValue(value, depth);
  }
  return result;
}

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...redactFields(fields),
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => {
    write("info", event, fields);
  },
  warn: (event: string, fields: Record<string, unknown> = {}) => {
    write("warn", event, fields);
  },
  error: (event: string, fields: Record<string, unknown> = {}) => {
    write("error", event, fields);
  },
};
