// Task 3.1, item 14 (FR78): /restricted and its component. The E2E job has no Supabase until
// task 3.2, so the restricted states themselves are covered by the gallery here and by
// tests/integration/auth-guards.test.ts with real sessions. axe runs on /dev/ui in shell.spec.ts.
import { expect, test } from "@playwright/test";

test("a guest opening /restricted is sent to the login page", async ({ page }) => {
  await page.goto("/restricted");
  // The layout streams first (app/loading.tsx), so the redirect completes in the browser.
  await expect(page).toHaveURL(/\/login$/);
});

test("a forged session cookie is a guest: login page, and the visitor header", async ({
  page,
  context,
  baseURL,
}) => {
  // "not-a-session", base64url: what a tampered or stale cookie could hold.
  await context.addCookies([
    { name: "sb-127-auth-token", value: "base64-bm90LWEtc2Vzc2lvbg", url: baseURL ?? "" },
  ]);
  await page.goto("/restricted");
  // The layout streams first (app/loading.tsx), so the redirect completes in the browser.
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  const header = page.locator("header").first();
  await expect(
    header.getByRole("link", { name: "دخول", exact: true, includeHidden: true }),
  ).toHaveCount(1);
});

test("the gallery shows the three restricted states with the contact address", async ({ page }) => {
  await page.goto("/dev/ui");
  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "الحساب المقيّد", exact: true }),
  });
  await expect(section.getByText("حسابك موقوف مؤقتاً")).toBeVisible();
  await expect(section.getByText("حسابك محظور")).toBeVisible();
  await expect(section.getByText("حسابك بانتظار الحذف")).toBeVisible();
  const links = section.locator('a[href="mailto:contact@example.test"]');
  await expect(links).toHaveCount(3);
  await expect(links.first()).toHaveAttribute("dir", "ltr");
  await expect(section.locator("time")).toHaveCount(2);
});
