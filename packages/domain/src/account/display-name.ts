// FR01, DEC03, chapter 09: the member's display name (task 2.2).
// The same rule as the profile_display_name_rules CHECK in 20261119100000_identity.sql;
// tests/integration/identity.test.ts compares the two on the same inputs.
import { countChars, normalizeText } from "../text.ts";

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 50;

/** C0 and C1 controls, bidi embeddings and overrides, bidi isolates. Built from code points. */
const FORBIDDEN = new RegExp(
  `[${[
    [0x0001, 0x001f],
    [0x007f, 0x009f],
    [0x202a, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([from, to]) => `${String.fromCodePoint(from ?? 0)}-${String.fromCodePoint(to ?? 0)}`)
    .join("")}]`,
  "u",
);

export type DisplayNameError = "required" | "too_small" | "too_big" | "invalid_format";

export type DisplayNameResult =
  { ok: true; value: string } | { ok: false; error: DisplayNameError };

/** Normalizes (NFC, outer trim) and checks a display name. `value` is what gets stored. */
export function parseDisplayName(input: string): DisplayNameResult {
  const value = normalizeText(input);
  if (value === "") return { ok: false, error: "required" };
  if (FORBIDDEN.test(value)) return { ok: false, error: "invalid_format" };
  const length = countChars(value);
  if (length < DISPLAY_NAME_MIN) return { ok: false, error: "too_small" };
  if (length > DISPLAY_NAME_MAX) return { ok: false, error: "too_big" };
  return { ok: true, value };
}
