// Task 3.1, item 11 and DEC72: database errors to contract errors, and the retry delays.
// Real database errors for each row run in tests/integration/web-db.test.ts.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { MAX_TRANSIENT_RETRIES, retryDelayMs } from "../../apps/web/lib/db/app-client.ts";
import {
  apiErrorFromDb,
  isDatabaseFailure,
  isTransient,
  UNIQUE_CONSTRAINT_ERRORS,
} from "../../apps/web/lib/db/errors.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";

function dbError(code: string, message = "error", extra: Partial<pg.DatabaseError> = {}) {
  const error = new pg.DatabaseError(message, 0, "error");
  error.code = code;
  Object.assign(error, extra);
  return error;
}

const TRACE = "0".repeat(32);

describe("item 11: the mapping", () => {
  it("SJ001 keeps the contract code and the field rule", () => {
    const error = apiErrorFromDb(
      dbError("SJ001", "VALIDATION_FAILED", { detail: '{"field":"title","code":"too_small"}' }),
      TRACE,
    );
    expect([error.code, error.status, error.fieldErrors]).toEqual([
      "VALIDATION_FAILED",
      422,
      [{ field: "title", code: "too_small" }],
    ]);
    expect(apiErrorFromDb(dbError("SJ001", "BLOCKED"), TRACE).fieldErrors).toEqual([]);
  });

  it("RATE_LIMITED takes Retry-After from the detail, at least 1 second", () => {
    expect(
      apiErrorFromDb(dbError("SJ001", "RATE_LIMITED", { detail: '{"retry_after":17}' }), TRACE)
        .retryAfter,
    ).toBe(17);
    expect(
      apiErrorFromDb(dbError("SJ001", "RATE_LIMITED", { detail: "{}" }), TRACE).retryAfter,
    ).toBe(1);
  });

  it("an unknown SJ001 code, and INTERNAL_ERROR itself, are 500", () => {
    expect(apiErrorFromDb(dbError("SJ001", "NOPE"), TRACE).code).toBe("INTERNAL_ERROR");
    expect(apiErrorFromDb(dbError("SJ001", "INTERNAL_ERROR"), TRACE).code).toBe("INTERNAL_ERROR");
  });

  it("a unique violation maps by constraint name when registered, otherwise 500", () => {
    expect(UNIQUE_CONSTRAINT_ERRORS).toEqual({});
    const violation = dbError("23505", "duplicate", { constraint: "probe_one_per_pair" });
    expect(apiErrorFromDb(violation, TRACE).code).toBe("INTERNAL_ERROR");
    expect(apiErrorFromDb(violation, TRACE, { probe_one_per_pair: "STATE_CONFLICT" }).code).toBe(
      "STATE_CONFLICT",
    );
  });

  it.each(["40001", "40P01", "55P03", "57014", "57P01", "53300", "08006"])(
    "%s is 503 with Retry-After 1",
    (code) => {
      const error = apiErrorFromDb(dbError(code), TRACE);
      expect([error.code, error.status, error.retryAfter]).toEqual(["SERVICE_UNAVAILABLE", 503, 1]);
    },
  );

  it("a refused or lost connection is 503", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNREFUSED",
    });
    expect(apiErrorFromDb(refused, TRACE).code).toBe("SERVICE_UNAVAILABLE");
    expect(apiErrorFromDb(new Error("Connection terminated unexpectedly"), TRACE).code).toBe(
      "SERVICE_UNAVAILABLE",
    );
    expect(isDatabaseFailure(refused)).toBe(true);
  });

  it("other database errors are 500; an ApiError passes unchanged; a bug is not a database failure", () => {
    expect(apiErrorFromDb(dbError("22012"), TRACE).code).toBe("INTERNAL_ERROR");
    const own = new ApiError("NOT_FOUND");
    expect(apiErrorFromDb(own, TRACE)).toBe(own);
    expect(isDatabaseFailure(new TypeError("x is undefined"))).toBe(false);
  });
});

describe("DEC72: what is retried, and how long it waits", () => {
  it("retries only serialization failures and deadlocks", () => {
    expect(isTransient(dbError("40001"))).toBe(true);
    expect(isTransient(dbError("40P01"))).toBe(true);
    for (const code of ["55P03", "57014", "23505", "SJ001"]) {
      expect(isTransient(dbError(code)), code).toBe(false);
    }
    expect(isTransient(new Error("Connection terminated unexpectedly"))).toBe(false);
  });

  it("three retries, about 20, 40 and 80 ms, each with up to as much again of jitter", () => {
    expect(MAX_TRANSIENT_RETRIES).toBe(3);
    for (let i = 0; i < 50; i++) {
      for (const [retry, base] of [
        [1, 20],
        [2, 40],
        [3, 80],
      ] as const) {
        const delay = retryDelayMs(retry);
        expect(delay).toBeGreaterThanOrEqual(base);
        expect(delay).toBeLessThan(base * 2);
      }
    }
  });
});
