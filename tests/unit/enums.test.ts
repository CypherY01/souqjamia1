// Item 7 of task 2.1: packages/domain lists the same values as the contract (DEC48).
import { describe, expect, it } from "vitest";
import { enums } from "@souq/domain";
import { contractSchemas, type ContractSchema } from "../support/contract.ts";
import { STORED_ENUMS } from "../support/stored-enums.ts";

function at(schemas: Record<string, ContractSchema>, path: readonly string[]): ContractSchema {
  let node: unknown = schemas;
  for (const key of path) node = (node as Record<string, unknown> | undefined)?.[key];
  if (node === undefined) throw new Error(`contract has no schema at ${path.join(".")}`);
  return node as ContractSchema;
}

describe("stored enumerations (task 2.1)", () => {
  it("every domain list is mapped exactly once", () => {
    const mapped = new Set(STORED_ENUMS.map((e) => e.values));
    expect(mapped.size).toBe(STORED_ENUMS.length);
    expect(mapped.size).toBe(Object.keys(enums).length);
    for (const list of Object.values(enums)) expect(mapped.has(list)).toBe(true);
  });

  it("domain values equal the contract enums, in order", { timeout: 60_000 }, async () => {
    const schemas = await contractSchemas();
    for (const stored of STORED_ENUMS) {
      if (stored.contract === null) continue;
      expect(at(schemas, stored.contract).enum, stored.db).toEqual([...stored.values]);
    }
  });

  it("no list has a duplicate or a value that is not snake_case", () => {
    for (const stored of STORED_ENUMS) {
      expect(new Set(stored.values).size, stored.db).toBe(stored.values.length);
      for (const value of stored.values) expect(value).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
