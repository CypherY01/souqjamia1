// Task 3.6 (plan/task-3.6.md): the security page /account/security, the email change link page
// and its result, with real sessions on the local stack, at the three widths with axe. FR59,
// BR23, TC27, TC74 as the member sees them, DEC38 (the password form when the window is closed),
// DEC79. The email links point to the site address of config.toml (port 3000), so only their path
// and query are opened on the test server.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { readLocalStack } from "../../scripts/local-supabase.ts";
import {
  captchaSolved,
  fillLogin,
  logIn,
  meOf,
  newEmail,
  PASSWORD,
  signUpThroughApi,
  WCAG_22_AA,
} from "./auth-helpers.ts";

const CHANGE_SUBJECT = "أكّد تغيير بريدك في سوق الجامعة";
const NEW_PASSWORD = "كلمة-مرور-جديدة-5";

async function rtlAndAxe(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

/** The path and query of the email change link in the newest such email to `email`. */
async function changeLink(email: string): Promise<string> {
  const { mailpitUrl } = readLocalStack();
  const query = encodeURIComponent(`to:"${email}" subject:"${CHANGE_SUBJECT}"`);
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const found = (await (
          await fetch(`${mailpitUrl}/api/v1/search?query=${query}`)
        ).json()) as { messages?: { ID: string }[] };
        id = found.messages?.[0]?.ID;
        return id;
      },
      { timeout: 15_000 },
    )
    .toBeDefined();
  const { HTML } = (await (await fetch(`${mailpitUrl}/api/v1/message/${id ?? ""}`)).json()) as {
    HTML: string;
  };
  const href = /href="([^"]+)"/.exec(HTML)?.[1] ?? "";
  const url = new URL(href.replaceAll("&amp;", "&"));
  return `${url.pathname}${url.search}`;
}

/** A signed-in member on a page of its own (another device). */
async function signedInPage(browser: Browser, baseURL: string | undefined, email: string) {
  const context = await browser.newContext({ baseURL, locale: "ar" });
  const page = await context.newPage();
  await logIn(page, email);
  return { context, page };
}

/** Turnstile has handed this form its token (two forms on the page can each have one). */
async function captchaIn(scope: Locator): Promise<void> {
  await expect(scope.locator('[data-turnstile] input[name="cf-turnstile-response"]')).toHaveValue(
    /.+/,
    { timeout: 20_000 },
  );
}

function section(page: Page, title: string): Locator {
  return page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: title, exact: true }),
  });
}

async function openSecurity(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByRole("link", { name: "الأمان", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByRole("heading", { level: 1, name: "الأمان" })).toBeVisible();
}

test("a guest opening /account/security is sent to the login page", async ({ page }) => {
  await page.goto("/account/security");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fsecurity$/);
});

test("TC74 as the member sees it: the request, the pending state, one link, then both; RTL and axe", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const email = newEmail("security");
  const next = newEmail("security-new");
  await signUpThroughApi(playwright, baseURL, email, "عضو صفحة الأمان");
  await logIn(page, email);
  await openSecurity(page);
  await expect(page.locator("main").getByText(email)).toBeVisible();
  await rtlAndAxe(page);

  // The login was within 5 minutes, so the email form is open (DEC38).
  await expect(page.getByText(/التحقق صالح حتى/)).toBeVisible();
  await page.getByLabel("البريد الجديد").fill(next);
  await page.getByRole("button", { name: "أرسل رابطي التأكيد" }).click();
  await expect(page.locator(":focus")).toContainText("أرسلنا رابطي التأكيد");
  await expect(page.getByText("بانتظار تأكيد العنوانين")).toBeVisible();
  await page.reload();
  await expect(page.getByText("بانتظار تأكيد العنوانين")).toBeVisible();
  await expect(page.locator("main bdi[dir='ltr']", { hasText: next })).toBeVisible();
  await rtlAndAxe(page);

  // The old address's link, on this device: GET shows a button, the token leaves the address.
  await page.goto(await changeLink(email));
  await expect(page).toHaveURL(/\/auth\/email-change$/);
  await rtlAndAxe(page);
  await page.getByRole("button", { name: "تأكيد هذا العنوان" }).click();
  await expect(page).toHaveURL(/\/auth\/email-change\/done\?state=waiting$/);
  await expect(page.getByText("تأكّد هذا العنوان")).toBeVisible();
  // One link changes nothing: still signed in with the old address.
  expect((await meOf(page)).me?.email).toBe(email);

  // The new address's link, on another device without a session.
  const other = await browser.newContext({ baseURL, locale: "ar" });
  const otherPage = await other.newPage();
  await otherPage.goto(await changeLink(next));
  await otherPage.getByRole("button", { name: "تأكيد هذا العنوان" }).click();
  await expect(otherPage).toHaveURL(/\/auth\/email-change\/done\?state=changed$/);
  await expect(otherPage.getByText("تغيّر بريدك")).toBeVisible();
  await rtlAndAxe(otherPage);
  await other.close();

  // BR23: the first device's session has ended; the new address signs in.
  expect((await meOf(page)).status).toBe(401);
  await logIn(page, next);
  expect((await meOf(page)).me?.email).toBe(next);
});

