// Task 3.3 (items 6 and 9): /login at 360, 768 and 1440 px against the local stack. FR02, TC02,
// RL01 as the visitor sees it, the member header after login, and the page's accessibility.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  captchaSolved,
  fillLogin,
  logIn,
  newEmail,
  openAccountMenu,
  signUpThroughApi,
  WCAG_22_AA,
} from "./auth-helpers.ts";

test("the login page passes axe, with its links", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByRole("link", { name: "نسيت كلمة المرور؟" })).toHaveAttribute(
    "href",
    "/recover",
  );
  await expect(page.getByRole("link", { name: "أنشئ حساباً" })).toHaveAttribute("href", "/signup");
  await captchaSolved(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("FR02: login leads home, with the member header and cookies JavaScript cannot read", async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const email = newEmail();
  const request = await playwright.request.newContext({ baseURL });
  await signUpThroughApi(request, baseURL ?? "", email, "عضو اختبار الشريط");
  await request.dispose();

  await logIn(page, email);
  await expect(page).toHaveURL(/\/$/);
  await openAccountMenu(page);
  const header = page.locator("header").first();
  await expect(header.getByText("عضو اختبار الشريط")).toBeVisible();
  await expect(header.getByRole("button", { name: "خروج" })).toBeVisible();

  const session = (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
  expect(session.length).toBeGreaterThan(0);
  for (const cookie of session) expect(cookie.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");

  // A signed-in member opening /login goes on.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
});

test("a wrong password: one general message, no session cookie", async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const email = newEmail();
  const request = await playwright.request.newContext({ baseURL });
  await signUpThroughApi(request, baseURL ?? "", email);
  await request.dispose();

  await page.goto("/login");
  await fillLogin(page, email, "wrong-password-1");
  await captchaSolved(page);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "البريد أو كلمة المرور غير صحيحة.",
  );
  expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"))).toEqual([]);
});

test("TC02: an outside next is dropped, a local one is followed", async ({
  page,
  playwright,
  baseURL,
}) => {
  const request = await playwright.request.newContext({ baseURL });
  const outside = newEmail();
  const local = newEmail();
  await signUpThroughApi(request, baseURL ?? "", outside);
  await signUpThroughApi(request, baseURL ?? "", local);
  await request.dispose();

  await logIn(page, outside, "/login?next=https%3A%2F%2Fevil.example%2F");
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);

  await page.context().clearCookies();
  await logIn(page, local, "/login?next=%2Fdev%2Fui%3Ffrom%3Dlogin");
  await expect(page).toHaveURL(/\/dev\/ui\?from=login$/);
});

test("RL01: after five wrong passwords the page shows the wait", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.skip(test.info().project.name !== "desktop-1440", "one width is enough for the limit");
  const email = newEmail("rl01");
  const request = await playwright.request.newContext({ baseURL });
  await signUpThroughApi(request, baseURL ?? "", email);
  await request.dispose();

  await page.goto("/login");
  const alert = page.getByRole("main").getByRole("alert");
  for (let attempt = 1; attempt <= 6; attempt++) {
    await fillLogin(page, email, `wrong-password-${String(attempt)}`);
    await captchaSolved(page);
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await expect(page.getByRole("button", { name: "دخول", exact: true })).toBeEnabled();
    if (attempt < 6) await expect(alert).toContainText("البريد أو كلمة المرور غير صحيحة.");
  }
  await expect(alert).toContainText(/محاولات دخول كثيرة\. حاول مرة أخرى خلال .+\./);
});
