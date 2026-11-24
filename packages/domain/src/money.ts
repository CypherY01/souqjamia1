// Money is integer halalas (SAR x 100). Never use floats, and never round silently (CLAUDE.md).
// The listing price bound is parseListingPrice in listing.ts (task 4.2); the offer bound comes
// with task 5.5.
import { normalizeDigits } from "./digits.ts";

export type ParseAmountError = "empty" | "invalid" | "too_many_decimals" | "too_large";

export type ParseAmountResult =
  | { readonly ok: true; readonly halalas: number }
  | { readonly ok: false; readonly error: ParseAmountError };

/** More than any amount the rules allow (5,000,000 halalas), and far below unsafe integers. */
const MAX_RIYAL_DIGITS = 9;

/**
 * Parses an amount typed in riyals into halalas.
 * Accepts "350", "٣٥٠", "350.5", "٣٥٠٫٥٠", "1,200" and "١٬٢٠٠".
 * Rejects more than two decimals ("350.505") instead of rounding, misplaced thousands separators
 * ("1,20"), signs and any other character.
 */
export function parseAmount(input: string): ParseAmountResult {
  const text = normalizeDigits(input)
    .trim()
    .replaceAll("\u066b", ".") // ٫ Arabic decimal separator
    .replaceAll("\u066c", ","); // ٬ Arabic thousands separator
  if (text === "") return { ok: false, error: "empty" };

  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return { ok: false, error: "invalid" };
  const whole = (match[1] ?? "").replaceAll(",", "").replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return { ok: false, error: "too_many_decimals" };
  if (whole.length > MAX_RIYAL_DIGITS) return { ok: false, error: "too_large" };

  const halalas = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return { ok: true, halalas };
}
