// DEC32, BR24, FR01: the password and email rules of task 3.2 (item 1), shared by the browser
// and the server (packages/domain).
import { describe, expect, it } from "vitest";
import {
  checkPassword,
  parseEmail,
  passwordHints,
  PASSWORD_COUNT_AFTER,
  passwordBytes,
  passwordLength,
  PASSWORD_MAX,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
} from "@souq/domain";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

describe("checkPassword (DEC32)", () => {
  it("the limits are 8 to 64 code points and 72 UTF-8 bytes", () => {
    expect([PASSWORD_MIN, PASSWORD_MAX, PASSWORD_MAX_BYTES]).toEqual([8, 64, 72]);
  });

  it("refuses 7, accepts 8 and 64, refuses 65 (the boundary test of section 4.4)", () => {
    expect(checkPassword("a".repeat(7))).toBe("too_short");
    expect(checkPassword("a".repeat(8))).toBeNull();
    expect(checkPassword("a".repeat(64))).toBeNull();
    expect(checkPassword("a".repeat(65))).toBe("too_long");
    expect(checkPassword("")).toBe("too_short");
  });

  it("Arabic letters and emoji reach 72 bytes before 64 characters, and are refused uncut", () => {
    // Arabic letters take 2 bytes: 36 fit, 37 do not.
    expect(checkPassword(cp(0x643).repeat(36))).toBeNull();
    expect(passwordBytes(cp(0x643).repeat(37))).toBe(74);
    expect(checkPassword(cp(0x643).repeat(37))).toBe("too_many_bytes");
    // An emoji is one code point of 4 bytes: 18 fit, 19 do not.
    expect(passwordLength(cp(0x1f600).repeat(19))).toBe(19);
    expect(checkPassword(cp(0x1f600).repeat(18))).toBeNull();
    expect(checkPassword(cp(0x1f600).repeat(19))).toBe("too_many_bytes");
  });

  it("counts code points, not UTF-16 units", () => {
    expect(passwordLength(cp(0x1f600))).toBe(1);
    expect(checkPassword(`abcdefg${cp(0x1f600)}`)).toBeNull();
  });

  it("never trims or normalizes: outer spaces are part of the password", () => {
    expect(checkPassword(" abcdef ")).toBeNull();
    expect(passwordLength("  abc  ")).toBe(7);
    expect(checkPassword("  abc  ")).toBe("too_short");
    // Decomposed alef with madda stays two code points (no NFC).
    expect(passwordLength(cp(0x627, 0x653))).toBe(2);
  });

  it("needs no character classes", () => {
    expect(checkPassword("aaaaaaaa")).toBeNull();
    expect(checkPassword("12345678")).toBeNull();
    expect(checkPassword(cp(0x643).repeat(8))).toBeNull();
  });
});

describe("passwordHints (DEC75: the limits show only near them)", () => {
  it("no count up to 56 characters, the count from 57", () => {
    expect(PASSWORD_COUNT_AFTER).toBe(56);
    expect(passwordHints("")).toEqual({ count: false, tooManyBytes: false });
    expect(passwordHints("a".repeat(8))).toEqual({ count: false, tooManyBytes: false });
    expect(passwordHints("a".repeat(56))).toEqual({ count: false, tooManyBytes: false });
    expect(passwordHints("a".repeat(57))).toEqual({ count: true, tooManyBytes: false });
    expect(passwordHints("a".repeat(65))).toEqual({ count: true, tooManyBytes: false });
  });

  it("past 72 bytes: the count and the notice, even well under 56 characters", () => {
    expect(passwordHints(cp(0x643).repeat(36))).toEqual({ count: false, tooManyBytes: false });
    expect(passwordHints(cp(0x643).repeat(37))).toEqual({ count: true, tooManyBytes: true });
    expect(passwordHints(cp(0x1f600).repeat(19))).toEqual({ count: true, tooManyBytes: true });
  });
});

describe("parseEmail (DEC26: any valid address)", () => {
  it("accepts any domain, trims, and keeps the address as typed", () => {
    expect(parseEmail("  Sara@Example.com ")).toEqual({ ok: true, value: "Sara@Example.com" });
    expect(parseEmail("a.b+tag@mail.example.test")).toEqual({
      ok: true,
      value: "a.b+tag@mail.example.test",
    });
  });

  it("names the rule a wrong address breaks", () => {
    expect(parseEmail("   ")).toEqual({ ok: false, error: "required" });
    for (const value of ["no-at", "a@b", "a@@b.com", ".a@b.com", "a..b@c.com", "a b@c.com"]) {
      expect(parseEmail(value), value).toEqual({ ok: false, error: "invalid_format" });
    }
    expect(parseEmail(`${"a".repeat(250)}@b.co`)).toEqual({ ok: false, error: "too_big" });
  });
});
