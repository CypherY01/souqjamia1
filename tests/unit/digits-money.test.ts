import { describe, expect, it } from "vitest";
import { countChars, normalizeDigits, parseAmount, stripBidiControls } from "@souq/domain";

describe("DEC50 digits", () => {
  it("converts Arabic-Indic and extended Arabic-Indic digits to Western ones", () => {
    expect(normalizeDigits("٣٥٠")).toBe("350");
    expect(normalizeDigits("۳۵۰")).toBe("350");
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeDigits("سعر ٣٥ و 40")).toBe("سعر 35 و 40");
  });
});

describe("parseAmount: riyals to integer halalas, never rounded", () => {
  it.each([
    ["350", 35000],
    ["٣٥٠", 35000],
    ["350.5", 35050],
    ["350.50", 35050],
    ["٣٥٠٫٥٠", 35050],
    ["1,200", 120000],
    ["١٬٢٠٠", 120000],
    ["1,200,000.01", 120000001],
    [" 0 ", 0],
    ["0.99", 99],
    ["007", 700],
    ["50000", 5000000],
  ])("accepts %s as %i halalas", (input, halalas) => {
    expect(parseAmount(input)).toEqual({ ok: true, halalas });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["350.505", "too_many_decimals"],
    ["٣٥٠٫٥٠٥", "too_many_decimals"],
    ["1,20", "invalid"],
    ["1,2000", "invalid"],
    ["-5", "invalid"],
    ["+5", "invalid"],
    ["5e3", "invalid"],
    ["350 ريال", "invalid"],
    ["35،0", "invalid"],
    [".5", "invalid"],
    ["5.", "invalid"],
    ["1234567890", "too_large"],
  ])("rejects %j as %s", (input, error) => {
    expect(parseAmount(input)).toEqual({ ok: false, error });
  });
});

describe("text rules", () => {
  it("counts code points after NFC and trimming", () => {
    expect(countChars("  سوق  ")).toBe(3);
    expect(countChars("e\u0301")).toBe(1); // NFC composes e + accent into one code point
    expect(countChars("👍")).toBe(1);
  });

  it("TC31: removes bidi embedding, override and isolate controls, keeps marks", () => {
    expect(stripBidiControls("a\u202eb\u202cc\u2066d\u2069")).toBe("abcd");
    expect(stripBidiControls("a\u200fb\u200ec")).toBe("a\u200fb\u200ec");
  });
});