test("DEC38: when the window has closed, the password form comes first, then the email form", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("reauth");
  await signUpThroughApi(playwright, baseURL, email, "عضو إعادة التحقق");
  await logIn(page, email);
  await openSecurity(page);
  // The server's answer once 5 minutes have passed, for the first request only.
  let refused = false;
  await page.route("**/api/profile/email-change", async (route) => {
    if (refused) {
      await route.fallback();
      return;
    }
    refused = true;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "REAUTH_REQUIRED", message: "", trace_id: "e2e" }),
    });
  });
  await page.getByLabel("البريد الجديد").fill(newEmail("reauth-new"));
  await page.getByRole("button", { name: "أرسل رابطي التأكيد" }).click();

  const emailSection = section(page, "بريد الدخول");
  await expect(
    emailSection.getByRole("heading", { level: 3, name: "أكّد كلمة مرورك" }),
  ).toBeVisible();
  await expect(emailSection.getByText("انتهت دقائق التحقق الخمس")).toBeVisible();
  await rtlAndAxe(page);
  // A wrong password is a field error that takes the focus.
  const password = emailSection.getByLabel("كلمة المرور الحالية", { exact: true });
  await password.fill("wrong-password-1");
  await captchaIn(emailSection);
  await emailSection.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(emailSection.getByText("كلمة المرور غير صحيحة.")).toBeVisible();
  await expect(password).toBeFocused();

  await password.fill(PASSWORD);
  await captchaIn(emailSection);
  await emailSection.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(page.getByText(/التحقق صالح حتى/)).toBeVisible();
  // A new session replaced the old one, and the page still works with it.
  expect((await meOf(page)).me?.email).toBe(email);
  await page.getByLabel("البريد الجديد").fill(newEmail("reauth-new"));
  await page.getByRole("button", { name: "أرسل رابطي التأكيد" }).click();
  await expect(page.getByText("بانتظار تأكيد العنوانين")).toBeVisible();
});

test("TC27 as the member sees it: the password changes, this device stays, the other is signed out", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const email = newEmail("password");
  await signUpThroughApi(playwright, baseURL, email, "عضو تغيير كلمة المرور");
  await logIn(page, email);
  const other = await signedInPage(browser, baseURL, email);
  expect((await meOf(other.page)).status).toBe(200);

  await openSecurity(page);
  const passwordSection = section(page, "كلمة المرور");
  // The rules run before anything is sent.
  await passwordSection.getByLabel("كلمة المرور الحالية", { exact: true }).fill(PASSWORD);
  await passwordSection.getByLabel("كلمة المرور الجديدة", { exact: true }).fill("1234567");
  await passwordSection.getByRole("button", { name: "غيّر كلمة المرور" }).click();
  await expect(passwordSection.getByText("كلمة المرور قصيرة، 8 أحرف على الأقل.")).toBeVisible();

  await passwordSection.getByLabel("كلمة المرور الجديدة", { exact: true }).fill(NEW_PASSWORD);
  await captchaIn(passwordSection);
  await passwordSection.getByRole("button", { name: "غيّر كلمة المرور" }).click();
  await expect(page.locator(":focus")).toContainText("تغيّرت كلمة مرورك");
  await rtlAndAxe(page);

  expect((await meOf(page)).status).toBe(200);
  expect((await meOf(other.page)).status).toBe(401);
  await other.context.close();

  // The new password signs in.
  const fresh = await browser.newContext({ baseURL, locale: "ar" });
  const freshPage = await fresh.newPage();
  await freshPage.goto("/login");
  await fillLogin(freshPage, email, NEW_PASSWORD);
  await captchaSolved(freshPage);
  await freshPage.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(freshPage).not.toHaveURL(/\/login/);
  await fresh.close();
});

test("DEC37: a made-up link says it is spent and points to the security page; a missing one says so", async ({
  page,
}) => {
  await page.goto(`/auth/email-change?token_hash=${"0".repeat(56)}`);
  await expect(page).toHaveURL(/\/auth\/email-change$/);
  await page.getByRole("button", { name: "تأكيد هذا العنوان" }).click();
  await expect(page.getByText("الرابط منتهٍ أو مستخدم")).toBeVisible();
  await expect(page.getByRole("link", { name: "صفحة الأمان" })).toHaveAttribute(
    "href",
    "/account/security",
  );
  await rtlAndAxe(page);
  await page.goto("/auth/email-change");
  await expect(page.getByText("الرابط ناقص")).toBeVisible();
});
