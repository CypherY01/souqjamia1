import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvError, loadPublicEnv, loadServerEnv, turnstileStubOn } from "../../apps/web/lib/env.ts";
import { loadWorkerEnv, parseFromAddress } from "../../apps/worker/src/env.ts";

const validWeb = {
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localdevelopmentkey",
  // Task 3.2: Cloudflare's public Turnstile test site key.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  EMAIL_CONFIRMATION_REQUIRED: "false",
  // Task 1.6. Built at run time: the repository never contains a secret-like string.
  APP_SECRET: "a".repeat(43),
  PROBE_TOKEN: "b".repeat(43),
  TRUSTED_PROXY_HOPS: "0",
  // Task 3.1. No password: nothing connects in these tests.
  DATABASE_URL: "postgresql://souq_web@127.0.0.1:54322/postgres",
  CONTACT_EMAIL: "contact@souqjamia1.test",
};

function errorOf(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("expected an EnvError");
}

describe("OPS05 web environment", () => {
  it("accepts a complete configuration and parses the DEC63 flag", () => {
    const env = loadServerEnv(validWeb);
    expect(env.EMAIL_CONFIRMATION_REQUIRED).toBe(false);
    expect(
      loadServerEnv({ ...validWeb, EMAIL_CONFIRMATION_REQUIRED: "true" })
        .EMAIL_CONFIRMATION_REQUIRED,
    ).toBe(true);
  });

  it("names every missing variable, sorted", () => {
    const missing = new Set(["APP_ORIGIN", "EMAIL_CONFIRMATION_REQUIRED"]);
    const rest = Object.fromEntries(Object.entries(validWeb).filter(([key]) => !missing.has(key)));
    expect(errorOf(() => loadServerEnv(rest)).message).toBe(
      "Invalid or missing environment variables: APP_ORIGIN, EMAIL_CONFIRMATION_REQUIRED. See .env.example.",
    );
  });

  // Secret-like strings are assembled at run time, so the repository never contains one
  // (gitleaks scans every commit).
  const fakePassword = ["not", "a", "real", "password"].join("-");
  const legacyAnonKey = ["eyJ", "hbGciOiJIUzI1NiJ9", ".legacy-anon"].join("");

  it("never echoes a value in the error", () => {
    const leaked = `https://user:${fakePassword}@example.test/path`;
    const message = errorOf(() => loadServerEnv({ ...validWeb, APP_ORIGIN: leaked })).message;
    expect(message).toContain("APP_ORIGIN");
    expect(message).not.toContain(fakePassword);
  });

  it.each([
    ["APP_ENV", "prod"],
    ["APP_ORIGIN", "localhost:3000"],
    ["APP_ORIGIN", "http://localhost:3000/app"],
    ["NEXT_PUBLIC_SUPABASE_URL", "not a url"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", legacyAnonKey],
    ["EMAIL_CONFIRMATION_REQUIRED", "yes"],
    ["APP_SECRET", "too-short"],
    ["PROBE_TOKEN", ""],
    ["TRUSTED_PROXY_HOPS", "-1"],
    ["TRUSTED_PROXY_HOPS", "two"],
    ["DATABASE_URL", "https://127.0.0.1:54322/postgres"],
    ["DATABASE_URL", "postgres://"],
    ["CONTACT_EMAIL", "not an address"],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "not-a-site-key"],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", ""],
    ["SIGNUP_IP_LIMIT_PER_HOUR", "0"],
    ["SIGNUP_IP_LIMIT_PER_HOUR", "-5"],
    ["SIGNUP_IP_LIMIT_PER_HOUR", "300.5"],
    ["SIGNUP_IP_LIMIT_PER_HOUR", "many"],
  ])("rejects %s", (name, value) => {
    expect(errorOf(() => loadServerEnv({ ...validWeb, [name]: value })).message).toContain(name);
  });

  it("DEC74: SIGNUP_IP_LIMIT_PER_HOUR is optional, 300 when unset or empty", () => {
    expect(loadServerEnv(validWeb).SIGNUP_IP_LIMIT_PER_HOUR).toBe(300);
    expect(
      loadServerEnv({ ...validWeb, SIGNUP_IP_LIMIT_PER_HOUR: "" }).SIGNUP_IP_LIMIT_PER_HOUR,
    ).toBe(300);
    expect(
      loadServerEnv({ ...validWeb, SIGNUP_IP_LIMIT_PER_HOUR: "1200" }).SIGNUP_IP_LIMIT_PER_HOUR,
    ).toBe(1200);
  });

  it("task 3.5: TURNSTILE_STUB is off unless set, and refused with APP_ENV=production", () => {
    expect(turnstileStubOn(loadServerEnv(validWeb))).toBe(false);
    expect(turnstileStubOn(loadServerEnv({ ...validWeb, TURNSTILE_STUB: "false" }))).toBe(false);
    expect(turnstileStubOn(loadServerEnv({ ...validWeb, TURNSTILE_STUB: "true" }))).toBe(true);
    expect(() =>
      loadServerEnv({ ...validWeb, APP_ENV: "production", TURNSTILE_STUB: "true" }),
    ).toThrow(/TURNSTILE_STUB/);
    expect(() => loadServerEnv({ ...validWeb, TURNSTILE_STUB: "yes" })).toThrow(/TURNSTILE_STUB/);
    // Even a configuration that slipped past the schema keeps the widget in production.
    expect(turnstileStubOn({ APP_ENV: "production", TURNSTILE_STUB: true })).toBe(false);
  });

  it("task 4.0 (DEC82): APP_ENV=test only with a localhost APP_ORIGIN", () => {
    for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
      expect(loadServerEnv({ ...validWeb, APP_ENV: "test", APP_ORIGIN: origin }).APP_ENV).toBe(
        "test",
      );
    }
    for (const origin of ["https://souqjamia1.com", "https://staging.souqjamia1.com"]) {
      expect(
        errorOf(() => loadServerEnv({ ...validWeb, APP_ENV: "test", APP_ORIGIN: origin })).message,
      ).toBe("Invalid or missing environment variables: APP_ENV. See .env.example.");
      expect(
        loadServerEnv({ ...validWeb, APP_ENV: "production", APP_ORIGIN: origin }).APP_ENV,
      ).toBe("production");
    }
  });

  it("checks only public variables for the build", () => {
    expect(loadPublicEnv(validWeb)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: validWeb.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validWeb.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: validWeb.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    });
  });
});

