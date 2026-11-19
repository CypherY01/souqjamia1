// Task 3.1, item 12 (DEC70, SEC07): counter keys are HMAC fingerprints, never the clear value.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveKey } from "../../apps/web/lib/http/keys.ts";
import { fingerprint, rateLimited } from "../../apps/web/lib/http/rate-limit.ts";

// Built at run time: the repository never contains a secret-like string.
const SECRET = ["rate", "limit", "test", "s".repeat(32)].join("-");
const OTHER = ["rate", "limit", "other", "o".repeat(32)].join("-");

describe("item 12: fingerprints", () => {
  it("32 bytes, stable for the same secret and value", () => {
    const key = fingerprint(SECRET, "ip", "203.0.113.7");
    expect(key).toHaveLength(32);
    expect(fingerprint(SECRET, "ip", "203.0.113.7").equals(key)).toBe(true);
  });

  it("differs by secret, by kind and by value, and is not a plain hash", () => {
    const key = fingerprint(SECRET, "email", "member@example.test");
    expect(fingerprint(OTHER, "email", "member@example.test").equals(key)).toBe(false);
    expect(fingerprint(SECRET, "guest", "member@example.test").equals(key)).toBe(false);
    expect(fingerprint(SECRET, "email", "other@example.test").equals(key)).toBe(false);
    const plain = createHash("sha256").update("email:member@example.test").digest();
    expect(plain.equals(key)).toBe(false);
  });

  it("an email counts the same whatever its case and surrounding spaces", () => {
    expect(
      fingerprint(SECRET, "email", "  Member@Example.TEST ").equals(
        fingerprint(SECRET, "email", "member@example.test"),
      ),
    ).toBe(true);
    // Addresses and guest ids are taken as they are.
    expect(fingerprint(SECRET, "guest", "AbC").equals(fingerprint(SECRET, "guest", "abc"))).toBe(
      false,
    );
  });

  it("uses its own key purpose, separate from CSRF and cursors", () => {
    const rateKey = deriveKey(SECRET, "rate-limit");
    expect(rateKey.equals(deriveKey(SECRET, "csrf"))).toBe(false);
    expect(rateKey.equals(deriveKey(SECRET, "cursor"))).toBe(false);
  });

  it("an exhausted limit is 429 with Retry-After of at least one second", () => {
    expect([rateLimited(42).status, rateLimited(42).retryAfter]).toEqual([429, 42]);
    expect(rateLimited(0.2).retryAfter).toBe(1);
  });
});
