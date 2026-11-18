import { describe, expect, it } from "vitest";
import { API_ID_MAX, apiId, checkContractIds } from "../../scripts/check-contract-ids.ts";

interface Op {
  operationId: string;
  "x-spec-ids": string[];
}

/** A contract that covers API001-API118: the first `excludedCount` IDs excluded, the rest as operations. */
function makeContract(excludedCount = 20) {
  const excluded: { id: string; reason: string }[] = [];
  const paths: Record<string, Record<string, Op>> = {};
  for (let n = 1; n <= API_ID_MAX; n++) {
    const id = apiId(n);
    if (n <= excludedCount) excluded.push({ id, reason: "phase 2" });
    else
      paths[`/api/p${String(n)}`] = {
        get: { operationId: `api${id.slice(3)}Op`, "x-spec-ids": [id] },
      };
  }
  return { "x-phase1-excluded": excluded, paths };
}

function op(contract: ReturnType<typeof makeContract>, path: string): Op {
  const found = contract.paths[path]?.get;
  if (found === undefined) throw new Error(`no operation at ${path}`);
  return found;
}

describe("check:contract-ids", () => {
  it("passes a contract that covers API001-API118 exactly once", () => {
    const report = checkContractIds(makeContract());
    expect(report).toEqual({ errors: [], operations: 98, excluded: 20 });
  });

  it("reports an ID that is neither an operation nor excluded", () => {
    const contract = makeContract();
    delete contract.paths["/api/p50"];
    expect(checkContractIds(contract).errors).toEqual([
      "API050 is neither an operation in paths nor listed in x-phase1-excluded",
    ]);
  });

  it("reports the same ID used by two operations", () => {
    const contract = makeContract();
    contract.paths["/api/dup"] = { post: { operationId: "api050Again", "x-spec-ids": ["API050"] } };
    expect(checkContractIds(contract).errors).toEqual([
      "POST /api/dup: API050 is already used by GET /api/p50",
    ]);
  });

  it("reports x-spec-ids that do not start with the operation's ID", () => {
    const contract = makeContract();
    op(contract, "/api/p60")["x-spec-ids"] = ["FR01", "API060"];
    expect(checkContractIds(contract).errors).toEqual([
      "GET /api/p60: the first x-spec-ids entry must be API060",
    ]);
  });

  it("reports an operationId without the apiNNN prefix", () => {
    const contract = makeContract();
    op(contract, "/api/p70").operationId = "createThing";
    const { errors } = checkContractIds(contract);
    expect(errors).toContain("GET /api/p70: operationId must be apiNNN followed by a name");
  });

  it("reports an operation whose ID is also excluded", () => {
    const contract = makeContract();
    contract.paths["/api/p5"] = { get: { operationId: "api005Op", "x-spec-ids": ["API005"] } };
    expect(checkContractIds(contract).errors).toEqual([
      "GET /api/p5: API005 is also listed in x-phase1-excluded",
    ]);
  });

  it("reports excluded entries that are duplicated, out of range or without a reason", () => {
    const contract = makeContract();
    contract["x-phase1-excluded"].push(
      { id: "API001", reason: "again" },
      { id: "API119", reason: "out of range" },
      { id: "API002", reason: " " },
    );
    expect(checkContractIds(contract).errors).toEqual([
      "x-phase1-excluded: API001 is listed twice",
      "x-phase1-excluded: API119 is not between API001 and API118",
      "x-phase1-excluded: every entry needs an id and a non-empty reason",
    ]);
  });

  it("reports a missing x-phase1-excluded list", () => {
    const { paths } = makeContract(0);
    expect(checkContractIds({ paths }).errors).toEqual([
      "x-phase1-excluded is missing or is not a list",
    ]);
  });
});
