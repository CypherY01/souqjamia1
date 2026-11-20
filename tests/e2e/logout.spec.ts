// Task 3.3 (items 1 and 8): sign-out from the account menu, the owner's finding in the review of
// task 3.2 (the old plain form showed CSRF_FAILED). FR49, DEC76, and TC56 as amended by the
// addendum (section 5): after sign-out the browser holds no session cookie, and no token or key
// in any storage; the old cookies, sent again, open nothing.
import { expect, test, type Page } from "@playwright/test";
import { logIn, newEmail, openAccountMenu, signUpThroughApi } from "./auth-helpers.ts";

/** Everything page JavaScript can read: cookies, both storages and the IndexedDB names. */
async function browserStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts = [document.cookie];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i) ?? "";
        parts.push(key, store.getItem(key) ?? "");
      }
    }
    const databases = await indexedDB.databases();
    parts.push(...databases.map((db) => db.name ?? ""));
    return parts.join("\n");
  });
}

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

test("sign-out from the account menu: home page, the visitor header, nothing left behind", async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const email = newEmail("logout");
  await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  const oldCookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
  expect(oldCookies.length).toBeGreaterThan(0);

  await openAccountMenu(page);
  const logout = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout"));
  await page.locator("header").first().getByRole("button", { name: "خروج" }).click();
  // The owner's finding: a 204, not a page with CSRF_FAILED.
  expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
  await expect(
    page
      .locator("header")
      .first()
      .getByRole("link", { name: "دخول", exact: true, includeHidden: true }),
  ).toHaveCount(1);

  // TC56: no session cookie, and nothing token-like or key-like where JavaScript can read it.
  expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"))).toEqual([]);
  const storage = await browserStorage(page);
  expect(storage).not.toMatch(JWT);
  expect(storage).not.toMatch(/sb_secret_|service_role|refresh_token|access_token/);

  // The old cookies sent again: the session was revoked, so the server sees a guest (its
  // access token still has minutes left, but its row in auth.sessions is gone).
  await context.addCookies(oldCookies);
  await page.goto("/");
  await expect(
    page
      .locator("header")
      .first()
      .getByRole("link", { name: "دخول", exact: true, includeHidden: true }),
  ).toHaveCount(1);
  await page.goto("/restricted");
  await expect(page).toHaveURL(/\/login$/);
});
