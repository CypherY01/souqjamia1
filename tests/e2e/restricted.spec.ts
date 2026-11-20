// Task 3.3 (item 9, from task 3.1, item 14): /restricted with a real session in its three
// states (FR78, DEC41), reached by logging in, and sign-out from it.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  captchaSolved,
  changeMember,
  fillLogin,
  newEmail,
  signUpThroughApi,
  WCAG_22_AA,
} from "./auth-helpers.ts";

const STATES = [
  {
    name: "suspended",
    sql: "update public.account_control set status = 'suspended', suspended_until = '2030-01-02T09:00:00Z' where user_id = $1",
    text: "حسابك موقوف مؤقتاً",
  },
  {
    name: "banned",
    sql: "update public.account_control set status = 'banned' where user_id = $1",
    text: "حسابك محظور",
  },
  {
    name: "awaiting deletion",
    sql: "update public.account_control set deletion_requested_at = now() where user_id = $1",
    text: "حسابك بانتظار الحذف",
  },
] as const;

for (const state of STATES) {
  test(`FR78: a ${state.name} account logs in to /restricted, and signs out from it`, async ({
    page,
    playwright,
    baseURL,
  }) => {
    const email = newEmail("restricted");
    const userId = await signUpThroughApi(playwright, baseURL, email);
    await changeMember(userId, state.sql);

    await page.goto("/login?next=%2Fmarket");
    await fillLogin(page, email);
    await captchaSolved(page);
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await expect(page).toHaveURL(/\/restricted$/);
    await expect(page.getByRole("main")).toContainText(state.text);
    await expect(page.getByRole("main")).toContainText("contact@example.test");
    // Any other page sends the account back here (FR78).
    await page.goto("/login");
    await expect(page).toHaveURL(/\/restricted$/);

    const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);

    await page.getByRole("main").getByRole("button", { name: "خروج" }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
    await page.goto("/restricted");
    await expect(page).toHaveURL(/\/login$/);
  });
}
