// Task 4.2 (FR16 to FR22, BR04 to BR08, DEC04 to DEC08, DEC28, RL05): the listing rules shared by
// the server and the wizard. The database has the same values in 20261124090000_listings.sql (the
// CHECKs and app.publish_listing), and tests/integration/listings-publish.test.ts compares them.
import { parseAmount, type ParseAmountResult } from "./money.ts";
import { countChars, normalizeText } from "./text.ts";

/** DEC04, BR05: code points after NFC and trim. */
export const LISTING_TITLE_MIN = 5;
export const LISTING_TITLE_MAX = 100;
export const LISTING_DESCRIPTION_MIN = 10;
export const LISTING_DESCRIPTION_MAX = 2000;
/** DEC08, BR06: images per listing. */
export const LISTING_IMAGES_MIN = 1;
export const LISTING_IMAGES_MAX = 10;
/** DEC05, BR07: 0 to 50,000 riyals, stored as halalas. */
export const LISTING_PRICE_MAX_MINOR = 5_000_000;
/** RL05: active listings per member, and publications (listings and wanted requests together). */
export const LISTING_ACTIVE_MAX = 200;
export const RL05_PER_HOUR = 5;
export const RL05_PER_DAY = 20;

function codePointRanges(ranges: readonly (readonly [number, number])[]): RegExp {
  return new RegExp(
    `[${ranges.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join("")}]`,
    "u",
  );
}

/** One line: C0 and C1 controls, bidi embeddings, overrides and isolates (as the display name). */
const TITLE_FORBIDDEN = codePointRanges([
  [0x0001, 0x001f],
  [0x007f, 0x009f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]);
/** The description keeps TAB and LF (its line breaks, BR05); the rest as the title. */
const DESCRIPTION_FORBIDDEN = codePointRanges([
  [0x0001, 0x0008],
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]);

export type ListingTextError = "required" | "too_small" | "too_big" | "invalid_format";

export type ListingTextResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ListingTextError };

function parseText(value: string, forbidden: RegExp, min: number, max: number): ListingTextResult {
  if (value === "") return { ok: false, error: "required" };
  if (forbidden.test(value)) return { ok: false, error: "invalid_format" };
  const length = countChars(value);
  if (length < min) return { ok: false, error: "too_small" };
  if (length > max) return { ok: false, error: "too_big" };
  return { ok: true, value };
}

/** DEC04: the title, normalized (NFC, outer trim). `value` is what gets stored. */
export function parseListingTitle(input: string): ListingTextResult {
  return parseText(normalizeText(input), TITLE_FORBIDDEN, LISTING_TITLE_MIN, LISTING_TITLE_MAX);
}

/** CR LF and CR become LF, then NFC and outer trim (the database does the same). */
export function normalizeDescription(input: string): string {
  return normalizeText(input.replace(/\r\n?/g, "\n"));
}

/** DEC04, BR05: the description, line breaks kept. `value` is what gets stored. */
export function parseListingDescription(input: string): ListingTextResult {
  return parseText(
    normalizeDescription(input),
    DESCRIPTION_FORBIDDEN,
    LISTING_DESCRIPTION_MIN,
    LISTING_DESCRIPTION_MAX,
  );
}

/** The length a counter shows, with the same rule as the limit (code points after NFC and trim). */
export function listingTextLength(input: string): number {
  return countChars(input.replace(/\r\n?/g, "\n"));
}

/**
 * DEC05, DEC50, TC08: a price typed in riyals (Western or Arabic-Indic digits), at most two
 * decimals and 50,000 riyals, never rounded. Zero is a free item (BR08).
 */
export function parseListingPrice(input: string): ParseAmountResult {
  const parsed = parseAmount(input);
  if (parsed.ok && parsed.halalas > LISTING_PRICE_MAX_MINOR) {
    return { ok: false, error: "too_large" };
  }
  return parsed;
}

/** The fields of the contract's ListingInput, after the structure check. */
export interface ListingInputValues {
  readonly title: string;
  readonly description: string;
  readonly price_minor: number;
  readonly is_negotiable: boolean;
  readonly media_ids: readonly string[];
}

export interface ListingFieldError {
  readonly field: string;
  readonly code: string;
}

/**
 * The field rules past the structure (types, uuids and the condition are checked by the server's
 * schema): the texts, BR08 and duplicate images. Every problem at once; empty means valid.
 */
export function listingFieldErrors(input: ListingInputValues): ListingFieldError[] {
  const errors: ListingFieldError[] = [];
  const title = parseListingTitle(input.title);
  if (!title.ok) errors.push({ field: "title", code: title.error });
  const description = parseListingDescription(input.description);
  if (!description.ok) errors.push({ field: "description", code: description.error });
  if (input.price_minor === 0 && input.is_negotiable) {
    errors.push({ field: "is_negotiable", code: "not_allowed" });
  }
  if (new Set(input.media_ids).size !== input.media_ids.length) {
    errors.push({ field: "media_ids", code: "duplicate" });
  }
  return errors;
}

/** FR16: the wizard's five steps, in order. */
export const SELL_STEPS = [1, 2, 3, 4, 5] as const;
export type SellStep = (typeof SELL_STEPS)[number];

/** Section 6.3: the step that holds each field, so a server error goes back to it. */
const FIELD_STEP: Readonly<Record<string, SellStep>> = {
  media_ids: 1,
  title: 2,
  category_id: 2,
  condition: 2,
  description: 2,
  price_minor: 3,
  is_negotiable: 3,
  location_id: 4,
};

/** The step of a field error ("media_ids.3" is the images step); unknown fields stay on review. */
export function stepOfField(field: string): SellStep {
  const name = field.split(".")[0] ?? field;
  return FIELD_STEP[name] ?? 5;
}

/** The earliest step among the fields, or the review step when there is none. */
export function firstStepOf(fields: readonly string[]): SellStep {
  let step: SellStep = 5;
  for (const field of fields) {
    const candidate = stepOfField(field);
    if (candidate < step) step = candidate;
  }
  return step;
}
