import { describe, expect, it } from "vitest";
import { EnvError, loadPublicEnv, loadServerEnv } from "../../apps/web/lib/env.ts";
import { loadWorkerEnv } from "../../apps/worker/src/env.ts";

const validWeb = {
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localdevelopmentkey",
  EMAIL_CONFIRMATION_REQUIRED: "false",
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
  ])("rejects %s", (name, value) => {
    expect(errorOf(() => loadServerEnv({ ...validWeb, [name]: value })).message).toContain(name);
  });

  it("checks only public variables for the build", () => {
    expect(loadPublicEnv(validWeb)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: validWeb.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validWeb.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  });
});

describe("OPS05 worker environment", () => {
  it("accepts APP_ENV and rejects a missing one", () => {
    expect(loadWorkerEnv({ APP_ENV: "staging" })).toEqual({ APP_ENV: "staging" });
    expect(() => loadWorkerEnv({})).toThrow("Invalid or missing environment variables: APP_ENV.");
  });
});
