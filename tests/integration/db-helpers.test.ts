// Shared database helpers (task 2.1): identity, time, text normalization (DEC67) and errors.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { normalizeText } from "@souq/domain";
import { contractSchemas } from "../support/contract.ts";
import { PRODUCTION_APP_NOW_BODY, advanceClock, setClock } from "./_harness/clock.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { MIGRATIONS_DIR } from "./_harness/global-setup.ts";
import { withTwoConnections } from "./_harness/parallel.ts";
import { actAs, memberClaims } from "./_harness/roles.ts";

afterAll(closeDb);

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

describe("DEC36: app.actor_id() and the identity of one transaction", () => {
  it("returns the sub of verified member claims set for this transaction", async () => {
    const claims = memberClaims();
    const id = await rolledBack(async (client) => {
      await actAs(client, "postgres", claims);
      return scalar<string>(client, "select app.actor_id()");
    });
    expect(id).toBe(claims.sub);
  });

  it.each([
    ["no claims", undefined],
    ["empty claims", ""],
    ["claims that are not JSON", "not json"],
    ["a JSON array", "[]"],
    ["no sub", JSON.stringify({ role: "authenticated" })],
    ["a sub that is not a uuid", JSON.stringify({ sub: "1 or 1=1", role: "authenticated" })],
    [
      "an anon token",
      JSON.stringify({ sub: "6f1c2a9e-0b7d-4c1e-9f3a-2d5b8e7c4a10", role: "anon" }),
    ],
  ])("fails closed with UNAUTHENTICATED (SJ001) for %s", async (_name, claims) => {
    const error = await rolledBack(async (client) => {
      await actAs(client, "postgres", claims);
      return dbError(client, "select app.actor_id()");
    });
    expect(error.code).toBe("SJ001");
    expect(error.message).toBe("UNAUTHENTICATED");
  });

  it("owner condition 2: the identity does not reach the next transaction on the same connection", async () => {
    const client = await dbPool().connect();
    try {
      const claims = memberClaims();
      for (const end of ["commit", "rollback"]) {
        await client.query("begin");
        await actAs(client, "postgres", claims);
        expect(await scalar<string>(client, "select app.actor_id()")).toBe(claims.sub);
        await client.query(end);

        await client.query("begin");
        const error = await dbError(client, "select app.actor_id()");
        expect(error.message).toBe("UNAUTHENTICATED");
        expect(
          await scalar<string>(client, "select current_setting('request.jwt.claims', true)"),
        ).toBe("");
        await client.query("rollback");
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("two parallel connections each see only their own identity", async () => {
    const first = memberClaims();
    const second = memberClaims();
    await withTwoConnections(async (a, b) => {
      await a.query("begin");
      await b.query("begin");
      await actAs(a, "postgres", first);
      await actAs(b, "postgres", second);
      expect(await scalar<string>(a, "select app.actor_id()")).toBe(first.sub);
      expect(await scalar<string>(b, "select app.actor_id()")).toBe(second.sub);
    });
  });

  it("an entry point runs for souq_web only, and only through the entry point", async () => {
    const claims = memberClaims();
    await rolledBack(async (client) => {
      // The pattern every entry point follows (owner condition 3).
      await client.query(`create function app.probe_whoami() returns uuid
        language sql security definer set search_path = ''
        as 'select app.actor_id()'`);
      await client.query("grant execute on function app.probe_whoami() to souq_web");

      await client.query("savepoint as_web");
      await actAs(client, "souq_web", claims);
      expect(await scalar<string>(client, "select app.probe_whoami()")).toBe(claims.sub);
      // Internal helpers have no grant: the server cannot skip an entry point's checks.
      expect((await dbError(client, "select app.actor_id()")).code).toBe("42501");
      expect((await dbError(client, "select app.app_now()")).code).toBe("42501");
      await client.query("rollback to savepoint as_web");

      for (const role of ["anon", "authenticated", "service_role", "souq_worker"] as const) {
        await client.query("savepoint as_other");
        await actAs(client, role, claims);
        expect((await dbError(client, "select app.probe_whoami()")).code).toBe("42501");
        await client.query("rollback to savepoint as_other");
      }
    });
  });
});

describe("item 5: app.app_now() and the test clock", () => {
  it("the migration's app.app_now() is the transaction time only", () => {
    expect(inject("appNowMigrationBody")).toBe(PRODUCTION_APP_NOW_BODY);
    const helpers = readdirSync(MIGRATIONS_DIR).find((file) => file.endsWith("_helpers.sql"));
    const sql = readFileSync(join(MIGRATIONS_DIR, helpers ?? "missing"), "utf8");
    expect(sql).toContain(`as $$ ${PRODUCTION_APP_NOW_BODY} $$;`);
    expect(sql).not.toContain("app_test");
  });

  it("follows the transaction time when no test time is set", async () => {
    const same = await rolledBack((client) =>
      scalar<boolean>(client, "select app.app_now() = now()"),
    );
    expect(same).toBe(true);
  });

  it("freezes and advances on one connection only", async () => {
    const frozen = new Date("2026-12-01T09:00:00Z");
    await withTwoConnections(async (a, b) => {
      await a.query("begin");
      await b.query("begin");
      await setClock(a, frozen);
      expect(await scalar<Date>(a, "select app.app_now()")).toEqual(frozen);
      await advanceClock(a, "29 days");
      expect(await scalar<Date>(a, "select app.app_now()")).toEqual(
        new Date("2026-12-30T09:00:00Z"),
      );
      expect(await scalar<boolean>(b, "select app.app_now() = now()")).toBe(true);
    });
  });
});

describe("chapter 09: app.normalize_text equals normalizeText in packages/domain", () => {
  // Every BMP character that String.prototype.trim removes, derived rather than listed.
  const trimmed: string[] = [];
  for (let code = 0; code <= 0xffff; code++) {
    const ch = String.fromCharCode(code);
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (`a${ch}`.trim() === "a") trimmed.push(ch);
  }

  const samples = [
    "",
    "   ",
    "كتاب",
    // alef + combining madda above: NFC composes it
    `${cp(0x627, 0x653)}خر`,
    // e + combining acute accent
    `cafe${cp(0x301)}`,
    "line one\nline two",
    `${cp(0x200b)}zero width stays${cp(0x200b)}`,
    `emoji ${cp(0x1f600)}`,
    ...trimmed.map((ch) => `${ch}${ch}نص ${ch} داخلي${ch}`),
  ];

  it("trims exactly the characters JavaScript trims", () => {
    expect(trimmed.length).toBeGreaterThan(20);
  });

  it("gives the same result for every sample", async () => {
    const fromDb = await rolledBack(async (client) => {
      const result = await client.query<{ out: string }>(
        "select app.normalize_text(x) as out from unnest($1::text[]) with ordinality as t(x, i) order by i",
        [samples],
      );
      return result.rows.map((row) => row.out);
    });
    expect(fromDb).toEqual(samples.map((s) => normalizeText(s)));
  });
});

describe("DEC67: app.search_normalize builds the search copy", () => {
  const cases: [string, string, string][] = [
    ["tatweel", `كت${cp(0x640, 0x640)}اب`, "كتاب"],
    [
      "harakat, tanween, shadda, sukun and dagger alef",
      `ك${cp(0x650)}ت${cp(0x64e)}اب${cp(0x64c)} م${cp(0x64f)}ح${cp(0x64e)}م${cp(0x651)}د ه${cp(0x670)}ذا ق${cp(0x652)}`,
      "كتاب محمد هذا ق",
    ],
    ["alef forms", "أحمد إبراهيم آمال ٱلكتاب", "احمد ابراهيم امال الكتاب"],
    ["alef maqsura and teh marbuta", "مستشفى مكتبة", "مستشفي مكتبه"],
    ["Arabic-Indic digits", "آيفون ١٣ ۱۴", "ايفون 13 14"],
    ["Latin case", "iPhone PRO Max", "iphone pro max"],
    ["presentation forms through NFKC", cp(0xfefb, 0x20, 0xfe8d, 0xfedf, 0xfe92), "لا الب"],
    ["full-width letters through NFKC", cp(0xff21, 0xff22, 0xff23), "abc"],
    [
      "invisible characters",
      `ك${cp(0x200c)}ت${cp(0x200d)}ا${cp(0x200f)}ب${cp(0x202b)}${cp(0x2066)}${cp(0xad)}`,
      "كتاب",
    ],
    ["spaces and line breaks", `  كتاب${cp(0xa0)}\t\n${cp(0x3000)}قديم  `, "كتاب قديم"],
    ["hamza on waw and yeh is kept", "مؤسسة بيئة", "مؤسسه بيئه"],
    ["the article is kept", "الكتاب", "الكتاب"],
  ];

  it.each(cases)("%s", async (_name, input, expected) => {
    const out = await rolledBack((client) =>
      scalar<string>(client, "select app.search_normalize($1)", [input]),
    );
    expect(out).toBe(expected);
  });

  it("is IMMUTABLE, so generated columns and indexes may use it", async () => {
    const volatility = await rolledBack((client) =>
      scalar<string>(
        client,
        "select provolatile::text from pg_proc where oid = 'app.search_normalize(text)'::regprocedure",
      ),
    );
    expect(volatility).toBe("i");
  });
});

describe("item 8: app.raise_api_error", () => {
  it("raises SJ001 with the contract code", async () => {
    const error = await rolledBack((client) =>
      dbError(client, "select app.raise_api_error('STATE_CONFLICT')"),
    );
    expect(error.code).toBe("SJ001");
    expect(error.message).toBe("STATE_CONFLICT");
    expect(error.detail).toBeUndefined();
  });

  it("carries a field error as JSON in the detail", async () => {
    const error = await rolledBack((client) =>
      dbError(client, "select app.raise_api_error('VALIDATION_FAILED', 'title', 'too_small')"),
    );
    expect(error.code).toBe("SJ001");
    expect(JSON.parse(error.detail ?? "null")).toEqual({ field: "title", code: "too_small" });
  });

  it.each([
    ["a lower-case code", "select app.raise_api_error('state_conflict')"],
    ["a field without its rule", "select app.raise_api_error('VALIDATION_FAILED', 'title')"],
  ])("refuses %s as a programming error, not a contract error", async (_name, sql) => {
    const error = await rolledBack((client) => dbError(client, sql));
    expect(error.code).toBe("XX000");
  });

  it("every code raised in a function body exists in the contract's ErrorCode", async () => {
    const bodies = await rolledBack(async (client) => {
      const result = await client.query<{ source: string }>(
        `select p.prosrc as source from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'app')`,
      );
      return result.rows.map((row) => row.source);
    });
    const used = new Set(
      bodies.flatMap((source) =>
        [...source.matchAll(/raise_api_error\(\s*'([A-Z_]+)'/g)].map((m) => m[1] ?? ""),
      ),
    );
    expect(used.size).toBeGreaterThan(0);
    const errorCode = (await contractSchemas()).ErrorCode;
    const known = new Set(errorCode?.enum ?? []);
    expect([...used].filter((code) => !known.has(code))).toEqual([]);
  });
});
