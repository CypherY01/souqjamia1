import { describe, expect, it } from "vitest";
import { clientIp } from "../../apps/web/lib/http/client-ip.ts";
import {
  decodeCursor,
  encodeCursor,
  MAX_CURSOR_LENGTH,
  parseLimit,
} from "../../apps/web/lib/http/cursor.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import {
  checkReadiness,
  JOB_QUEUE_MAX_DUE_SECONDS,
  probeTokenMatches,
  queueHealthy,
} from "../../apps/web/lib/http/readiness.ts";
import type { AppDb } from "../../apps/web/lib/db/app-client.ts";
import type pg from "pg";

// Built at run time: the repository never contains a secret-like string.
const SECRET = ["cursor", "test", "secret", "q".repeat(32)].join("-");
const OTHER_SECRET = ["cursor", "other", "secret", "r".repeat(32)].join("-");

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return "none";
}

describe("TC29 and NFR14: signed cursor bound to filters and order", () => {
  const filters = { q: "كتاب", category: "books", sort: "price_asc" };
  // Equal prices page by the stable secondary id.
  const keys = [35000, "0193c0de-0000-7000-8000-000000000001"];
  const cursor = encodeCursor(SECRET, keys, filters);

  it("gives the keys back for the same filters, in any key order", () => {
    expect(decodeCursor(SECRET, cursor, filters)).toEqual(keys);
    expect(
      decodeCursor(SECRET, cursor, { sort: "price_asc", category: "books", q: "كتاب" }),
    ).toEqual(keys);
    expect(cursor.length).toBeLessThan(MAX_CURSOR_LENGTH);
  });

  it.each([
    ["a changed filter", () => decodeCursor(SECRET, cursor, { ...filters, category: "furniture" })],
    ["a changed order", () => decodeCursor(SECRET, cursor, { ...filters, sort: "price_desc" })],
    ["an added filter", () => decodeCursor(SECRET, cursor, { ...filters, urgent: true })],
    [
      "an edited payload",
      () => {
        const [payload = "", signature = ""] = cursor.split(".");
        const edited = Buffer.from(
          Buffer.from(payload, "base64url").toString().replace("35000", "1"),
        ).toString("base64url");
        return decodeCursor(SECRET, `${edited}.${signature}`, filters);
      },
    ],
    ["an edited signature", () => decodeCursor(SECRET, `${cursor.slice(0, -1)}A`, filters)],
    ["another secret", () => decodeCursor(OTHER_SECRET, cursor, filters)],
    ["garbage", () => decodeCursor(SECRET, "not-a-cursor", filters)],
    [
      "a cursor over 512 characters",
      () => decodeCursor(SECRET, `${"a".repeat(470)}.${"b".repeat(43)}`, filters),
    ],
  ])("rejects %s with INVALID_CURSOR", (_name, fn) => {
    expect(errorCode(fn)).toBe("INVALID_CURSOR");
  });

  it("limit: 20 by default, 1 to 50, anything else is BAD_REQUEST", () => {
    expect(parseLimit(null)).toBe(20);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("50")).toBe(50);
    for (const value of ["0", "51", "-1", "1.5", "abc", "", "1e1"]) {
      expect(errorCode(() => parseLimit(value))).toBe("BAD_REQUEST");
    }
  });
});

describe("SEC07 client address from the trusted proxy chain", () => {
  it("has no address without a trusted proxy (local development)", () => {
    expect(clientIp("203.0.113.9", 0)).toBeNull();
    expect(clientIp(null, 1)).toBeNull();
  });

  it("ignores entries the client wrote itself", () => {
    expect(clientIp("203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.0.2", 2)).toBe("203.0.113.9");
    expect(clientIp("2001:db8::1", 1)).toBe("2001:db8::1");
  });

  it("refuses a chain shorter than the trusted hops, or a value that is not an address", () => {
    expect(clientIp("203.0.113.9", 2)).toBeNull();
    expect(clientIp("6.6.6.6, not-an-address", 1)).toBeNull();
  });
});

describe("API106 readiness", () => {
  const config = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["sb", "publishable", "test"].join("_"),
  };

  // Task 3.1: a fake database answering app.job_queue_health(), or failing.
  function fakeDb(health: { oldest_due_seconds: number; dead_last_24h: number } | Error): AppDb {
    return {
      withActor: () => Promise.reject(new Error("not used")),
      query: <R extends pg.QueryResultRow>() =>
        health instanceof Error
          ? Promise.reject(health)
          : Promise.resolve({ rows: [health] } as unknown as pg.QueryResult<R>),
      end: () => Promise.resolve(),
    };
  }
  const healthyDb = fakeDb({ oldest_due_seconds: 0, dead_last_24h: 0 });
  const authUp = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;

  it("compares the probe token exactly", () => {
    const token = "p".repeat(40);
    expect(probeTokenMatches(token, token)).toBe(true);
    expect(probeTokenMatches(`${token}x`, token)).toBe(false);
    expect(probeTokenMatches("p".repeat(39), token)).toBe(false);
    expect(probeTokenMatches(null, token)).toBe(false);
  });

  it("is ready when Supabase Auth answers its health check", async () => {
    let called = "";
    let apikey: string | null = null;
    const fetcher = ((input: URL, init?: RequestInit) => {
      called = String(input);
      apikey = new Headers(init?.headers).get("apikey");
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    await expect(checkReadiness(config, healthyDb, "t", fetcher)).resolves.toEqual({
      status: "ready",
      checks: { supabase_auth: true, database: true, job_queue: true },
    });
    expect(called).toBe("http://127.0.0.1:54321/auth/v1/health");
    expect(apikey).toBe(config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  });

  it.each([
    ["an error status", () => Promise.resolve(new Response("", { status: 500 }))],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
  ])("is not ready on %s, without the error details", async (_name, impl) => {
    const result = await checkReadiness(config, healthyDb, "t", impl);
    expect(result).toEqual({
      status: "not_ready",
      checks: { supabase_auth: false, database: true, job_queue: true },
    });
  });

  it("task 3.1: not ready without the database, and the queue is down with it", async () => {
    const result = await checkReadiness(config, fakeDb(new Error("down")), "t", authUp);
    expect(result).toEqual({
      status: "not_ready",
      checks: { supabase_auth: true, database: false, job_queue: false },
    });
  });

  it.each([
    ["a due job waiting over 10 minutes", { oldest_due_seconds: 601, dead_last_24h: 0 }],
    ["a dead job in the last 24 hours", { oldest_due_seconds: 0, dead_last_24h: 1 }],
  ])("task 3.1, item 13: %s marks the queue, and the site stays ready", async (_name, health) => {
    const result = await checkReadiness(config, fakeDb(health), "t", authUp);
    expect(result).toEqual({
      status: "ready",
      checks: { supabase_auth: true, database: true, job_queue: false },
    });
  });

  it("task 3.1, item 13: a due job of exactly 10 minutes is still on time", () => {
    expect(queueHealthy({ oldest_due_seconds: JOB_QUEUE_MAX_DUE_SECONDS, dead_last_24h: 0 })).toBe(
      true,
    );
  });
});
