// Task 4.4 (plan/task-4.4.md): «إعلاناتي» and «تعديل إعلان». FR23, FR24, BR27, DEC09, API033,
// API035, API036, TC34, TC35. The layout and axe of both pages at the three widths; the flows at
// 360 only (the rules are tested in integration, as in tasks 4.2 and 4.3).
import { expect, test, type Page } from "@playwright/test";
import { logIn, newEmail, signUpThroughApi } from "./auth-helpers.ts";
import { insertListing, rtlAndAxe, uniqueWord } from "./market-helpers.ts";

const ONE_WIDTH = "mobile-360";

function only360(): void {
  test.skip(test.info().project.name !== ONE_WIDTH, "the flow is the same at every width");
}

type Playwright = Parameters<typeof signUpThroughApi>[0];

async function seller(
  page: Page,
  playwright: Playwright,
  baseURL: string | undefined,
): Promise<string> {
  const email = newEmail("mine");
  const id = await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  return id;
}

function card(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached();
}

test("FR23 FR24 «إعلاناتي» and «تعديل إعلان» are right to left, without horizontal scrolling or WCAG 2.2 AA violations", async ({
  page,
  playwright,
  baseURL,
}) => {
  const id = await seller(page, playwright, baseURL);
  const word = uniqueWord();
  const active = await insertListing(id, { title: `مكتب نشط ${word}` });
  await insertListing(id, { title: `مكتب مخفي ${word}`, hidden: true, ageSeconds: 5 });
  await insertListing(id, { title: `مكتب مباع ${word}`, status: "sold" });
  await insertListing(id, { title: `مكتب مؤرشف ${word}`, status: "archived" });

  for (const tab of ["active", "sold", "archived"]) {
    await page.goto(`/account/listings?status=${tab}`);
    await expect(page.getByRole("heading", { level: 1, name: "إعلاناتي" })).toBeVisible();
    await rtlAndAxe(page);
  }
  await page.goto(`/account/listings/${active}/edit`);
  await expect(page.getByRole("heading", { level: 1, name: "تعديل إعلان" })).toBeVisible();
  await rtlAndAxe(page);
});

test("FR24 the tabs are plain links, and the hidden listing has no action", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const id = await seller(page, playwright, baseURL);
  const word = uniqueWord();
  await insertListing(id, { title: `كرسي مخفي ${word}` });
  await insertListing(id, { title: `كرسي مخفي إدارياً ${word}`, hidden: true });
  await insertListing(id, { title: `كرسي مؤرشف ${word}`, status: "archived" });

  await page.goto("/account/listings");
  const tabs = page.getByRole("navigation", { name: "حالة الإعلانات" });
  await expect(tabs.getByRole("link", { name: "نشطة" })).toHaveAttribute("aria-current", "page");
  // Plain links to ?status=: the browser follows them with or without JavaScript.
  await expect(tabs.getByRole("link", { name: "مؤرشفة" })).toHaveAttribute(
    "href",
    "/account/listings?status=archived",
  );
  const hidden = card(page, `كرسي مخفي إدارياً ${word}`);
  await expect(hidden.getByText("مخفي إدارياً", { exact: true })).toBeVisible();
  await expect(hidden.getByRole("button")).toHaveCount(0);
  await expect(hidden.getByRole("link")).toHaveCount(0);
  await expect(
    card(page, `كرسي مخفي ${word}`).getByRole("button", { name: "أرشفة" }),
  ).toBeVisible();

  await tabs.getByRole("link", { name: "مؤرشفة" }).click();
  await expect(page).toHaveURL(/status=archived/);
  await expect(tabs.getByRole("link", { name: "مؤرشفة" })).toHaveAttribute("aria-current", "page");
  await expect(card(page, `كرسي مؤرشف ${word}`).getByText(/يمكن استرجاعه حتى/)).toBeVisible();
});

