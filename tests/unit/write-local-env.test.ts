import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadServerEnv } from "../../apps/web/lib/env.ts";
import { loadWorkerEnv } from "../../apps/worker/src/env.ts";
import {
  GENERATED_HEADER,
  LOCAL_CONTACT_EMAIL,
  newRolePassword,
  roleDatabaseUrl,
  webEnv,
  workerEnv,
} from "../../scripts/write-local-env.ts";

// The local postgres URL as `supabase status` reports it, built at run time (no committed
// connection string with a password).
const localDbUrl = `postgresql://postgres:${randomBytes(4).toString("hex")}@127.0.0.1:54322/postgres`;

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) out[match[1]] = match[2] ?? "";
  }
  return out;
}

const stack = {
  apiUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_localdevelopmentkey",
  // Built at run time: no committed secret-like string (CLAUDE.md).
  secretKey: ["sb", "secret", randomBytes(16).toString("hex")].join("_"),
};

const webDbUrl = roleDatabaseUrl(localDbUrl, "souq_web", newRolePassword());

describe("pnpm env:local", () => {
  it("writes a web env that passes the app's own validation", () => {
    const text = webEnv(stack, false, webDbUrl);
    expect(text.startsWith(GENERATED_HEADER)).toBe(true);
    const env = loadServerEnv(parseDotenv(text));
    expect(env).toMatchObject({
      APP_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
      EMAIL_CONFIRMATION_REQUIRED: false,
    });
  });

  it("task 3.1: the web app connects as souq_web, with the FR78 fixture contact address", () => {
    const env = loadServerEnv(parseDotenv(webEnv(stack, false, webDbUrl)));
    expect(new URL(env.DATABASE_URL).username).toBe("souq_web");
    expect(env.DATABASE_URL).toBe(webDbUrl);
    expect(env.CONTACT_EMAIL).toBe(LOCAL_CONTACT_EMAIL);
    expect(LOCAL_CONTACT_EMAIL.endsWith("@souqjamia1.test")).toBe(true);
  });

  it("task 4.1: the web app and the worker get the local stack's secret key for Storage", () => {
    const web = loadServerEnv(parseDotenv(webEnv(stack, false, webDbUrl)));
    expect(web.SUPABASE_SECRET_KEY).toBe(stack.secretKey);
    const url = roleDatabaseUrl(localDbUrl, "souq_worker", newRolePassword());
    const worker = loadWorkerEnv(parseDotenv(workerEnv(stack, url, "http://127.0.0.1:54324")));
    expect(worker.SUPABASE_SECRET_KEY).toBe(stack.secretKey);
  });

  it("task 1.6: new random server secrets on every run, no proxy locally", () => {
    const first = parseDotenv(webEnv(stack, false, webDbUrl));
    const second = parseDotenv(webEnv(stack, false, webDbUrl));
    expect(first.APP_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.PROBE_TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.APP_SECRET).not.toBe(second.APP_SECRET);
    expect(first.APP_SECRET).not.toBe(first.PROBE_TOKEN);
    expect(first.TRUSTED_PROXY_HOPS).toBe("0");
  });

  it("copies the DEC63 flag it is given", () => {
    expect(parseDotenv(webEnv(stack, true, webDbUrl)).EMAIL_CONFIRMATION_REQUIRED).toBe("true");
  });

  it("task 2.5: writes a worker env for souq_worker that passes the worker's validation", () => {
    const password = newRolePassword();
    const url = roleDatabaseUrl(localDbUrl, "souq_worker", password);
    const env = loadWorkerEnv(parseDotenv(workerEnv(stack, url, "http://127.0.0.1:54324")));
    expect(env.APP_ENV).toBe("development");
    // Task 4.0 (DEC82): the worker asks the same Supabase Auth as the web app at start-up.
    expect(env).toMatchObject({
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    });
    // Task 3.8: email to the local Mailpit, on the reserved souqjamia1.test name only.
    expect(env).toMatchObject({
      EMAIL_TRANSPORT: "mailpit",
      MAILPIT_URL: "http://127.0.0.1:54324",
      APP_ORIGIN: "http://localhost:3000",
      CONTACT_EMAIL: LOCAL_CONTACT_EMAIL,
    });
    expect(env.EMAIL_FROM.endsWith("@souqjamia1.test>")).toBe(true);
    expect(env.RESEND_API_KEY).toBeUndefined();
    const parsed = new URL(env.DATABASE_URL);
    expect(parsed.username).toBe("souq_worker");
    expect(parsed.password).toBe(password);
    expect(`${parsed.host}${parsed.pathname}`).toBe("127.0.0.1:54322/postgres");
  });

  it("task 2.5: a new random role password on every run, for local databases only", () => {
    const first = newRolePassword();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(newRolePassword());
    expect(() =>
      roleDatabaseUrl("postgresql://db.example.com:5432/postgres", "souq_worker", first),
    ).toThrow("Refusing a non-local address");
  });
});
