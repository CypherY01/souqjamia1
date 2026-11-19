// FR01, DEC03, chapter 09: display name rule in packages/domain (task 2.2).
import { describe, expect, it } from "vitest";
import { parseDisplayName } from "@souq/domain";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

describe("parseDisplayName", () => {
  it("accepts 2 to 50 code points after NFC and outer trim, and returns the stored value", () => {
    expect(parseDisplayName("  سارة  ")).toEqual({ ok: true, value: "سارة" });
    expect(parseDisplayName("ab")).toEqual({ ok: true, value: "ab" });
    expect(parseDisplayName("ن".repeat(50))).toEqual({ ok: true, value: "ن".repeat(50) });
    // alef + combining madda is stored composed (item 4)
    expect(parseDisplayName(`${cp(0x627, 0x653)}دم`)).toEqual({
      ok: true,
      value: `${cp(0x622)}دم`,
    });
    // emoji count as one code point each
    expect(parseDisplayName(cp(0x1f600, 0x1f600))).toEqual({
      ok: true,
      value: cp(0x1f600, 0x1f600),
    });
  });

  it("rejects empty, too short and too long names", () => {
    expect(parseDisplayName("   ")).toEqual({ ok: false, error: "required" });
    expect(parseDisplayName(" س ")).toEqual({ ok: false, error: "too_small" });
    expect(parseDisplayName("ن".repeat(51))).toEqual({ ok: false, error: "too_big" });
  });

  it("TC31: rejects control characters and bidi embeddings, overrides and isolates", () => {
    for (const code of [0x01, 0x0a, 0x1b, 0x7f, 0x85, 0x202a, 0x202e, 0x2066, 0x2069]) {
      expect(parseDisplayName(`اسم${cp(code)}عضو`), code.toString(16)).toEqual({
        ok: false,
        error: "invalid_format",
      });
    }
  });

  it("keeps marks that only shape Arabic text (ZWNJ, LRM, RLM)", () => {
    for (const code of [0x200c, 0x200e, 0x200f]) {
      expect(parseDisplayName(`اسم${cp(code)}عضو`).ok, code.toString(16)).toBe(true);
    }
  });
});