test("FR24 BR27 mark sold after the confirmation: the listing moves to «مباعة» with no restore", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const id = await seller(page, playwright, baseURL);
  const title = `دراجة للبيع ${uniqueWord()}`;
  await insertListing(id, { title });

  await page.goto("/account/listings");
  await hydrated(page);
  await card(page, title).getByRole("button", { name: "تحديد كمباع" }).click();
  const dialog = page.getByRole("dialog", { name: "تحديد الإعلان كمباع؟" });
  await expect(dialog.getByText(/«مباع» نهائي/)).toBeVisible();
  await dialog.getByRole("button", { name: "نعم، بعته" }).click();
  await expect(page.getByText("حُدّد الإعلان كمباع، وانتقل إلى تبويب «مباعة».")).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);

  await page.getByRole("link", { name: "افتح التبويب" }).click();
  await expect(page).toHaveURL(/status=sold/);
  const sold = card(page, title);
  await expect(sold.getByText("بيع في")).toBeVisible();
  await expect(sold.getByRole("button", { name: /استرجاع/ })).toHaveCount(0);
  await expect(sold.getByRole("link", { name: /تعديل/ })).toHaveCount(0);
});

test("TC34 archive then restore within the window, and a STATE_CONFLICT says to refresh", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const id = await seller(page, playwright, baseURL);
  const title = `خزانة للأرشفة ${uniqueWord()}`;
  await insertListing(id, { title });

  await page.goto("/account/listings");
  await hydrated(page);
  await card(page, title).getByRole("button", { name: "أرشفة" }).click();
  await page
    .getByRole("dialog", { name: "أرشفة الإعلان؟" })
    .getByRole("button", { name: "نعم، أرشفه" })
    .click();
  await expect(page.getByText("أُرشف الإعلان، وانتقل إلى تبويب «مؤرشفة».")).toBeVisible();

  await page.goto("/account/listings?status=archived");
  await hydrated(page);
  const archived = card(page, title);
  await expect(archived.getByText(/يمكن استرجاعه حتى/)).toBeVisible();

  // A conflict from the server (another tab changed it): the message and the refresh link.
  await page.route("**/api/listings/*/transition", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "STATE_CONFLICT", message: "", trace_id: "t" }),
    }),
  );
  await archived.getByRole("button", { name: `استرجاع الإعلان: ${title}` }).click();
  await expect(archived.getByText(/تغيّر الإعلان منذ فتحت الصفحة/)).toBeVisible();
  await expect(archived.getByRole("link", { name: "حدّث الصفحة" })).toBeVisible();
  await page.unroute("**/api/listings/*/transition");

  await archived.getByRole("button", { name: `استرجاع الإعلان: ${title}` }).click();
  await expect(page.getByText("استُرجع الإعلان، وعاد إلى تبويب «نشطة» والسوق.")).toBeVisible();
  await page.goto("/account/listings");
  await expect(card(page, title)).toBeVisible();
});

test("FR23 an edit is saved and shown on the listing page; a field error stays at its field", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const id = await seller(page, playwright, baseURL);
  const word = uniqueWord();
  const listing = await insertListing(id, { title: `طاولة قبل التعديل ${word}` });

  // The seller's note on the listing page leads to «إعلاناتي», and from there to the edit.
  await page.goto(`/listing/${listing}`);
  await page.getByRole("link", { name: "إدارة إعلاناتي" }).click();
  await expect(page).toHaveURL(/\/account\/listings$/);
  await card(page, `طاولة قبل التعديل ${word}`)
    .getByRole("link", { name: `تعديل الإعلان: طاولة قبل التعديل ${word}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/account/listings/${listing}/edit$`));

  const title = page.getByLabel("العنوان", { exact: true });
  await expect(page.getByRole("button", { name: "احفظ التعديلات" })).toBeEnabled();
  await title.fill("قصير");
  await page.getByRole("button", { name: "احفظ التعديلات" }).click();
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute("aria-invalid", "true");

  await title.fill(`طاولة بعد التعديل ${word}`);
  await page.getByLabel("السعر بالريال").fill("120.50");
  await page.getByRole("button", { name: "احفظ التعديلات" }).click();
  await expect(page.getByText("حُفظت التعديلات")).toBeVisible();

  await page.goto(`/listing/${listing}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `طاولة بعد التعديل ${word}` }),
  ).toBeVisible();
  await expect(page.getByText("120.50 ريال").first()).toBeVisible();
});
