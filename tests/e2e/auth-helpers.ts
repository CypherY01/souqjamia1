// Shared steps of the login, logout and restricted specs (task 3.3), against the local stack.
// Accounts are made through API001 by another guest; account states are set with the local
// postgres role, as the integration tests do (local stack only, assertLocalUrl).
import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import pg from "pg";
import { assertLocalUrl, readLocalStack } from "../../scripts/local-supabase.ts";

export const PASSWORD = "كلمة-مرور-تجريبية-1";
export const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export function newEmail(prefix = "e2e"): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** Waits until Turnstile has handed the page its token. */
export async function captchaSolved(page: Page): Promise<void> {
  await expect(page.locator('[data-turnstile] input[name="cf-turnstile-response"]')).toHaveValue(
    /.+/,
    { timeout: 20_000 },
  );
}

/** A guest of its own: the CSRF token and the guest cookie (Secure, passed by hand). */
async function guest(request: APIRequestContext): Promise<{ token: string; cookie: string }> {
  const response = await request.get("/api/csrf");
  const body = (await response.json()) as { data: { token: string } };
  const cookie =
    response
      .headersArray()
      .find((h) => h.name.toLowerCase() === "set-cookie")
      ?.value.split(";")[0] ?? "";
  return { token: body.data.token, cookie };
}

/**
 * A member account made through API001 (confirmation off) by a guest of its own, in a request
 * context of its own: the session it opens stays there, so the next account starts as a guest
 * again (a live session may not sign up, 403). Returns the user id.
 */
export async function signUpThroughApi(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
  email: string,
  name = "عضو اختبار الدخول",
): Promise<string> {
  const request = await playwright.request.newContext({ baseURL });
  try {
    await signUp(request, baseURL ?? "", email, name);
  } finally {
    await request.dispose();
  }
  return userIdOf(email);
}

async function signUp(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  name: string,
): Promise<void> {
  const { token, cookie } = await guest(request);
  const policies = (await (await request.get("/api/policies/current")).json()) as {
    data: { terms: { version: string }; privacy: { version: string } };
  };
  const res = await request.post("/api/auth/signup", {
    headers: { origin: baseURL, cookie, "x-csrf-token": token },
    data: {
      name,
      email,
      password: PASSWORD,
      college_id: null,
      terms_version: policies.data.terms.version,
      privacy_version: policies.data.privacy.version,
      accept_terms: true,
      acknowledge_privacy: true,
      captcha_token: "XXXX.DUMMY.TOKEN.XXXX",
    },
  });
  expect(res.status()).toBe(200);
}

async function userIdOf(email: string): Promise<string> {
  const stack = readLocalStack();
  const client = new pg.Client({ connectionString: assertLocalUrl(stack.dbUrl) });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      "select id::text from auth.users where email = lower($1)",
      [email],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("no account");
    return id;
  } finally {
    await client.end();
  }
}

/** One committed statement as postgres with the member id as $1 (a suspension, a ban). */
export async function changeMember(userId: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: assertLocalUrl(readLocalStack().dbUrl) });
  await client.connect();
  try {
    await client.query(sql, [userId]);
  } finally {
    await client.end();
  }
}

export async function fillLogin(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
}

/** Logs in from /login and waits for the page it leads to. */
export async function logIn(page: Page, email: string, path = "/login"): Promise<void> {
  await page.goto(path);
  await fillLogin(page, email);
  await captchaSolved(page);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Task 3.5: API015 with the page's own cookies: the status, and the account when there is one.
 * The direct check that a session is live or ended (until 3.5, the visitor header was).
 */
export async function meOf(
  page: Page,
): Promise<{ status: number; me: Record<string, unknown> | null }> {
  const response = await page.request.get("/api/me");
  const body = (await response.json()) as { data?: Record<string, unknown> };
  return { status: response.status(), me: body.data ?? null };
}

/** The account menu of the site header: opens it when it is closed. */
export async function openAccountMenu(page: Page): Promise<void> {
  const header = page.locator("header").first();
  const menu = header.getByRole("button", { name: "القائمة" });
  if ((await menu.isVisible()) && (await menu.getAttribute("aria-expanded")) === "false") {
    await menu.click();
  }
  const account = header.getByRole("button", { name: "حسابي" });
  if ((await account.getAttribute("aria-expanded")) === "false") await account.click();
}
