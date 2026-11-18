import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listClientFiles,
  scanClientOutput,
  scanText,
  serverOnlyEnvNames,
} from "../../scripts/check-client-bundle.ts";

// Secret-like strings are assembled at run time, so the repository never contains one
// (gitleaks scans every commit).
function fakeJwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [part({ alg: "HS256", typ: "JWT" }), part(payload), part("signature")].join(".");
}
const fake = {
  serviceRoleText: ["service", "role"].join("_"),
  supabaseSecretKey: ["sb", "secret", "a".repeat(32)].join("_"),
  postgresUrl: ["postgresql", "//app:pw@db.example.test:5432/souq"].join(":"),
  serviceRoleJwt: fakeJwt({ iss: "supabase", role: ["service", "role"].join("_") }),
  anonJwt: fakeJwt({ iss: "supabase", role: "anon" }),
};

let nextDir = "";

function put(relativePath: string, content: string): void {
  const file = join(nextDir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

beforeEach(() => {
  nextDir = mkdtempSync(join(tmpdir(), "souq-next-"));
  put("static/chunks/app.js", 'console.log("سوق الجامعة");');
  put("server/app/index.html", '<html lang="ar" dir="rtl"></html>');
});

afterEach(() => {
  rmSync(nextDir, { recursive: true, force: true });
});

describe("SEC06 check:bundle", () => {
  it("passes clean browser-facing output", () => {
    expect(scanClientOutput(nextDir, []).findings).toEqual([]);
  });

  it.each([
    ["service_role_text", fake.serviceRoleText],
    ["supabase_secret_key", fake.supabaseSecretKey],
    ["postgres_url", fake.postgresUrl],
    ["service_role_jwt", fake.serviceRoleJwt],
  ] as const)("flags %s in a static chunk", (kind, secret) => {
    put("static/chunks/leak.js", `const k = "${secret}";`);
    const { findings } = scanClientOutput(nextDir, []);
    expect(findings.map((f) => f.kind)).toContain(kind);
    expect(findings[0]?.file).toBe(join("static", "chunks", "leak.js"));
  });

  it("does not flag a JWT whose role is anon", () => {
    expect(scanText(`const k = "${fake.anonJwt}";`, [])).toEqual([]);
  });

  it("flags a server-only variable name, and reports the name only", () => {
    put("static/chunks/env.js", "const v = process.env.SUPABASE_SECRET_KEY;");
    const { findings } = scanClientOutput(nextDir, ["SUPABASE_SECRET_KEY"]);
    expect(findings).toEqual([
      {
        file: join("static", "chunks", "env.js"),
        kind: "server_env_name",
        name: "SUPABASE_SECRET_KEY",
      },
    ]);
  });

  it("scans prerendered HTML and RSC payloads, including segments", () => {
    put("server/app/index.rsc", fake.serviceRoleText);
    put("server/app/index.segments/__PAGE__.segment.rsc", fake.postgresUrl);
    const files = scanClientOutput(nextDir, []).findings.map((f) => f.file);
    expect(files).toContain(join("server", "app", "index.rsc"));
    expect(files).toContain(join("server", "app", "index.segments", "__PAGE__.segment.rsc"));
  });

  it("ignores server-only code that never reaches the browser", () => {
    put("server/app/page.js", `const k = "${fake.supabaseSecretKey}";`);
    expect(listClientFiles(nextDir)).not.toContain(join(nextDir, "server", "app", "page.js"));
    expect(scanClientOutput(nextDir, []).findings).toEqual([]);
  });

  it("reads only non-public names from .env.example", () => {
    const example = [
      "# comment",
      "NEXT_PUBLIC_SUPABASE_URL=",
      "SUPABASE_SECRET_KEY=",
      "  APP_DATABASE_URL =",
      "",
    ].join("\n");
    expect(serverOnlyEnvNames(example)).toEqual(["SUPABASE_SECRET_KEY", "APP_DATABASE_URL"]);
  });
});
