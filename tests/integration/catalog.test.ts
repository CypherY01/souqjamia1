// Task 4.2 (plan/task-4.2.md): API030, the public pick lists, through the server's own code
// (lib/catalog.ts) as souq_web. FR08, FR20, FR55, BR03, DEC28, DEC77.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { enums } from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { loadCatalog } from "../../apps/web/lib/catalog.ts";
import { closeDb, dbPool } from "./_harness/db.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { trace } from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();

afterAll(async () => {
  await db.end();
  await closeDb();
});

function asCaller(identity: Identity | null, sql: string): Promise<unknown[]> {
  return db.withActor(identity?.claims ?? null, trace(), async (tx) => (await tx.query(sql)).rows);
}

const CATEGORIES = "select id, key, label_ar, label_en from app.active_categories()";
const POINTS = "select id, key, kind, label_ar, label_en from app.active_meeting_points()";

describe("API030: the active categories, colleges and meeting points", () => {
  it("BR03 the seven categories are there in every environment, in display order", async () => {
    const catalog = await loadCatalog(db, trace());
    expect(catalog.categories.map((category) => category.key)).toEqual([...enums.CategoryKey]);
    expect(catalog.categories[0]).toMatchObject({ label_ar: "الكتب والدراسة" });
    // The local fixtures (seed.sql): campus points first, then city points (DEC28).
    const kinds = catalog.meeting_points.map((point) => point.kind);
    expect(kinds).toEqual([...kinds].sort());
    expect(catalog.colleges.length).toBeGreaterThan(0);
  });

  it("FR55 an inactive meeting point is not offered, and the list may be empty (G02)", async () => {
    // Fixtures of seed.sql, deactivated for this test only and restored after it (the files run
    // one at a time, and reference-data.test.ts checks that seed.sql's rows are the only ones).
    const active = await dbPool().query<{ id: string; key: string }>(
      "select id::text, key from public.meeting_point where is_active order by key",
    );
    const one = active.rows[0];
    if (one === undefined) throw new Error("seed.sql has no active meeting point");
    try {
      await dbPool().query("update public.meeting_point set is_active = false where id = $1", [
        one.id,
      ]);
      const without = await loadCatalog(db, trace());
      expect(without.meeting_points.map((point) => point.id)).not.toContain(one.id);
      expect(without.meeting_points).toHaveLength(active.rows.length - 1);
      await dbPool().query(
        "update public.meeting_point set is_active = false where id = any($1::uuid[])",
        [active.rows.map((row) => row.id)],
      );
      const empty = await loadCatalog(db, trace());
      expect(empty.meeting_points).toEqual([]);
      expect(empty.categories).toHaveLength(enums.CategoryKey.length);
    } finally {
      await dbPool().query(
        "update public.meeting_point set is_active = true where id = any($1::uuid[])",
        [active.rows.map((row) => row.id)],
      );
    }
  });

  it("DEC77 app.active_categories(): a member gets the same public rows as a guest", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    expect(await asCaller(identity, CATEGORIES)).toEqual(await asCaller(null, CATEGORIES));
  });

  it("DEC77 app.active_categories(): a guest reads the active categories only", async () => {
    const rows = (await asCaller(null, CATEGORIES)) as { key: string }[];
    expect(rows.map((row) => row.key)).toEqual(
      (
        await dbPool().query<{ key: string }>(
          "select key::text from public.category where is_active order by display_order",
        )
      ).rows.map((row) => row.key),
    );
  });

  it("DEC77 app.active_meeting_points(): a member gets the same public rows as a guest", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    expect(await asCaller(identity, POINTS)).toEqual(await asCaller(null, POINTS));
  });

  it("DEC77 app.active_meeting_points(): a guest reads the active meeting points only", async () => {
    const rows = (await asCaller(null, POINTS)) as { id: string }[];
    const active = await dbPool().query<{ id: string }>(
      "select id from public.meeting_point where is_active",
    );
    expect(rows.map((row) => row.id).sort()).toEqual(active.rows.map((row) => row.id).sort());
  });
});
