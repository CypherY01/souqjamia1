// Reference data (task 2.3): BR03, FR55, UC24, DEC28, items 1 to 5 of plan/task-2.3.md.
// Needs `pnpm db:start` and `pnpm db:reset` (migrations and seed); run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { enums } from "@souq/domain";
import { closeDb, dbError, rolledBack, scalar } from "./_harness/db.ts";
import { actAs } from "./_harness/roles.ts";
import { rest, restErrorCode, signUpMember } from "./_harness/users.ts";

afterAll(closeDb);

/** BR03: labels of the "Market categories and item conditions" table in docs/spec-v3-en.md. */
const CATEGORY_LABELS: Record<string, [string, string]> = {
  books_study: ["الكتب والدراسة", "Books and study"],
  electronics: ["الإلكترونيات", "Electronics"],
  room_furniture: ["الأثاث والسكن", "Furniture and housing"],
  university_supplies: ["المستلزمات الجامعية", "University supplies"],
  clothing_personal: ["الملابس والعناية", "Clothing and personal care"],
  vehicles: ["وسائل التنقل والمركبات", "Transport and vehicles"],
  other: ["أخرى", "Other"],
};

/** Item 3: the only columns anon and authenticated may read. */
const READABLE: Record<string, string[]> = {
  category: ["display_order", "id", "is_active", "key", "label_ar", "label_en"],
  college: ["display_order", "id", "is_active", "key", "label_ar", "label_en"],
  meeting_point: ["display_order", "id", "is_active", "key", "kind", "label_ar", "label_en"],
};

describe("BR03: the seven stable categories", () => {
  it("are exactly the enum keys, in order, with the labels of the specification", async () => {
    const rows = await rolledBack(async (client) => {
      const result = await client.query<{
        key: string;
        label_ar: string;
        label_en: string;
        is_active: boolean;
      }>(
        "select key::text, label_ar, label_en, is_active from public.category order by display_order",
      );
      return result.rows;
    });
    expect(rows.map((row) => row.key)).toEqual([...enums.CategoryKey]);
    for (const row of rows) {
      expect([row.label_ar, row.label_en], row.key).toEqual(CATEGORY_LABELS[row.key]);
      expect(row.is_active).toBe(true);
    }
  });

  it("refuses an eighth category and a second row for a key", async () => {
    await rolledBack(async (client) => {
      const eighth = await dbError(
        client,
        "insert into public.category (key, label_ar) values ('furniture', 'أثاث')",
      );
      expect(eighth.code).toBe("22P02");
      const again = await dbError(
        client,
        "insert into public.category (key, label_ar) values ('other', 'فئة أخرى ثانية')",
      );
      expect(again.code).toBe("23505");
    });
  });
});

describe("FR55: used values are deactivated, never deleted", () => {
  it("refuses to delete a college that a profile uses, and keeps it readable when inactive", async () => {
    const member = await signUpMember();
    await rolledBack(async (client) => {
      const college = await scalar<string>(
        client,
        "select id from public.college where key = 'test_college_1'",
      );
      await client.query("update public.profile set college_id = $1 where id = $2", [
        college,
        member.id,
      ]);
      expect(
        (await dbError(client, "delete from public.college where id = $1", [college])).code,
      ).toBe("23503");

      await client.query("update public.college set is_active = false where id = $1", [college]);
      await actAs(client, "anon");
      const seen = await client.query<{ label_ar: string; is_active: boolean }>(
        `select c.label_ar, c.is_active from public.profile p
           join public.college c on c.id = p.college_id where p.id = $1`,
        [member.id],
      );
      // TC80 basis: the old reference keeps its meaning for every reader.
      expect(seen.rows).toEqual([{ label_ar: "كلية تجريبية 1", is_active: false }]);
    });
  });

  it("accepts an existing college or none in the profile, nothing else", async () => {
    const member = await signUpMember();
    await rolledBack(async (client) => {
      await client.query("update public.profile set college_id = null where id = $1", [member.id]);
      const unknown = await dbError(
        client,
        "update public.profile set college_id = gen_random_uuid() where id = $1",
        [member.id],
      );
      expect(unknown.code).toBe("23503");
    });
  });
});

