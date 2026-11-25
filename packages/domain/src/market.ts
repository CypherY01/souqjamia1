// Task 4.3 (FR06 to FR12, NFR14, RL04, DEC84): the market rules shared by the server and the
// pages. The database has the same values in 20261125090000_market.sql (app.market_listings),
// and tests/integration/market.test.ts compares them.
import { CategoryKey, Condition } from "./enums.ts";
import { countChars, normalizeText } from "./text.ts";

/** FR07: code points of the query after DEC67 normalization (checked by the database). */
export const MARKET_QUERY_MAX = 100;
/** Before normalization, a guard for the URL: diacritics and spaces only make a query longer. */
export const MARKET_QUERY_RAW_MAX = 400;
/** DEC84: "close" results have a pg_trgm word similarity of at least this. */
export const MATCH_THRESHOLD = 0.5;
/** FR06: the latest listings on the home page (item 7 of the plan). */
export const HOME_RECENT_COUNT = 12;
/** RL04 (DEC84: a member's session counts like a guest's), per minute. */
export const RL04_SESSION_PER_MINUTE = 120;
export const RL04_ADDRESS_PER_MINUTE = 1200;

/** FR11, contracts ListingSort. */
export const LISTING_SORTS = ["newest", "price_asc", "price_desc"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];
export const DEFAULT_LISTING_SORT: ListingSort = "newest";

/** DEC84: match_tier 1 of the database is "exact", 2 is "close". */
export const MATCH_KINDS = ["exact", "close"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export function matchKindOf(tier: number): MatchKind {
  return tier === 1 ? "exact" : "close";
}

/** The six main categories on the home page; "other" is in the market's full list only. */
export const HOME_CATEGORY_KEYS = CategoryKey.filter((key) => key !== "other");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MarketFilters {
  /** NFC and trimmed, as typed; the database normalizes it (DEC67). Null without a query. */
  q: string | null;
  category: (typeof CategoryKey)[number] | null;
  condition: (typeof Condition)[number] | null;
  location: string | null;
  sort: ListingSort;
}

export interface MarketParamError {
  field: "q" | "category" | "condition" | "location" | "sort";
  code: "too_big" | "invalid_value" | "invalid_format";
}

export type MarketParamsResult =
  { ok: true; filters: MarketFilters } | { ok: false; errors: MarketParamError[] };

/** An absent or empty parameter is no filter. */
function value(params: URLSearchParams, name: string): string | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const text = normalizeText(raw);
  return text === "" ? null : text;
}

function oneOf<T extends string>(list: readonly T[], raw: string): raw is T {
  return (list as readonly string[]).includes(raw);
}

/**
 * The filters of API031 and of the /market URL (FR07 to FR11). Every problem at once, with the
 * contract's field codes; the normalized length of `q` is checked again by the database.
 */
export function parseMarketParams(params: URLSearchParams): MarketParamsResult {
  const errors: MarketParamError[] = [];
  const q = value(params, "q");
  if (q !== null && countChars(q) > MARKET_QUERY_RAW_MAX) {
    errors.push({ field: "q", code: "too_big" });
  }
  const category = value(params, "category");
  if (category !== null && !oneOf(CategoryKey, category)) {
    errors.push({ field: "category", code: "invalid_value" });
  }
  const condition = value(params, "condition");
  if (condition !== null && !oneOf(Condition, condition)) {
    errors.push({ field: "condition", code: "invalid_value" });
  }
  const location = value(params, "location");
  if (location !== null && !UUID.test(location)) {
    errors.push({ field: "location", code: "invalid_format" });
  }
  const sort = value(params, "sort") ?? DEFAULT_LISTING_SORT;
  if (!oneOf(LISTING_SORTS, sort)) {
    errors.push({ field: "sort", code: "invalid_value" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    filters: {
      q,
      category: category as MarketFilters["category"],
      condition: condition as MarketFilters["condition"],
      location: location === null ? null : location.toLowerCase(),
      sort: sort as ListingSort,
    },
  };
}

/** The URL query of a market page with these filters (FR12: no cursor, so the first page). */
export function marketSearchParams(filters: MarketFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q !== null) params.set("q", filters.q);
  if (filters.category !== null) params.set("category", filters.category);
  if (filters.condition !== null) params.set("condition", filters.condition);
  if (filters.location !== null) params.set("location", filters.location);
  if (filters.sort !== DEFAULT_LISTING_SORT) params.set("sort", filters.sort);
  if (cursor !== undefined) params.set("cursor", cursor);
  return params;
}
