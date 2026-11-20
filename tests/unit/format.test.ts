import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPrice,
  formatRelative,
  formatWait,
  t,
} from "@souq/i18n";

const HIDDEN_MARKS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/;

describe("DEC50 and task 1.5 owner decisions: display formats", () => {
  it("numbers use Western digits and thousands separators", () => {
    expect(formatNumber(350)).toBe("350");
    expect(formatNumber(1200350)).toBe("1,200,350");
    expect(() => formatNumber(1.5)).toThrow(RangeError);
  });

  it("money is halalas shown in riyals, halalas only when present, never rounded", () => {
    expect(formatMoney(35000)).toBe("350 ريال");
    expect(formatMoney(35050)).toBe("350.50 ريال");
    expect(formatMoney(35005)).toBe("350.05 ريال");
    expect(formatMoney(120000)).toBe("1,200 ريال");
    expect(formatMoney(99)).toBe("0.99 ريال");
    expect(formatMoney(5000000)).toBe("50,000 ريال");
    expect(() => formatMoney(100.5)).toThrow(RangeError);
    expect(() => formatMoney(-100)).toThrow(RangeError);
  });

  it("a zero price is shown as مجاني", () => {
    expect(formatPrice(0)).toBe("مجاني");
    expect(formatPrice(35000)).toBe("350 ريال");
  });

  it("dates are Gregorian with Arabic month names, in Riyadh time", () => {
    expect(formatDate("2026-11-18T12:00:00Z")).toBe("18 نوفمبر 2026");
    // 22:30 UTC is already the next day in Riyadh (UTC+3).
    expect(formatDate("2026-11-18T22:30:00Z")).toBe("19 نوفمبر 2026");
    expect(formatDateTime("2026-11-18T13:30:00Z")).toBe("الأربعاء، 18 نوفمبر 2026 في 4:30 م");
  });

  it("relative dates for cards", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(formatRelative(ago(10), now)).toBe("الآن");
    expect(formatRelative(ago(5 * 60), now)).toBe("قبل 5 دقائق");
    expect(formatRelative(ago(3 * 3600), now)).toBe("قبل 3 ساعات");
    expect(formatRelative(ago(26 * 3600), now)).toBe("أمس");
    expect(formatRelative(ago(3 * 86400), now)).toBe("قبل 3 أيام");
    expect(formatRelative(ago(8 * 86400), now)).toBe("10 نوفمبر 2026");
    expect(formatRelative(new Date(now.getTime() + 60_000), now)).toBe("18 نوفمبر 2026");
  });

  it("task 3.3: a wait from Retry-After, in seconds then whole minutes rounded up", () => {
    expect(formatWait(0.2)).toBe("خلال ثانية واحدة");
    expect(formatWait(45)).toBe("خلال 45 ثانية");
    expect(formatWait(60)).toBe("خلال دقيقة واحدة");
    expect(formatWait(61)).toBe("خلال دقيقتين");
    expect(formatWait(5 * 60)).toBe("خلال 5 دقائق");
    expect(formatWait(14 * 60 + 1)).toBe("خلال 15 دقيقة");
  });

  it("no output carries hidden direction marks", () => {
    const outputs = [
      formatNumber(1200350),
      formatMoney(35050),
      formatDate("2026-11-18T12:00:00Z"),
      formatDateTime("2026-11-18T13:30:00Z"),
      formatRelative(new Date("2026-11-18T09:00:00Z"), new Date("2026-11-18T12:00:00Z")),
      formatWait(5 * 60),
    ];
    for (const output of outputs) expect(output).not.toMatch(HIDDEN_MARKS);
  });
});

describe("t() placeholders", () => {
  it("fills {name} values and refuses a missing one", () => {
    expect(t("ui.charCount", { count: 12, max: 500 })).toBe("12 من 500 حرفاً");
    expect(() => t("ui.charCount", { count: 12 })).toThrow('Missing value "max"');
  });
});
