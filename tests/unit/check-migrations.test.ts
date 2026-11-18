// Task 2.1, item 10: merged migrations are never edited or deleted, new ones sort last.
import { describe, expect, it } from "vitest";
import { checkMigrations } from "../../scripts/check-migrations.ts";

const A = "20261119090000_sec02_dec36_baseline.sql";
const B = "20261119090100_enums.sql";
const C = "20261120080000_identity.sql";

const set = (entries: [string, string][]) => new Map(entries);

describe("check:migrations", () => {
  it("passes when merged migrations are unchanged and the new one comes last", () => {
    const base = set([
      [A, "aaa"],
      [B, "bbb"],
    ]);
    const head = set([
      [A, "aaa"],
      [B, "bbb"],
      [C, "ccc"],
    ]);
    expect(checkMigrations(base, head)).toEqual([]);
  });

  it("rejects an edited merged migration", () => {
    const errors = checkMigrations(set([[A, "aaa"]]), set([[A, "changed"]]));
    expect(errors).toEqual([`${A}: merged migration was edited; add a new one instead`]);
  });

  it("rejects a deleted merged migration", () => {
    const errors = checkMigrations(
      set([
        [A, "aaa"],
        [B, "bbb"],
      ]),
      set([[A, "aaa"]]),
    );
    expect(errors).toEqual([`${B}: merged migration was deleted`]);
  });

  it("rejects a new migration that sorts before the last merged one", () => {
    const early = "20261119085900_early.sql";
    const errors = checkMigrations(
      set([[A, "aaa"]]),
      set([
        [A, "aaa"],
        [early, "eee"],
      ]),
    );
    expect(errors).toEqual([`${early}: new migration must sort after the last merged one (${A})`]);
  });

  it("rejects bad names and duplicate timestamps", () => {
    const errors = checkMigrations(
      new Map(),
      set([
        ["create_tables.sql", "x"],
        ["20261119090000_one.sql", "y"],
        ["20261119090000_two.sql", "z"],
      ]),
    );
    expect(errors).toEqual([
      "create_tables.sql: name must be <14-digit timestamp>_<snake_case>.sql",
      "20261119090000_two.sql: same timestamp as 20261119090000_one.sql",
    ]);
  });

  it("accepts any order when nothing is merged yet", () => {
    expect(
      checkMigrations(
        new Map(),
        set([
          [B, "b"],
          [A, "a"],
        ]),
      ),
    ).toEqual([]);
  });
});
