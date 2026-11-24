// Task 4.2 (FR18, FR19, BR04 to BR08, DEC04, DEC05, DEC50, section 6.3, TC08): the listing rules
// of @souq/domain that the wizard and the server share. The database has the same rules
// (tests/integration/listings-publish.test.ts compares them).
import { describe, expect, it } from "vitest";
import {
  firstStepOf,
  LISTING_DESCRIPTION_MAX,
  LISTING_TITLE_MAX,
  listingFieldErrors,
  listingTextLength,
  normalizeDescription,
  parseListingDescription,
  parseListingPrice,
  parseListingTitle,
  stepOfField,
} from "@souq/domain";

const RLO = String.fromCodePoint(0x202e);
const COMBINING_FATHA = String.fromCodePoint(0x064e);

describe("DEC04 BR05: the title and the description", () => {
  it("TC08 a title of 100 code points is accepted and 101 is rejected", () => {
    expect(parseListingTitle("ق".repeat(LISTING_TITLE_MAX))).toEqual({
      ok: true,
      value: "ق".repeat(LISTING_TITLE_MAX),
    });
    expect(parseListingTitle("ق".repeat(LISTING_TITLE_MAX + 1))).toEqual({
      ok: false,
      error: "too_big",
    });
    // 100 emoji are 200 UTF-16 units and still 100 characters.
    expect(parseListingTitle(String.fromCodePoint(0x1f4da).repeat(LISTING_TITLE_MAX)).ok).toBe(
      true,
    );
    expect(parseListingTitle("قققق")).toEqual({ ok: false, error: "too_small" });
    expect(parseListingTitle("   ")).toEqual({ ok: false, error: "required" });
  });

  it("the title is stored after NFC and trimming, and refuses controls and bidi overrides", () => {
    expect(parseListingTitle("  مكتب خشبي  ")).toEqual({ ok: true, value: "مكتب خشبي" });
    // A decomposed character is counted after NFC.
    expect(parseListingTitle(`e${String.fromCodePoint(0x0301)}cole`)).toEqual({
      ok: true,
      value: `${String.fromCodePoint(0x00e9)}cole`,
    });
    expect(parseListingTitle(`عنوان${RLO}مقلوب`)).toEqual({ ok: false, error: "invalid_format" });
    expect(parseListingTitle("سطر\nثانٍ")).toEqual({ ok: false, error: "invalid_format" });
    // Diacritics are kept as typed (the search copy drops them, DEC67).
    expect(parseListingTitle(`كتاب${COMBINING_FATHA} جديد`).ok).toBe(true);
  });

  it("TC08 a description of 10 and 2000 is accepted, 9 and 2001 are rejected, line breaks kept", () => {
    expect(parseListingDescription("و".repeat(10)).ok).toBe(true);
    expect(parseListingDescription("و".repeat(LISTING_DESCRIPTION_MAX)).ok).toBe(true);
    expect(parseListingDescription("و".repeat(9))).toEqual({ ok: false, error: "too_small" });
    expect(parseListingDescription("و".repeat(LISTING_DESCRIPTION_MAX + 1))).toEqual({
      ok: false,
      error: "too_big",
    });
    expect(parseListingDescription("السطر الأول\r\nالثاني\rالثالث\tمع مسافة")).toEqual({
      ok: true,
      value: "السطر الأول\nالثاني\nالثالث\tمع مسافة",
    });
    expect(parseListingDescription(`وصف فيه ${RLO} رمز`)).toEqual({
      ok: false,
      error: "invalid_format",
    });
    expect(normalizeDescription("  \r\nنص\r\n  ")).toBe("نص");
    expect(listingTextLength("ab\r\ncd")).toBe(5);
  });
});

describe("DEC05 DEC50 BR07: the price in riyals, never rounded", () => {
  it("TC08 0, 50,000 and Arabic-Indic digits are accepted; 50,000.01 and three decimals are not", () => {
    expect(parseListingPrice("0")).toEqual({ ok: true, halalas: 0 });
    expect(parseListingPrice("50,000")).toEqual({ ok: true, halalas: 5_000_000 });
    expect(parseListingPrice("50000.00")).toEqual({ ok: true, halalas: 5_000_000 });
    expect(parseListingPrice("٣٥٠٫٥٠")).toEqual({ ok: true, halalas: 35_050 });
    expect(parseListingPrice("50000.01")).toEqual({ ok: false, error: "too_large" });
    expect(parseListingPrice("350.505")).toEqual({ ok: false, error: "too_many_decimals" });
    expect(parseListingPrice("-5")).toEqual({ ok: false, error: "invalid" });
    expect(parseListingPrice("")).toEqual({ ok: false, error: "empty" });
  });
});

describe("the field rules past the structure", () => {
  const valid = {
    title: "مكتب خشبي",
    description: "مكتب بحالة جيدة مع درج",
    price_minor: 100,
    is_negotiable: true,
    media_ids: ["a", "b"],
  };

  it("BR08 a free item cannot be negotiable, and an image cannot appear twice", () => {
    expect(listingFieldErrors(valid)).toEqual([]);
    expect(listingFieldErrors({ ...valid, price_minor: 0 })).toEqual([
      { field: "is_negotiable", code: "not_allowed" },
    ]);
    expect(listingFieldErrors({ ...valid, media_ids: ["a", "a"] })).toEqual([
      { field: "media_ids", code: "duplicate" },
    ]);
  });

  it("every problem comes back at once", () => {
    expect(listingFieldErrors({ ...valid, title: "", description: "قصير" })).toEqual([
      { field: "title", code: "required" },
      { field: "description", code: "too_small" },
    ]);
  });
});

describe("section 6.3: a server error goes back to the step of the wrong field", () => {
  it("each field has its step, and the earliest one wins", () => {
    expect(stepOfField("media_ids.3")).toBe(1);
    expect(stepOfField("title")).toBe(2);
    expect(stepOfField("condition")).toBe(2);
    expect(stepOfField("price_minor")).toBe(3);
    expect(stepOfField("is_negotiable")).toBe(3);
    expect(stepOfField("location_id")).toBe(4);
    expect(stepOfField("something_else")).toBe(5);
    expect(firstStepOf(["location_id", "description", "price_minor"])).toBe(2);
    expect(firstStepOf([])).toBe(5);
  });
});
