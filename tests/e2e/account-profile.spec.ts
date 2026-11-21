// Task 3.5 (plan/task-3.5.md): the account page /account (API015) and the profile edit
// /account/profile (API016) with real sessions on the local stack, at the three widths with axe.
// FR49, DEC58, DEC69 (API119), DEC77, TC21.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  changeMember,
  logIn,
  meOf,
  newEmail,
  openAccountMenu,
  signUpThroughApi,
  WCAG_22_AA,
} from "./auth-helpers.ts";

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

test("a guest opening /account or /account/profile is sent to the login page", async ({ page }) => {
  await page.goto("/account");
  // The layout streams first (app/loading.tsx), so the redirect completes in the browser.
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  await page.goto("/account/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fprofile$/);
  expect((await meOf(page)).status).toBe(401);
});

test("/account: the private email, the details and the profile link; RTL and axe", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("account");
  await signUpThroughApi(playwright, baseURL, email, "عضو صفحة الحساب");
  await logIn(page, email);

  await openAccountMenu(page);
  await page.locator("header").first().getByRole("link", { name: "صفحة حسابي" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "حسابي" })).toBeVisible();
  const details = page.locator("main dl");
  await expect(details).toContainText("عضو صفحة الحساب");
  await expect(details).toContainText(email);
  await expect(details).toContainText("بدون كلية");
  await expect(details.locator('bdi[dir="ltr"]')).toHaveText(email);
  await expect(page.getByRole("link", { name: "تعديل الملف" }).first()).toHaveAttribute(
    "href",
    "/account/profile",
  );
  await rtlAndAxe(page);

  // API015 with the same session: the private fields and DEC58's capabilities.
  const { status, me } = await meOf(page);
  expect(status).toBe(200);
  expect(me).toMatchObject({
    email,
    display_name: "عضو صفحة الحساب",
    capabilities: { market_write: true, admin: false },
  });
});

test("/account: new policy versions show the acknowledgment form, and it clears (API119)", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("terms");
  const id = await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  // As if new versions came out after signup: the member has acknowledged none in force.
  await changeMember(id, "delete from public.policy_acknowledgment where user_id = $1");

  await page.goto("/account");
  await expect(page.getByText("نُشرت نسخة جديدة من الشروط")).toBeVisible();
  expect((await meOf(page)).me).toMatchObject({
    terms_acknowledged: false,
    capabilities: { market_write: false },
  });
  await rtlAndAxe(page);

  await page.getByRole("button", { name: "موافقة" }).click();
  await expect(page.getByText("وافق على شروط الاستخدام للمتابعة.")).toBeVisible();
  await expect(page.getByLabel("أوافق على شروط الاستخدام")).toBeFocused();

  await page.getByLabel("أوافق على شروط الاستخدام").check();
  await page.getByLabel("قرأت سياسة الخصوصية").check();
  await page.getByRole("button", { name: "موافقة" }).click();
  await expect(page.getByText("نُشرت نسخة جديدة من الشروط")).toHaveCount(0);
  expect((await meOf(page)).me).toMatchObject({
    terms_acknowledged: true,
    capabilities: { market_write: true },
  });
});

test("/account/profile: save the name and college, and the header shows the new name", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("profile");
  await signUpThroughApi(playwright, baseURL, email, "الاسم قبل التعديل");
  await logIn(page, email);

  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { level: 1, name: "تعديل الملف" })).toBeVisible();
  await expect(page.getByLabel("الاسم")).toHaveValue("الاسم قبل التعديل");
  await rtlAndAxe(page);

  // Nothing changed yet: said so, with no request.
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("لم تغيّر شيئاً بعد.")).toBeVisible();

  await page.getByLabel("الاسم").fill("الاسم بعد التعديل");
  const college = page.getByLabel("الكلية");
  const firstCollege = await college.locator("option").nth(1).getAttribute("value");
  await college.selectOption(firstCollege ?? "");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/profile/me"));
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("حُفظت التغييرات.")).toBeVisible();

  await openAccountMenu(page);
  await expect(page.locator("header").first()).toContainText("الاسم بعد التعديل");
  expect((await meOf(page)).me).toMatchObject({
    display_name: "الاسم بعد التعديل",
    college: { id: firstCollege },
    version: 2,
  });
});

test("/account/profile: the field message, then the conflict after an edit elsewhere", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("conflict");
  const id = await signUpThroughApi(playwright, baseURL, email, "اسم قبل التعارض");
  await logIn(page, email);
  await page.goto("/account/profile");

  await page.getByLabel("الاسم").fill("ع");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("الاسم قصير، حرفان على الأقل.")).toBeVisible();
  await expect(page.getByLabel("الاسم")).toBeFocused();

  // Another tab or device saved meanwhile: the version moved on.
  await changeMember(
    id,
    "update public.profile set display_name = 'اسم من مكان آخر', version = version + 1 where id = $1",
  );
  await page.getByLabel("الاسم").fill("اسم بعد التعارض");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("تغيّر ملفك من مكان آخر")).toBeVisible();
  await page.getByRole("link", { name: "اعرض البيانات الحالية" }).click();
  await expect(page.getByLabel("الاسم")).toHaveValue("اسم من مكان آخر");
});
