// Task 3.4: password recovery at 360, 768 and 1440 px against the local stack. FR03, TC03 as the
// visitor sees it (the link page spends nothing on GET, the token leaves the address), the new
// password and the login with it, "sign out and continue" (owner decision on item 2), and the
// pages' accessibility. The email links point to the site address of config.toml (port 3000), so
// only their path and query are opened on the test server.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readLocalStack } from "../../scripts/local-supabase.ts";
import {
  captchaSolved,
  fillLogin,
  logIn,
  newEmail,
  openAccountMenu,
  signUpThroughApi,
  WCAG_22_AA,
} from "./auth-helpers.ts";

const NEW_PASSWORD = "كلمة-مرور-جديدة-2";
const RECOVERY_SUBJECT = "استعادة كلمة المرور في سوق الجامعة";

/** A recovery link through the Auth admin API (local secret key only), without an email. */
async function generatedLink(email: string): Promise<string> {
  const stack = readLocalStack();
  const res = await fetch(`${stack.apiUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: stack.secretKey,
      authorization: `Bearer ${stack.secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "recovery", email }),
  });
  expect(res.status).toBe(200);
  const { hashed_token } = (await res.json()) as { hashed_token: string };
  return `/auth/recover?token_hash=${hashed_token}`;
}

/** The path and query of the recovery link in the newest recovery email to `email`. */
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

async function axeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

test("/recover: the general answer for an unknown address, and axe", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "نسيت كلمة المرور؟" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await expect(page.getByRole("heading", { level: 1, name: "نسيت كلمة المرور" })).toBeVisible();
  await captchaSolved(page);
  await axeClean(page);

  await page.getByLabel("البريد الإلكتروني").fill(newEmail("nobody"));
  await page.getByRole("button", { name: "إرسال الرابط" }).click();
  // A success is announced politely (role=status, task 1.5).
  const sent = page.getByRole("main").getByRole("status").filter({ hasText: "تحقق من بريدك" });
  await expect(sent).toBeVisible();
  await expect(sent).toContainText("إن كان هذا البريد مسجّلاً");
  // The address never goes into the page address.
  expect(page.url()).not.toContain("@");
  await expect(page.getByRole("button", { name: "إرسال رابط جديد" })).toBeDisabled();
});

test("FR03: request, the emailed link, a new password, then the login with it", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("recover");
  await signUpThroughApi(playwright, baseURL, email, "عضو اختبار الاستعادة");

  await page.goto("/recover");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await captchaSolved(page);
  await page.getByRole("button", { name: "إرسال الرابط" }).click();
  await expect(
    page.getByRole("main").getByRole("status").filter({ hasText: "تحقق من بريدك" }),
  ).toBeVisible();

  // The link page: GET only shows the button, and the token leaves the address.
  await page.goto(await mailedLink(email));
  await expect(page).toHaveURL(/\/auth\/recover$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "تعيين كلمة مرور جديدة" }),
  ).toBeVisible();
  await axeClean(page);
  await page.getByRole("button", { name: "متابعة لتعيين كلمة المرور" }).click();

  await expect(page).toHaveURL(/\/account\/reset$/);
  await expect(page.getByRole("heading", { level: 1, name: "كلمة مرور جديدة" })).toBeVisible();
  // DEC75: the rule under the field, no counter for a short password.
  await expect(page.getByText("8 أحرف على الأقل")).toBeVisible();
  await axeClean(page);
  // The recovery session is limited (DEC73): the header stays the visitor's.
  await expect(page.locator("header").first().getByRole("button", { name: "حسابي" })).toHaveCount(
    0,
  );

  await page.getByLabel("كلمة المرور الجديدة", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1$/);
  await expect(page.getByText("عُيّنت كلمة المرور الجديدة")).toBeVisible();

  await fillLogin(page, email, NEW_PASSWORD);
  await captchaSolved(page);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await openAccountMenu(page);
  await expect(page.locator("header").first().getByText("عضو اختبار الاستعادة")).toBeVisible();
});

test("TC03: a spent or broken link offers a new one; a missing token says so", async ({ page }) => {
  await page.goto(`/auth/recover?token_hash=${"0".repeat(56)}`);
  await expect(page).toHaveURL(/\/auth\/recover$/);
  await page.getByRole("button", { name: "متابعة لتعيين كلمة المرور" }).click();
  await expect(
    page.getByRole("main").getByRole("status").filter({ hasText: "الرابط انتهى أو استُخدم" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "اطلب رابطاً جديداً" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إرسال الرابط" })).toBeVisible();
  await captchaSolved(page);
  await axeClean(page);

  await page.goto("/auth/recover");
  await expect(page.getByText("الرابط غير مكتمل")).toBeVisible();
});

test("/account/reset without a recovery session explains itself", async ({ page }) => {
  await page.goto("/account/reset");
  await expect(page.getByText("افتح الرابط من بريدك")).toBeVisible();
  await expect(page.getByRole("link", { name: "طلب رابط استعادة" })).toHaveAttribute(
    "href",
    "/recover",
  );
  await axeClean(page);
});

test("item 2: signed in with another account, one button signs out and continues", async ({
  page,
  playwright,
  baseURL,
}) => {
  const signedIn = newEmail("signed-in");
  await signUpThroughApi(playwright, baseURL, signedIn);
  const other = newEmail("recover-other");
  await signUpThroughApi(playwright, baseURL, other);
  await logIn(page, signedIn);

  await page.goto(await generatedLink(other));
  await expect(page.getByText("أنت مسجّل دخول بحساب آخر")).toBeVisible();
  await expect(page.getByRole("button", { name: "متابعة لتعيين كلمة المرور" })).toHaveCount(0);
  await axeClean(page);
  await page.getByRole("button", { name: "اخرج وأكمل الاستعادة" }).click();

  await expect(page).toHaveURL(/\/account\/reset$/);
  await expect(page.getByLabel("كلمة المرور الجديدة", { exact: true })).toBeVisible();
  await expect(page.locator("header").first().getByRole("button", { name: "حسابي" })).toHaveCount(
    0,
  );
});