describe("OPS05 worker environment", () => {
  it("task 4.0 (DEC82): APP_ENV=test only with a localhost APP_ORIGIN", () => {
    const base = { DATABASE_URL: databaseUrl, ...mailpit };
    expect(loadWorkerEnv({ ...base, APP_ENV: "test" }).APP_ENV).toBe("test");
    expect(() =>
      loadWorkerEnv({ ...base, APP_ENV: "test", APP_ORIGIN: "https://souqjamia1.com" }),
    ).toThrow("Invalid or missing environment variables: APP_ENV.");
    expect(() =>
      loadWorkerEnv({ ...base, APP_ENV: "development", SUPABASE_PUBLISHABLE_KEY: "anon" }),
    ).toThrow("Invalid or missing environment variables: SUPABASE_PUBLISHABLE_KEY.");
  });

  // Built at run time: no connection string with a password is ever committed.
  const databaseUrl = `postgresql://souq_worker:${randomBytes(8).toString("hex")}@127.0.0.1:54322/postgres`;

  // Task 3.8: the email settings, with Mailpit as `pnpm env:local` writes them.
  const mailpit = {
    EMAIL_TRANSPORT: "mailpit",
    EMAIL_FROM: "سوق الجامعة <no-reply@souqjamia1.test>",
    MAILPIT_URL: "http://127.0.0.1:54324",
    APP_ORIGIN: "http://localhost:3000",
    CONTACT_EMAIL: "contact@souqjamia1.test",
    // Task 4.0 (DEC82): for the start-up check of Supabase Auth's Turnstile verification.
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localdevelopmentkey",
  };
  // Built at run time: the repository never holds a secret-like string.
  const resendKey = `re_${randomBytes(12).toString("hex")}`;

  it("accepts APP_ENV, DATABASE_URL and the email settings, and names each missing one", () => {
    expect(loadWorkerEnv({ APP_ENV: "staging", DATABASE_URL: databaseUrl, ...mailpit })).toEqual({
      APP_ENV: "staging",
      DATABASE_URL: databaseUrl,
      ...mailpit,
    });
    expect(() => loadWorkerEnv({})).toThrow(
      "Invalid or missing environment variables: APP_ENV, APP_ORIGIN, CONTACT_EMAIL, DATABASE_URL, EMAIL_FROM, EMAIL_TRANSPORT, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL.",
    );
  });

  it("task 2.5: DATABASE_URL must be a postgres connection string, and the error hides it", () => {
    for (const value of ["", "not a url", "https://127.0.0.1:54322/postgres", "postgres://"]) {
      expect(
        () => loadWorkerEnv({ APP_ENV: "development", DATABASE_URL: value, ...mailpit }),
        value,
      ).toThrow("Invalid or missing environment variables: DATABASE_URL.");
    }
    const short = databaseUrl.replace("postgresql:", "postgres:");
    expect(
      loadWorkerEnv({ APP_ENV: "development", DATABASE_URL: short, ...mailpit }).DATABASE_URL,
    ).toBe(short);
    const wrong = databaseUrl.replace("postgresql:", "https:");
    expect(() =>
      loadWorkerEnv({ APP_ENV: "development", DATABASE_URL: wrong, ...mailpit }),
    ).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("souq_worker:") as string }),
    );
  });

  it("task 3.8: mailpit needs MAILPIT_URL and is refused in production", () => {
    const base = { APP_ENV: "development", DATABASE_URL: databaseUrl, ...mailpit };
    expect(() => loadWorkerEnv({ ...base, MAILPIT_URL: undefined })).toThrow(
      "Invalid or missing environment variables: MAILPIT_URL.",
    );
    expect(() => loadWorkerEnv({ ...base, APP_ENV: "production" })).toThrow(
      "Invalid or missing environment variables: EMAIL_TRANSPORT.",
    );
  });

  it("task 3.8: resend needs its key, and the error never shows it", () => {
    const base = {
      APP_ENV: "production",
      DATABASE_URL: databaseUrl,
      ...mailpit,
      EMAIL_TRANSPORT: "resend",
      MAILPIT_URL: undefined,
    };
    expect(() => loadWorkerEnv(base)).toThrow(
      "Invalid or missing environment variables: RESEND_API_KEY.",
    );
    expect(loadWorkerEnv({ ...base, RESEND_API_KEY: resendKey }).RESEND_API_KEY).toBe(resendKey);
    expect(() => loadWorkerEnv({ ...base, RESEND_API_KEY: "short" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("short") as string }),
    );
  });

  it("task 3.8: EMAIL_FROM is an address, with or without a name", () => {
    expect(parseFromAddress("سوق الجامعة <no-reply@souqjamia1.test>")).toEqual({
      name: "سوق الجامعة",
      email: "no-reply@souqjamia1.test",
    });
    expect(parseFromAddress("no-reply@souqjamia1.test")).toEqual({
      name: null,
      email: "no-reply@souqjamia1.test",
    });
    expect(parseFromAddress("Name <not an address>")).toBeNull();
    expect(() =>
      loadWorkerEnv({
        APP_ENV: "development",
        DATABASE_URL: databaseUrl,
        ...mailpit,
        EMAIL_FROM: "nobody",
      }),
    ).toThrow("Invalid or missing environment variables: EMAIL_FROM.");
  });
});
