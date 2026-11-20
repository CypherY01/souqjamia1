// Task 3.2 (items 5, 8 and 11) with confirmation on: the second E2E server (CONFIRM_PORT) runs
// the same build with EMAIL_CONFIRMATION_REQUIRED=true. Signup shows "check your email" with
// the resend form; the link page shows a button only, removes the token from the address,
// spends the link once and goes to the login page (DEC37, SEC03, TC26).
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readLocalStack } from "../../scripts/local-supabase.ts";
import { CONFIRM_PORT } from "./ports.ts";

const BASE = `http://localhost:${String(CONFIRM_PORT)}`;
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSWORD = "كلمة-مرور-تجريبية-1";

test.use({ baseURL: BASE });

/** An unconfirmed account and its link, through the Auth admin API (local secret key only). */
async function generateLink(): Promise<string> {
  const stack = readLocalStack();
  const policies = (await (await fetch(`${BASE}/api/policies/current`)).json()) as {
    data: { terms: { version: string }; privacy: { version: string } };
  };
  const res = await fetch(`${stack.apiUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: stack.secretKey,
      authorization: `Bearer ${stack.secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "signup",
      email: `e2e-link-${randomUUID()}@example.test`,
      password: PASSWORD,
      data: {
        display_name: "عضو اختبار الرابط",
        terms_version: policies.data.terms.version,
        privacy_version: policies.data.privacy.version,
      },
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { hashed_token: string }).hashed_token;
}

async function captchaSolved(page: Page): Promise<void> {
  await expect(page.locator('[data-turnstile] input[name="cf-turnstile-response"]')).toHaveValue(
    /.+/,
    { timeout: 20_000 },
  );
}

test("signup with confirmation on: check your email, with the resend form", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("الاسم", { exact: true }).fill("عضو اختبار التأكيد");
  await page.getByLabel("البريد الإلكتروني").fill(`e2e-on-${randomUUID()}@example.test`);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByLabel("أوافق على شروط الاستخدام").check();
  await page.getByLabel("قرأت سياسة الخصوصية وأوافق عليها").check();
  await captchaSolved(page);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  await expect(page.getByText("تحقق من بريدك")).toBeVisible();
  await expect(page.getByRole("heading", { name: "لم يصلك الرابط؟" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة إرسال الرابط" })).toBeVisible();
  // No session: the visitor header stays.
  await expect(
    page
      .locator("header")
      .first()
      .getByRole("link", { name: "دخول", exact: true, includeHidden: true }),
  ).toHaveCount(1);
  expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
});

test("the link page: a button only, no token in the address, then the login page", async ({
  page,
}) => {
  const token = await generateLink();
  const response = await page.goto(`/auth/confirm?token_hash=${token}`);
  expect(response?.status()).toBe(200);
  // SEC03: no Referer, never stored.
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  const button = page.getByRole("button", { name: "تأكيد البريد" });
  await expect(button).toBeVisible();
  await expect(page).toHaveURL(`${BASE}/auth/confirm`);
  // Nothing outside the site loads while the token is in hand (no Turnstile yet).
  await expect(page.locator("[data-turnstile]")).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  await button.click();
  await expect(page).toHaveURL(`${BASE}/login?confirmed=1`);
});

test("a spent link shows the expired message and a clear resend form (DEC37)", async ({ page }) => {
  const token = await generateLink();
  await page.goto(`/auth/confirm?token_hash=${token}`);
  await page.getByRole("button", { name: "تأكيد البريد" }).click();
  await expect(page).toHaveURL(/\/login\?confirmed=1$/);

  await page.goto(`/auth/confirm?token_hash=${token}`);
  await page.getByRole("button", { name: "تأكيد البريد" }).click();
  await expect(page.getByText("الرابط انتهى أو استُخدم")).toBeVisible();
  await expect(page.getByLabel("البريد الإلكتروني")).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة إرسال الرابط" })).toBeVisible();
});