describe("item 2: duplicate labels are detected after DEC67 normalization", () => {
  it.each<[string, string, string, string | null]>([
    ["teh marbuta", "college", "كليه تجريبيه 1", null],
    ["a shadda", "college", "كلية تجريبيّة 1", null],
    ["Latin case in label_en", "college", "x", "TEST COLLEGE 1"],
    ["teh marbuta in a meeting point", "meeting_point", "نقطه لقاء تجريبيه 3", null],
  ])("refuses a label that differs only by %s", async (_name, table, labelAr, labelEn) => {
    const error = await rolledBack((client) =>
      dbError(
        client,
        table === "college"
          ? "insert into public.college (key, label_ar, label_en) values ('dup_check', $1, $2)"
          : "insert into public.meeting_point (key, kind, label_ar, label_en) values ('dup_check', 'city', $1, $2)",
        [labelAr, labelEn],
      ),
    );
    expect(error.code).toBe("23505");
  });

  it("accepts a different label", async () => {
    const id = await rolledBack((client) =>
      scalar<string>(
        client,
        "insert into public.college (key, label_ar, label_en) values ('test_college_9', 'كلية تجريبية 9', null) returning id",
      ),
    );
    expect(typeof id).toBe("string");
  });

  it.each([
    ["an empty label", "''"],
    ["a 121 character label", "repeat('ن', 121)"],
    ["a label with an outer space", "' كلية '"],
  ])("refuses %s", async (_name, expression) => {
    const error = await rolledBack((client) =>
      dbError(
        client,
        `insert into public.college (key, label_ar) values ('label_check', ${expression})`,
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses a key outside the contract format", async () => {
    const error = await rolledBack((client) =>
      dbError(
        client,
        "insert into public.college (key, label_ar) values ('Bad Key', 'كلية جديدة')",
      ),
    );
    expect(error.code).toBe("23514");
  });
});

describe("item 3: who reads what", () => {
  it.each(Object.keys(READABLE))(
    "%s: anon and authenticated may read exactly the listed columns",
    async (table) => {
      const readable = await rolledBack(async (client) => {
        const result = await client.query<{ role: string; name: string }>(
          `select r.role, c.column_name::text as name
             from information_schema.columns c
            cross join unnest(array['anon', 'authenticated']) as r(role)
            where c.table_schema = 'public' and c.table_name = $1
              and has_column_privilege(r.role, format('public.%I', $1), c.column_name, 'SELECT')
            order by 1, 2`,
          [table],
        );
        return result.rows;
      });
      for (const role of ["anon", "authenticated"]) {
        expect(
          readable.filter((r) => r.role === role).map((r) => r.name),
          role,
        ).toEqual(READABLE[table]);
      }
    },
  );

  it("anon reads the lists through the Data API, and no one writes to them", async () => {
    const res = await rest("/category?select=key,label_ar&order=display_order");
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(7);
    const member = await signUpMember();
    for (const token of [undefined, member.accessToken]) {
      for (const [path, body] of [
        ["/category", { key: "other", label_ar: "x" }],
        ["/college", { key: "x_college", label_ar: "كلية" }],
        ["/meeting_point", { key: "x_point", kind: "city", label_ar: "نقطة" }],
      ] as const) {
        const write = await rest(path, { method: "POST", token, body });
        expect(write.status, path).toBeGreaterThanOrEqual(400);
        expect(await restErrorCode(write)).toBe("42501");
      }
    }
  });

  it("the public profile column college_id is readable by anon", async () => {
    const member = await signUpMember();
    const res = await rest(`/profile?select=id,college_id&id=eq.${member.id}`);
    expect(await res.json()).toEqual([{ id: member.id, college_id: null }]);
  });
});

describe("item 5: seed.sql holds marked fixtures only", () => {
  it("every college and meeting point is a test fixture, two per meeting point kind", async () => {
    const rows = await rolledBack(async (client) => {
      const result = await client.query<{ label_ar: string; source_ref: string; kind: string }>(
        `select label_ar, source_ref, 'college' as kind from public.college
         union all
         select label_ar, source_ref, kind::text from public.meeting_point`,
      );
      return result.rows;
    });
    expect(rows.length).toBe(7);
    for (const row of rows) {
      expect(row.label_ar).toContain("تجريبية");
      expect(row.source_ref).toBe("fixture");
    }
    expect(rows.filter((row) => row.kind === "campus").length).toBe(2);
    expect(rows.filter((row) => row.kind === "city").length).toBe(2);
  });

  it("draft-1 of the terms and the privacy policy is published", async () => {
    const versions = await rolledBack(async (client) => {
      const result = await client.query<{ policy_type: string; version: string }>(
        "select policy_type::text, version from public.policy_version order by 1",
      );
      return result.rows;
    });
    expect(versions).toEqual([
      { policy_type: "privacy", version: "draft-1" },
      { policy_type: "terms", version: "draft-1" },
    ]);
  });
});
