// Task 3.2 (items 8 and 11): /signup at 360, 768 and 1440 px against the local stack, with
// confirmation off (DEC63): signup to a signed-in member, DEC64 for a used address, the page's
// accessibility and its CSP with Turnstile (Cloudflare's test key, which always passes).
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSWORD = "كلمة-مرور-تجريبية-1";

function newEmail(): string {
  return `e2e-${randomUUID()}@example.test`;
}

async function recordCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { cspViolations: string[] };
    store.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      store.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}

/** Waits until Turnstile has handed the page its token. */
async function captchaSolved(page: Page): Promise<void> {
  await expect(page.locator('[data-turnstile] input[name="cf-turnstile-response"]')).toHaveValue(
    /.+/,
    { timeout: 20_000 },
  );
}

async function fillSignup(page: Page, email: string): Promise<void> {
  await page.getByLabel("الاسم", { exact: true }).fill("عضو اختبار الواجهة");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByLabel("الكلية").selectOption({ index: 1 });
  await page.getByLabel("أوافق على شروط الاستخدام").check();
  await page.getByLabel("قرأت سياسة الخصوصية وأوافق عليها").check();
}

/** An account made through API001 by another guest, in its own request context. */
async function signUpThroughApi(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  email: string,
) {
  const request = await playwright.request.newContext({ baseURL });
  const csrfResponse = await request.get("/api/csrf");
  const csrf = (await csrfResponse.json()) as { data: { token: string } };
  // The guest cookie is Secure; it is passed by hand over http://localhost, as in http.spec.ts.
  const cookie =
    csrfResponse
      .headersArray()
      .find((h) => h.name.toLowerCase() === "set-cookie")
      ?.value.split(";")[0] ?? "";
  const policies = (await (await request.get("/api/policies/current")).json()) as {
    data: { terms: { version: string }; privacy: { version: string } };
  };
  const res = await request.post("/api/auth/signup", {
    headers: { origin: baseURL, cookie, "x-csrf-token": csrf.data.token },
    data: {
      name: "عضو اختبار الواجهة",
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
  await request.dispose();
}

test("signup signs in at once: home page with the member header, cookies JavaScript cannot read", async ({
  page,
  context,
}) => {
  await recordCspViolations(page);
  await page.goto("/signup");
  await fillSignup(page, newEmail());
  await captchaSolved(page);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  await expect(page).toHaveURL(/\/$/);
  const header = page.locator("header").first();
  await expect(header.getByRole("button", { name: "حسابي", includeHidden: true })).toHaveCount(1);
  const session = (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
  expect(session.length).toBeGreaterThan(0);
  for (const cookie of session) {
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");
  // A signed-in member opening /signup goes to the home page.
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
  ).toEqual([]);
});

test("DEC64: a used address shows its message under the field, with login and recovery links", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail();
  await signUpThroughApi(playwright, baseURL ?? "", email);
  await page.goto("/signup");
  await fillSignup(page, email.toUpperCase());
  await captchaSolved(page);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  const field = page.getByLabel("البريد الإلكتروني");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#signup-email-error")).toHaveText(
    "هذا البريد مسجّل. سجّل الدخول أو استعد كلمة المرور",
  );
  await expect(field).toBeFocused();
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "استعادة كلمة المرور" })).toHaveAttribute(
    "href",
    "/recover",
  );
  await expect(page).toHaveURL(/\/signup$/);
});

test("field errors show under each field before any request, focus on the first", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("كلمة المرور", { exact: true }).fill("short");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page.locator("#signup-name-error")).toHaveText("اكتب اسمك.");
  await expect(page.locator("#signup-password-error")).toHaveText(
    "كلمة المرور قصيرة، 8 أحرف على الأقل.",
  );
  await expect(page.locator("#signup-terms-error")).toBeVisible();
  await expect(page.getByLabel("الاسم", { exact: true })).toBeFocused();
  // DEC75: "8 characters at least" only; the count appears past 56 characters, uncut.
  await expect(page.locator("#signup-password-hint")).toHaveText("8 أحرف على الأقل");
  await expect(page.locator("#signup-password-counter")).toHaveCount(0);
  const password = page.getByLabel("كلمة المرور", { exact: true });
  await password.fill("a".repeat(56));
  await expect(page.locator("#signup-password-counter")).toHaveCount(0);
  await password.fill("a".repeat(57));
  await expect(page.locator("#signup-password-counter")).toHaveText("57 من 64");
  await expect(page.locator("#signup-password-bytes")).toHaveCount(0);
  // Past 72 bytes well under 56 characters: the count and the notice.
  await password.fill("ك".repeat(37));
  await expect(page.locator("#signup-password-counter")).toHaveText("37 من 64");
  await expect(page.locator("#signup-password-bytes")).toBeVisible();
});

test("is right to left, without horizontal scrolling or WCAG 2.2 AA violations", async ({
  page,
}) => {
  await page.goto("/signup");
  await captchaSolved(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  // The Turnstile frame is Cloudflare's own page, outside our markup.
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA)
    .exclude("[data-turnstile] iframe")
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});

test("DEC66: with confirmation off the link page does not exist", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=abc");
  // notFound() runs after the layout has streamed (app/loading.tsx), so the status stays 200, as
  // with redirect() in task 3.1. The visitor gets the not-found page, kept out of search engines.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("هذه الصفحة غير متاحة");
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("button", { name: "تأكيد البريد" })).toHaveCount(0);
});
