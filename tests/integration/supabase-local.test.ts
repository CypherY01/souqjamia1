// Local Supabase stack (task 1.4). Needs `pnpm db:start`; run with `pnpm test:integration`.
// Exercises the Auth settings from config.toml directly against GoTrue, before any app code.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { t } from "@souq/i18n";
import { readLocalStack, type LocalStack } from "../../scripts/local-supabase.ts";

// Cloudflare's dummy token: accepted only by the public test secret in config.toml.
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const PASSWORD = "كلمة-مرور-تجريبية-1";
// Task 2.2: a signup without a valid display name is refused (item 5 of plan/task-2.2.md).
const DISPLAY_NAME = "عضو تجريبي";

let stack: LocalStack;

beforeAll(() => {
  stack = readLocalStack();
});

function auth(path: string, body?: unknown): Promise<Response> {
  return fetch(`${stack.apiUrl}/auth/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function email(): string {
  return `it-${randomUUID()}@example.test`;
}

interface MailpitSearch {
  messages?: { ID: string; Subject: string }[];
}

async function mailFor(address: string): Promise<{ ID: string; Subject: string }[]> {
  const res = await fetch(
    `${stack.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  const data = (await res.json()) as MailpitSearch;
  return data.messages ?? [];
}

async function waitForMail(address: string): Promise<{ ID: string; Subject: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const [first] = await mailFor(address);
    if (first) return first;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email arrived for ${address}`);
}

function jwtLifetime(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
    iat: number;
    exp: number;
  };
  return payload.exp - payload.iat;
}

describe("local Supabase Auth (task 1.4)", () => {
  it("is healthy", async () => {
    expect((await auth("/health")).status).toBe(200);
  });

  it("DEC63: signup signs in immediately and sends no confirmation email", async () => {
    const address = email();
    const res = await auth("/signup", {
      email: address,
      password: PASSWORD,
      data: { display_name: DISPLAY_NAME },
      gotrue_meta_security: { captcha_token: TURNSTILE_DUMMY_TOKEN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(typeof body.access_token).toBe("string");
    // DEC38: the access token lives 10 minutes.
    expect(jwtLifetime(body.access_token ?? "")).toBe(600);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await mailFor(address)).toEqual([]);
  });

  it("DEC52: signup without a Turnstile token is rejected", async () => {
    const res = await auth("/signup", { email: email(), password: PASSWORD });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("DEC32: a 7 character password is rejected", async () => {
    const res = await auth("/signup", {
      email: email(),
      password: "abc1234",
      data: { display_name: DISPLAY_NAME },
      gotrue_meta_security: { captcha_token: TURNSTILE_DUMMY_TOKEN },
    });
    expect(res.status).toBe(422);
  });

  it("DEC37: recovery sends the Arabic template with a token_hash link to /auth/recover", async () => {
    const address = email();
    const signup = await auth("/signup", {
      email: address,
      password: PASSWORD,
      data: { display_name: DISPLAY_NAME },
      gotrue_meta_security: { captcha_token: TURNSTILE_DUMMY_TOKEN },
    });
    expect(signup.status).toBe(200);
    const res = await auth("/recover", {
      email: address,
      gotrue_meta_security: { captcha_token: TURNSTILE_DUMMY_TOKEN },
    });
    expect(res.status).toBe(200);
    const message = await waitForMail(address);
    expect(message.Subject).toBe(t("email.recovery.subject"));
    const full = (await (
      await fetch(`${stack.mailpitUrl}/api/v1/message/${message.ID}`)
    ).json()) as {
      HTML: string;
    };
    expect(full.HTML).toContain('dir="rtl"');
    expect(full.HTML).toMatch(/http:\/\/localhost:3000\/auth\/recover\?token_hash=[0-9a-f]+/);
    expect(full.HTML).toContain(t("email.common.notRegistered"));
  });

  it("DEC64: a second signup with a used email is refused, with no session", async () => {
    const address = email();
    const body = {
      email: address,
      password: PASSWORD,
      data: { display_name: DISPLAY_NAME },
      gotrue_meta_security: { captcha_token: TURNSTILE_DUMMY_TOKEN },
    };
    expect((await auth("/signup", body)).status).toBe(200);
    const again = await auth("/signup", body);
    expect(again.status).toBe(422);
    const result = (await again.json()) as { error_code?: string; access_token?: string };
    expect(result.error_code).toBe("user_already_exists");
    expect(result.access_token).toBeUndefined();
  });
});
