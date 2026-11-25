// Task 4.3: the market URL (FR07 to FR12, DEC84), the join month of a seller and plain member
// text inside a card's own link. The database side is in tests/integration/market.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HOME_CATEGORY_KEYS,
  MARKET_QUERY_RAW_MAX,
  marketSearchParams,
  matchKindOf,
  parseMarketParams,
} from "@souq/domain";
import { formatMonth } from "@souq/i18n";
import { SafeText } from "../../apps/web/components/text/SafeText.tsx";

const POINT = "0f2b6c1e-8d3a-4b5c-9e7f-112233445566";

describe("FR07 to FR12: the market URL", () => {
  it("no parameter is the default view: every filter empty, newest first (FR12)", () => {
    expect(parseMarketParams(new URLSearchParams())).toEqual({
      ok: true,
      filters: { q: null, category: null, condition: null, location: null, sort: "newest" },
    });
  });

  it("reads every filter, trims the query and keeps it as typed (DEC67 runs in the database)", () => {
    const params = new URLSearchParams({
      q: "  طاولة  دراسة ",
      category: "room_furniture",
      condition: "good",
      location: POINT.toUpperCase(),
      sort: "price_desc",
    });
    expect(parseMarketParams(params)).toEqual({
      ok: true,
      filters: {
        q: "طاولة  دراسة",
        category: "room_furniture",
        condition: "good",
        location: POINT,
        sort: "price_desc",
      },
    });
  });

  it("an empty parameter is no filter, as the GET form sends them", () => {
    const parsed = parseMarketParams(
      new URLSearchParams("q=&category=&condition=&location=&sort="),
    );
    expect(parsed).toEqual({
      ok: true,
      filters: { q: null, category: null, condition: null, location: null, sort: "newest" },
    });
  });

  it("every bad value at once, with the contract's field codes", () => {
    expect(
      parseMarketParams(
        new URLSearchParams({
          q: "ب".repeat(MARKET_QUERY_RAW_MAX + 1),
          category: "cars",
          condition: "broken",
          location: "12",
          sort: "relevance",
        }),
      ),
    ).toEqual({
      ok: false,
      errors: [
        { field: "q", code: "too_big" },
        { field: "category", code: "invalid_value" },
        { field: "condition", code: "invalid_value" },
        { field: "location", code: "invalid_format" },
        { field: "sort", code: "invalid_value" },
      ],
    });
  });

  it("the raw query limit counts code points, not UTF-16 units", () => {
    const emoji = "😀".repeat(MARKET_QUERY_RAW_MAX);
    expect(parseMarketParams(new URLSearchParams({ q: emoji })).ok).toBe(true);
  });

  it("a page URL keeps the filters and drops the default order; the form never sends a cursor", () => {
    const filters = {
      q: "لابتوب",
      category: null,
      condition: "like_new" as const,
      location: null,
      sort: "newest" as const,
    };
    expect(marketSearchParams(filters).toString()).toBe(
      new URLSearchParams({ q: "لابتوب", condition: "like_new" }).toString(),
    );
    expect(marketSearchParams({ ...filters, sort: "price_asc" }, "c1").get("cursor")).toBe("c1");
    const round = parseMarketParams(marketSearchParams({ ...filters, sort: "price_asc" }));
    expect(round).toEqual({ ok: true, filters: { ...filters, sort: "price_asc" } });
  });

  it("DEC84: tier 1 is exact, tier 2 is close", () => {
    expect(matchKindOf(1)).toBe("exact");
    expect(matchKindOf(2)).toBe("close");
  });

  it("the home page shows six main categories, «أخرى» only in the market's list", () => {
    expect(HOME_CATEGORY_KEYS).toHaveLength(6);
    expect(HOME_CATEGORY_KEYS).not.toContain("other");
  });
});

describe("the seller's join month", () => {
  it("YYYY-MM as an Arabic month name with Western digits, whatever the time zone", () => {
    expect(formatMonth("2026-11")).toBe("نوفمبر 2026");
    expect(formatMonth("2027-01")).toBe("يناير 2027");
    expect(() => formatMonth("2026-13")).toThrow(RangeError);
    expect(() => formatMonth("2026-1")).toThrow(RangeError);
  });
});

describe("TC31 SafeText inside a link of our own (a card's title)", () => {
  it("links={false} keeps URLs as plain text, escapes HTML and drops bidi controls", () => {
    const text = `<b>لابتوب</b> https://example.test/x ${String.fromCodePoint(0x202e)}abc`;
    const html = renderToStaticMarkup(
      createElement(SafeText, { text, newTabLabel: "يفتح في تبويب جديد", links: false }),
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("https://example.test/x");
    expect(html).not.toContain(String.fromCodePoint(0x202e));
  });
});
