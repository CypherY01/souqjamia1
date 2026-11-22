// Task 3.8 (plan/task-3.8.md): /notifications (API078, API079, API115) and
// /account/notifications (API029) with real sessions on the local stack, at the three widths
// with axe. FR48, FR68, BR38, DEC49, DEC65. The worker's email is tested in integration.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  changeMember,
  logIn,
  meOf,
  newEmail,
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

/**
 * Notifications written straight into the table as postgres, older first. No email job is
 * queued this way (app.notify is what queues it), so nothing is left for a worker.
 */
async function addNotifications(userId: string, count: number): Promise<void> {
  await changeMember(
    userId,
    `insert into public.notification
       (recipient_id, event_type, context_type, context_id, dedupe_key, created_at)
     select $1, 'account.deletion_recovered', 'account', $1, 'e2e:' || gen_random_uuid(),
            now() - (n || ' minutes')::interval
       from generate_series(1, ${String(count)}) as n`,
  );
}

async function unreadOf(page: Page): Promise<number> {
  const response = await page.request.get("/api/notifications/unread-count");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: { count: number } }).data.count;
}

test("/notifications: a guest is sent to the login page", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/login\?next=%2Fnotifications$/);
  expect((await page.request.get("/api/notifications")).status()).toBe(401);
});

test("/notifications: the empty state for a new member; RTL and axe", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("notify-empty");
  await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "الإشعارات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "لا إشعارات بعد" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تفضيلات البريد" })).toHaveAttribute(
    "href",
    "/account/notifications",
  );
  await rtlAndAxe(page);
});

test("/notifications: unread items, the header count, opening one and marking all read", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("notify-list");
  const id = await signUpThroughApi(playwright, baseURL, email);
  await addNotifications(id, 2);
  await logIn(page, email);
  await page.goto("/notifications");

  const list = page.getByRole("list", { name: "قائمة الإشعارات" });
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(2);
  // Unread is said in text, not only by color.
  await expect(list.getByText("غير مقروء", { exact: true })).toHaveCount(2);
  await expect(page.locator("header").first()).toContainText("2 غير مقروءة");
  expect(await unreadOf(page)).toBe(2);
  await rtlAndAxe(page);

  // FR48: opening an item marks it read and goes to the destination the server derived.
  await items.first().getByRole("link", { name: "استُرجع حسابك، وأُلغي طلب الحذف." }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect(await unreadOf(page)).toBe(1);

  await page.goto("/notifications");
  await expect(list.getByText("غير مقروء", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "علّم الكل كمقروء" }).click();
  // The result takes the focus (its wrapper), and stays after the page refreshes.
  await expect(page.locator(":focus")).toContainText("عُلّمت الإشعارات المعروضة كمقروءة.");
  await expect(list.getByText("غير مقروء", { exact: true })).toHaveCount(0);
  expect(await unreadOf(page)).toBe(0);
  await expect(page.locator("header").first()).not.toContainText("غير مقروءة");
});

test("/account/notifications: optional groups off, required email shown, one group saved", async ({
  page,
  playwright,
  baseURL,
}) => {
  const email = newEmail("notify-prefs");
  await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  await page.goto("/account");
  await page.getByRole("link", { name: "تفضيلات البريد" }).click();
  await expect(page).toHaveURL(/\/account\/notifications$/);
  await expect(page.getByRole("heading", { level: 1, name: "تفضيلات البريد" })).toBeVisible();

  // BR38: required email is a fact with a badge, not a control.
  const required = page.getByRole("region", { name: "بريد الأمان والإدارة" });
  await expect(required).toContainText("إلزامي");
  await expect(required.getByRole("checkbox")).toHaveCount(0);
  // DEC49, DEC65: the five optional groups, all off.
  const groups = page.getByRole("group", { name: "مجموعات البريد الاختيارية" });
  await expect(groups.getByRole("checkbox")).toHaveCount(5);
  for (const box of await groups.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await rtlAndAxe(page);

  await page.getByRole("button", { name: "حفظ التفضيلات" }).click();
  await expect(page.locator(":focus")).toContainText("لم تغيّر شيئاً بعد.");

  await groups.getByLabel("عروض الأسعار").check();
  await page.getByRole("button", { name: "حفظ التفضيلات" }).click();
  await expect(page.locator(":focus")).toContainText("حُفظت التفضيلات.");
  const { me } = await meOf(page);
  expect(me?.preferences).toEqual({
    email_groups: { offers: true, meetups: false, deals: false, reviews: false, reports: false },
    version: 2,
  });
  await page.reload();
  await expect(groups.getByLabel("عروض الأسعار")).toBeChecked();
  await expect(groups.getByLabel("الصفقات")).not.toBeChecked();
});
