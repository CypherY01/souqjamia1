// Item 7 of task 2.1: the database enum types equal packages/domain (DEC48).
// tests/unit/enums.test.ts checks packages/domain against the contract.
import { afterAll, describe, expect, it } from "vitest";
import { STORED_ENUMS } from "../support/stored-enums.ts";
import { closeDb, rolledBack } from "./_harness/db.ts";

afterAll(closeDb);

describe("stored enumerations in the database (task 2.1)", () => {
  it("public has exactly the mapped enum types, with the same values in the same order", async () => {
    const types = await rolledBack(async (client) => {
      const result = await client.query<{ name: string; labels: string[] }>(
        `select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
           from pg_type t
           join pg_namespace n on n.oid = t.typnamespace
           join pg_enum e on e.enumtypid = t.oid
          where n.nspname = 'public'
          group by t.typname
          order by t.typname`,
      );
      return Object.fromEntries(result.rows.map((row) => [row.name, row.labels]));
    });
    const expected = Object.fromEntries(STORED_ENUMS.map((e) => [e.db, [...e.values]]));
    expect(types).toEqual(expected);
  });
});
