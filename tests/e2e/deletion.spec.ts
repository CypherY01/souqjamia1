// Task 3.7 (plan/task-3.7.md): the deletion request page /account/delete, the recovery form on
// /restricted, the recovery link page and its result, with real sessions on the local stack, at
// the three widths with axe. FR72, DEC38, DEC41, TC59 as the member sees them. The email links
// point to the site address of config.toml (port 3000), so only their path and query are opened
// on the test server.
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readLocalStack } from "../../scripts/local-supabase.ts";
import {
  captchaSolved,
  changeMember,
  fillLogin,
  logIn,
  meOf,
  newEmail,
  PASSWORD,
  signUpThroughApi,
  WCAG_22_AA,
} from "./auth-helpers.ts";

const RECOVERY_SUBJECT = "استرجاع حسابك في سوق الجامعة";

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

/** The path and query of the recovery link in the newest such email to `email`. */
async function mailedLink(email: string): Promise<string> {
  const { mailpitUrl } = readLocalStack();
  const query = encodeURIComponent(`to:"${email}" subject:"${RECOVERY_SUBJECT}"`);
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

/** Turnstile has handed this form its token. */
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

async function openDelete(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByRole("link", { name: "حذف الحساب", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/delete$/);
  await expect(page.getByRole("heading", { level: 1, name: "حذف الحساب" })).toBeVisible();
}

/** Logs in an account awaiting deletion: it lands on /restricted only (DEC41). */
async function logInPending(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await fillLogin(page, email);
  await captchaSolved(page);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).toHaveURL(/\/restricted$/);
}

test("a guest opening /account/delete is sent to the login page", async ({ page }) => {
  await page.goto("/account/delete");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fdelete$/);
});

test("FR72 as the member sees it: the request, /restricted, the mailed link, then the account again; RTL and axe", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("deletion");
  await signUpThroughApi(playwright, baseURL, email, "عضو حذف الحساب");
  await logIn(page, email);
  await openDelete(page);
  await expect(page.getByText("تختفي إعلاناتك وطلباتك وملفك عن الآخرين فوراً")).toBeVisible();
  await rtlAndAxe(page);

  // The login was within 5 minutes, so the confirmation is open (DEC38); the box comes first.
  await expect(page.getByText(/التحقق صالح حتى/)).toBeVisible();
  const submit = page.getByRole("button", { name: "احذف حسابي" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("قرأت ما سبق، وأريد حذف حسابي").check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator(":focus")).toContainText("استلمنا طلب حذف حسابك");
  await rtlAndAxe(page);
  // Every session has ended (SEC01).
  expect((await meOf(page)).status).toBe(401);

  // Signing in during the period opens /restricted only, with the recovery form (DEC41).
  await logInPending(page, email);
  await expect(page.getByRole("main")).toContainText("حسابك بانتظار الحذف");
  const recovery = section(page, "استرجاع الحساب");
  await expect(recovery.locator("bdi[dir='ltr']", { hasText: email })).toBeVisible();
  await rtlAndAxe(page);
  await captchaIn(recovery);
  await recovery.getByRole("button", { name: "أرسل رابط الاسترجاع" }).click();
  await expect(page.locator(":focus")).toContainText("أرسلنا رابط الاسترجاع");

  // The link: GET shows a button, and the token leaves the address.
  await page.goto(await mailedLink(email));
  await expect(page).toHaveURL(/\/auth\/account-recovery$/);
  await rtlAndAxe(page);
  await page.getByRole("button", { name: "استرجع حسابي" }).click();
  await expect(page).toHaveURL(/\/auth\/account-recovery\/done$/);
  await expect(page.getByText("ألغينا طلب حذف حسابك")).toBeVisible();
  await rtlAndAxe(page);
  // This browser kept the session it signed in with: it is an ordinary one again.
  await page.getByRole("link", { name: "إلى حسابي" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "حسابي" })).toBeVisible();
  expect((await meOf(page)).me?.deletion_requested_at).toBeNull();
});

test("DEC38: when the window has closed, the password comes first, then the deletion", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("deletion-reauth");
  await signUpThroughApi(playwright, baseURL, email, "عضو إعادة التحقق للحذف");
  await logIn(page, email);
  await openDelete(page);
  // The server's answer once 5 minutes have passed, for the first request only.
  let refused = false;
  await page.route("**/api/profile/deletion", async (route) => {
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
  await page.getByLabel("قرأت ما سبق، وأريد حذف حسابي").check();
  await page.getByRole("button", { name: "احذف حسابي" }).click();

  const confirm = section(page, "تأكيد الحذف");
  await expect(confirm.getByRole("heading", { level: 3, name: "أكّد كلمة مرورك" })).toBeVisible();
  await expect(confirm.getByText("انتهت دقائق التحقق الخمس")).toBeVisible();
  await rtlAndAxe(page);
  await confirm.getByLabel("كلمة المرور الحالية", { exact: true }).fill(PASSWORD);
  await captchaIn(confirm);
  await confirm.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(page.getByText(/التحقق صالح حتى/)).toBeVisible();
  // The box kept its choice; the request now goes through with the new session.
  await page.getByRole("button", { name: "احذف حسابي" }).click();
  await expect(page.locator(":focus")).toContainText("استلمنا طلب حذف حسابك");
  expect((await meOf(page)).status).toBe(401);
});

test("TC59 as the member sees it: after 30 days /restricted has no recovery form", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("deletion-expired");
  const userId = await signUpThroughApi(playwright, baseURL, email, "عضو بعد المهلة");
  await changeMember(
    userId,
    "update public.account_control set deletion_requested_at = now() - interval '31 days' where user_id = $1",
  );
  await logInPending(page, email);
  await expect(page.getByRole("main")).toContainText("انتهت مهلة الاسترجاع");
  await expect(page.getByRole("button", { name: "أرسل رابط الاسترجاع" })).toHaveCount(0);
  await rtlAndAxe(page);
});

test("a spent or made-up link, and an incomplete one, say how to get a new link", async ({
  page,
}) => {
  await page.goto(`/auth/account-recovery?token_hash=${randomBytes(28).toString("hex")}`);
  await expect(page).toHaveURL(/\/auth\/account-recovery$/);
  await page.getByRole("button", { name: "استرجع حسابي" }).click();
  await expect(page.getByText("الرابط انتهى أو استُخدم")).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "الدخول", exact: true }),
  ).toBeVisible();
  await rtlAndAxe(page);

  await page.goto("/auth/account-recovery");
  await expect(page.getByText("الرابط غير مكتمل")).toBeVisible();
  await rtlAndAxe(page);
});
