// Every schema of the approved contract (contracts/components/schemas.yaml), bundled to JSON by
// the pinned Redocly CLI that `pnpm check:contract-ids` uses. No YAML library needed (task 2.1).
// Bundling contracts/openapi.yaml alone would drop schemas no operation references (such as
// ModerationAction), so a throwaway root document in the temp folder references each one.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT } from "../../scripts/local-supabase.ts";

export interface ContractSchema {
  type?: unknown;
  enum?: string[];
  properties?: Record<string, ContractSchema>;
}

const SCHEMAS_FILE = join(REPO_ROOT, "contracts", "components", "schemas.yaml");

let cached: Promise<Record<string, ContractSchema>> | undefined;

function redoclyCli(): string {
  const require = createRequire(join(REPO_ROOT, "package.json"));
  const manifestPath = require.resolve("@redocly/cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin: { redocly: string } };
  return join(dirname(manifestPath), manifest.bin.redocly);
}

async function bundle(): Promise<Record<string, ContractSchema>> {
  // Top-level keys of schemas.yaml are the schema names (column 0, followed by a colon).
  const names = readFileSync(SCHEMAS_FILE, "utf8").match(/^[A-Za-z][A-Za-z0-9]*(?=:)/gm) ?? [];
  const dir = mkdtempSync(join(tmpdir(), "souq-contract-"));
  try {
    const target = relative(dir, SCHEMAS_FILE).split("\\").join("/");
    const root = {
      openapi: "3.1.0",
      info: { title: "all contract schemas (tests only)", version: "0" },
      paths: {},
      components: {
        schemas: Object.fromEntries(names.map((name) => [name, { $ref: `${target}#/${name}` }])),
      },
    };
    const rootFile = join(dir, "root.json");
    writeFileSync(rootFile, JSON.stringify(root));
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [redoclyCli(), "bundle", rootFile, "--ext", "json"],
      { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    const bundled = JSON.parse(stdout) as {
      components: { schemas: Record<string, ContractSchema> };
    };
    return bundled.components.schemas;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** components.schemas with every schema of the contract, bundled once per test file. */
export function contractSchemas(): Promise<Record<string, ContractSchema>> {
  cached ??= bundle();
  return cached;
}
