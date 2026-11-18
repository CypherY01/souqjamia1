// Contract coverage check (task 1.3): every ID from API001 to API118 is either listed in
// x-phase1-excluded, or appears in paths exactly once with a matching operationId and x-spec-ids.
// Usage (see package.json): redocly bundle contracts/openapi.yaml --ext json | node scripts/check-contract-ids.ts
import { text } from "node:stream/consumers";

export const API_ID_MIN = 1;
export const API_ID_MAX = 118;

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;

export interface ContractIdReport {
  readonly errors: string[];
  readonly operations: number;
  readonly excluded: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function apiId(n: number): string {
  return `API${String(n).padStart(3, "0")}`;
}

function inRange(id: string): boolean {
  const digits = /^API(\d{3})$/.exec(id)?.[1];
  if (digits === undefined) return false;
  const n = Number(digits);
  return n >= API_ID_MIN && n <= API_ID_MAX;
}

export function checkContractIds(doc: unknown): ContractIdReport {
  const errors: string[] = [];
  if (!isRecord(doc))
    return { errors: ["contract is not a JSON object"], operations: 0, excluded: 0 };

  const excluded = new Set<string>();
  const rawExcluded = doc["x-phase1-excluded"];
  if (!Array.isArray(rawExcluded)) {
    errors.push("x-phase1-excluded is missing or is not a list");
  } else {
    for (const entry of rawExcluded) {
      const id = isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined;
      const reason = isRecord(entry) && typeof entry.reason === "string" ? entry.reason.trim() : "";
      if (id === undefined || reason === "") {
        errors.push("x-phase1-excluded: every entry needs an id and a non-empty reason");
        continue;
      }
      if (!inRange(id)) errors.push(`x-phase1-excluded: ${id} is not between API001 and API118`);
      if (excluded.has(id)) errors.push(`x-phase1-excluded: ${id} is listed twice`);
      excluded.add(id);
    }
  }

  const seen = new Map<string, string>();
  const paths = doc.paths;
  if (!isRecord(paths)) {
    errors.push("paths is missing");
    return { errors, operations: 0, excluded: excluded.size };
  }
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isRecord(op)) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const operationId = typeof op.operationId === "string" ? op.operationId : "";
      const digits = /^api(\d{3})[A-Z]/.exec(operationId)?.[1];
      if (digits === undefined) {
        errors.push(`${where}: operationId must be apiNNN followed by a name`);
        continue;
      }
      const id = `API${digits}`;
      const specIds = op["x-spec-ids"];
      if (!Array.isArray(specIds) || specIds[0] !== id) {
        errors.push(`${where}: the first x-spec-ids entry must be ${id}`);
      }
      if (!inRange(id)) errors.push(`${where}: ${id} is not between API001 and API118`);
      if (excluded.has(id)) errors.push(`${where}: ${id} is also listed in x-phase1-excluded`);
      const previous = seen.get(id);
      if (previous === undefined) seen.set(id, where);
      else errors.push(`${where}: ${id} is already used by ${previous}`);
    }
  }

  for (let n = API_ID_MIN; n <= API_ID_MAX; n++) {
    const id = apiId(n);
    if (!excluded.has(id) && !seen.has(id)) {
      errors.push(`${id} is neither an operation in paths nor listed in x-phase1-excluded`);
    }
  }
  return { errors, operations: seen.size, excluded: excluded.size };
}

if (import.meta.main) {
  const input = await text(process.stdin);
  let doc: unknown;
  try {
    doc = JSON.parse(input);
  } catch {
    console.error(
      "check:contract-ids: input is not JSON. Pipe `redocly bundle --ext json` into it.",
    );
    process.exitCode = 1;
  }
  if (doc !== undefined) {
    const report = checkContractIds(doc);
    if (report.errors.length > 0) {
      for (const error of report.errors) console.error(`  ${error}`);
      console.error(`check:contract-ids: ${String(report.errors.length)} problem(s).`);
      process.exitCode = 1;
    } else {
      console.log(
        `check:contract-ids: ${String(report.operations)} operations and ` +
          `${String(report.excluded)} excluded cover API001-API118, each exactly once.`,
      );
    }
  }
}
