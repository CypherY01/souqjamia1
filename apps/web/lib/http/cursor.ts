// NFR14 and TC29: an opaque, signed page cursor bound to the filters and the order.
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(cursor key, payload part)).
// The payload holds the sort key values of the last row, ending with a stable secondary id so
// equal prices still page deterministically, and a fingerprint of the filters and order.
// A forged, changed or foreign cursor is 400 INVALID_CURSOR.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.ts";
import { deriveKey } from "./keys.ts";

/** contracts/components/parameters.yaml: cursor maxLength 512. */
export const MAX_CURSOR_LENGTH = 512;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export type CursorKey = string | number;

interface Payload {
  v: 1;
  /** Sort key values of the last row on the page, the secondary id last. */
  k: CursorKey[];
  /** Fingerprint of the filters and order the page was produced with. */
  f: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Same filters in any key order give the same fingerprint; any changed value does not. */
export function filterFingerprint(filters: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(filters)).digest("base64url").slice(0, 22);
}

function sign(appSecret: string, payloadPart: string): string {
  return createHmac("sha256", deriveKey(appSecret, "cursor"))
    .update(payloadPart)
    .digest("base64url");
}

export function encodeCursor(
  appSecret: string,
  keys: CursorKey[],
  filters: Record<string, unknown>,
): string {
  const payload: Payload = { v: 1, k: keys, f: filterFingerprint(filters) };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${sign(appSecret, payloadPart)}`;
}

const invalid = () => new ApiError("INVALID_CURSOR");

function isPayload(value: unknown): value is Payload {
  if (typeof value !== "object" || value === null) return false;
  const { v, k, f } = value as Record<string, unknown>;
  return (
    v === 1 &&
    Array.isArray(k) &&
    k.length > 0 &&
    k.every((item) => typeof item === "string" || typeof item === "number") &&
    typeof f === "string"
  );
}

/** The sort keys of the last row, or throws INVALID_CURSOR. */
export function decodeCursor(
  appSecret: string,
  cursor: string,
  filters: Record<string, unknown>,
): CursorKey[] {
  if (cursor.length > MAX_CURSOR_LENGTH) throw invalid();
  const match = /^([\w-]+)\.([\w-]{43})$/.exec(cursor);
  if (match === null) throw invalid();
  const [, payloadPart = "", signature = ""] = match;
  const expected = Buffer.from(sign(appSecret, payloadPart));
  if (!timingSafeEqual(expected, Buffer.from(signature))) throw invalid();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!isPayload(payload) || payload.f !== filterFingerprint(filters)) throw invalid();
  return payload.k;
}

/** `limit` query parameter: 20 by default, 1 to 50. Anything else is 400 BAD_REQUEST. */
export function parseLimit(value: string | null): number {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^[0-9]{1,3}$/.test(value)) {
    throw new ApiError("BAD_REQUEST", { fieldErrors: [{ field: "limit", code: "invalid_type" }] });
  }
  const limit = Number(value);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ApiError("BAD_REQUEST", { fieldErrors: [{ field: "limit", code: "out_of_range" }] });
  }
  return limit;
}
