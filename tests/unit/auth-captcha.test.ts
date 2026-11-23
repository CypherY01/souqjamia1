// Task 4.0 (DEC52, DEC82, owner condition 1): the start-up check that Supabase Auth verifies
// Turnstile tokens. The probe itself runs against the real local stack in the E2E and
// integration global setups; here its reading of the answers and the refusal rule.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTCHA_PROBE_EMAIL,
  captchaOffAllowed,
  captchaRefusal,
  classifyCaptchaProbe,
  probeAuthCaptcha,
} from "@souq/domain";

const SUPABASE_URL = "http://127.0.0.1:54321";
const KEY = "sb_publishable_localdevelopmentkey";

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ON = () => answer(400, { code: 400, error_code: "captcha_failed", msg: "no captcha_token" });
const OFF = () => answer(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid" });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("task 4.0: reading Supabase Auth's answer", () => {
  it("captcha_failed is on, invalid_credentials is off, anything else unknown", () => {
    expect(classifyCaptchaProbe(400, { error_code: "captcha_failed" })).toBe("on");
    expect(classifyCaptchaProbe(400, { error_code: "invalid_credentials" })).toBe("off");
    expect(classifyCaptchaProbe(400, { error_code: "validation_failed" })).toBe("unknown");
    expect(classifyCaptchaProbe(429, { error_code: "over_request_rate_limit" })).toBe("unknown");
    expect(classifyCaptchaProbe(500, { error_code: "captcha_failed" })).toBe("unknown");
    expect(classifyCaptchaProbe(400, null)).toBe("unknown");
    expect(classifyCaptchaProbe(400, "captcha_failed")).toBe("unknown");
  });

  it("sends a password sign-in for the probe address without any captcha token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(ON()));
    expect(
      await probeAuthCaptcha({ supabaseUrl: `${SUPABASE_URL}/`, publishableKey: KEY, fetch }),
    ).toBe("on");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ apikey: KEY });
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(["email", "password"]);
    expect(body.email).toBe(CAPTCHA_PROBE_EMAIL);
    expect(CAPTCHA_PROBE_EMAIL.endsWith("@souqjamia1.test")).toBe(true);
  });

  it("tries again only while the answer is unclear, three times in all", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(answer(503, {}))
      .mockResolvedValueOnce(OFF());
    expect(
      await probeAuthCaptcha({ supabaseUrl: SUPABASE_URL, publishableKey: KEY, fetch, pauseMs: 0 }),
    ).toBe("off");
    expect(fetch).toHaveBeenCalledTimes(3);

    const down = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    expect(
      await probeAuthCaptcha({
        supabaseUrl: SUPABASE_URL,
        publishableKey: KEY,
        fetch: down,
        pauseMs: 0,
      }),
    ).toBe("unknown");
    expect(down).toHaveBeenCalledTimes(3);
  });
});

describe("DEC82: who may run without the check", () => {
  it("only APP_ENV=test; elsewhere off and unknown both refuse", () => {
    expect(captchaOffAllowed("test")).toBe(true);
    for (const appEnv of ["development", "staging", "production"]) {
      expect(captchaOffAllowed(appEnv)).toBe(false);
      expect(captchaRefusal(appEnv, "on")).toBeNull();
      expect(captchaRefusal(appEnv, "off")).toBe("off");
      expect(captchaRefusal(appEnv, "unknown")).toBe("unknown");
    }
    expect(captchaRefusal("test", "off")).toBeNull();
  });
});

describe("task 4.0: the web server at start-up", () => {
  async function startWith(appEnv: string, respond: () => Response) {
    const { loadServerEnv } = await import("../../apps/web/lib/env.ts");
    const { exitUnlessCaptchaVerified } = await import("../../apps/web/lib/env-startup.ts");
    const env = loadServerEnv({
      APP_ENV: appEnv,
      APP_ORIGIN: "http://localhost:3100",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      EMAIL_CONFIRMATION_REQUIRED: "false",
      APP_SECRET: "a".repeat(43),
      PROBE_TOKEN: "b".repeat(43),
      TRUSTED_PROXY_HOPS: "0",
      DATABASE_URL: "postgresql://souq_web@127.0.0.1:54322/postgres",
      CONTACT_EMAIL: "contact@souqjamia1.test",
      // Task 4.1. Built at run time: no committed secret-like string.
      SUPABASE_SECRET_KEY: ["sb", "secret", "k".repeat(24)].join("_"),
    });
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(respond()));
    vi.stubGlobal("fetch", fetch);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await exitUnlessCaptchaVerified(env);
    return { fetch, exit, errors };
  }

  it("refuses to run when Supabase Auth skips the check, outside APP_ENV=test", async () => {
    const { exit, errors } = await startWith("development", OFF);
    expect(exit).toHaveBeenCalledWith(1);
    const line = JSON.parse(String(errors.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "env.captcha_unverified", check: "off" });
    expect(line.hint).toBe("Run pnpm db:restart to turn the check back on.");
  });

  it("runs when the check is on, and APP_ENV=test does not ask at all", async () => {
    const on = await startWith("development", ON);
    expect(on.exit).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    const test = await startWith("test", OFF);
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.exit).not.toHaveBeenCalled();
  });
});
