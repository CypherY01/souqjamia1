// Task 4.3, owner condition on item 9: pnpm review:listings writes to the local Supabase only
// (localhost or 127.0.0.1) and stops with a clear message otherwise, before any connection.
import { describe, expect, it, vi } from "vitest";
import { countChars } from "@souq/domain";
import {
  REVIEW_LISTINGS,
  seedReviewListings,
  type ReviewDeps,
} from "../../scripts/review-listings.ts";
import { assertReviewTarget, NotLocalTargetError } from "../../scripts/review-target.ts";

const LOCAL_API = "http://127.0.0.1:54321";
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function recordingDeps(): ReviewDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    connect: vi.fn((url: string) => {
      calls.push(`connect ${url}`);
      return Promise.reject(new Error("must not connect"));
    }),
    fetch: vi.fn<typeof fetch>((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(`fetch ${url}`);
      return Promise.reject(new Error("must not fetch"));
    }),
  };
}

describe("review:listings runs on the local Supabase only (owner condition on task 4.3, item 9)", () => {
  it("accepts localhost and 127.0.0.1, for the API and the database", () => {
    expect(() => {
      assertReviewTarget(LOCAL_API, "API");
    }).not.toThrow();
    expect(() => {
      assertReviewTarget("http://localhost:54321", "API");
    }).not.toThrow();
    expect(() => {
      assertReviewTarget(LOCAL_DB, "DB");
    }).not.toThrow();
    expect(() => {
      assertReviewTarget("postgresql://postgres:postgres@localhost:54322/postgres", "DB");
    }).not.toThrow();
  });

  it.each([
    "https://abcdefghijklmnop.supabase.co",
    "postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres",
    "http://127.0.0.1.example.test:54321",
    "http://localhost.example.test:54321",
    "http://[::1]:54321",
    "http://10.0.0.5:54321",
    "not a url",
  ])("refuses %s with a clear message", (url) => {
    expect(() => {
      assertReviewTarget(url, "عنوان Supabase");
    }).toThrow(NotLocalTargetError);
    expect(() => {
      assertReviewTarget(url, "عنوان Supabase");
    }).toThrow(/Supabase المحلي فقط \(localhost أو 127\.0\.0\.1\).*فتوقف السكربت ولم يكتب شيئاً/);
  });

  it("stops before any connection when the API is not local", async () => {
    const deps = recordingDeps();
    await expect(
      seedReviewListings(
        { apiUrl: "https://abcdefghijklmnop.supabase.co", secretKey: "x", dbUrl: LOCAL_DB },
        deps,
      ),
    ).rejects.toThrow(NotLocalTargetError);
    expect(deps.calls).toEqual([]);
  });

  it("stops before any connection when the database is not local", async () => {
    const deps = recordingDeps();
    await expect(
      seedReviewListings(
        {
          apiUrl: LOCAL_API,
          secretKey: "x",
          dbUrl: "postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres",
        },
        deps,
      ),
    ).rejects.toThrow(/عنوان القاعدة يشير إلى db\.abcdefghijklmnop\.supabase\.co/);
    expect(deps.calls).toEqual([]);
  });

  it("has about twenty clearly fake listings within the listing rules", () => {
    expect(REVIEW_LISTINGS.length).toBe(20);
    for (const item of REVIEW_LISTINGS) {
      expect(item.title).toMatch(/تجريبي/);
      expect(countChars(item.title)).toBeGreaterThanOrEqual(5);
      expect(countChars(item.title)).toBeLessThanOrEqual(100);
      // BR08: a free item is not negotiable.
      if (item.priceMinor === 0) expect(item.negotiable).toBe(false);
    }
  });
});
