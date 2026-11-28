// Task 4.5 (plan/task-4.5.md): «المفضلة» and the favorite control. FR15, UC05, DEC86, API048,
// API049, API050, TC06. The layout and axe of /account/favorites (with an available and an
// unavailable item, and empty) at the three widths; the flows at 360 only (the rules are tested
// in integration, as in tasks 4.2 to 4.4).
import { expect, test, type Page } from "@playwright/test";
import {
  captchaSolved,
  changeMember,
  fillLogin,
  logIn,
  newEmail,
  signUpThroughApi,
} from "./auth-helpers.ts";
import { insertListing, rtlAndAxe, uniqueWord } from "./market-helpers.ts";

const ONE_WIDTH = "mobile-360";

function only360(): void {
  test.skip(test.info().project.name !== ONE_WIDTH, "the flow is the same at every width");
}

type Playwright = Parameters<typeof signUpThroughApi>[0];

/** A seller who never signs in here: the listings belong to them. */
async function sellerId(playwright: Playwright, baseURL: string | undefined): Promise<string> {
  return signUpThroughApi(playwright, baseURL, newEmail("fav-seller"));
}

/** A member signed in on the page. */
async function member(page: Page, playwright: Playwright, baseURL: string | undefined) {
  const email = newEmail("fav");
  const id = await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  return { id, email };
}

function card(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]').first()).toBeAttached();
}

const ARCHIVE =
  "update public.listing set status = 'archived', previous_status = 'active', archive_reason = 'owner', archived_at = now() where id = $1";

async function saveThroughApi(page: Page, listingId: string): Promise<void> {
  const token = await page.evaluate(async () => {
    const response = await fetch("/api/csrf");
    const body = (await response.json()) as { data: { token: string } };
    return body.data.token;
  });
  const status = await page.evaluate(
    async ([id, csrf]) => {
      const response = await fetch(`/api/favorites/${id}`, {
        method: "PUT",
        headers: { "x-csrf-token": csrf },
      });
      return response.status;
    },
    [listingId, token] as const,
  );
  expect(status).toBe(204);
}

test("FR15 «المفضلة» is right to left, without horizontal scrolling or WCAG 2.2 AA violations", async ({
  page,
  playwright,
  baseURL,
}) => {
  const seller = await sellerId(playwright, baseURL);
  await member(page, playwright, baseURL);

  await page.goto("/account/favorites");
  await expect(page.getByRole("heading", { level: 1, name: "المفضلة" })).toBeVisible();
  await expect(page.getByText("لم تحفظ أي إعلان بعد")).toBeVisible();
  await rtlAndAxe(page);

  const word = uniqueWord();
  const shown = await insertListing(seller, { title: `مصباح محفوظ ${word}` });
  const gone = await insertListing(seller, { title: `مصباح سيختفي ${word}` });
  await saveThroughApi(page, shown);
  await saveThroughApi(page, gone);
  await changeMember(gone, ARCHIVE);
  await page.goto("/account/favorites");
  await expect(card(page, `مصباح محفوظ ${word}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "إعلان غير متاح" })).toBeVisible();
  await rtlAndAxe(page);

  await page.goto(`/market?q=${word}`);
  await expect(card(page, `مصباح محفوظ ${word}`)).toBeVisible();
  await rtlAndAxe(page);
});

test("TC06 save from a market card with the keyboard, then remove it from «المفضلة»", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await sellerId(playwright, baseURL);
  await member(page, playwright, baseURL);
  const title = `حقيبة ظهر ${uniqueWord()}`;
  await insertListing(seller, { title });

  await page.goto(`/market?q=${encodeURIComponent(title)}`);
  await hydrated(page);
  const save = card(page, title).getByRole("button", { name: `احفظ في المفضلة: ${title}` });
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  const saved = card(page, title).getByRole("button", {
    name: `محفوظ في المفضلة، اضغط للإزالة: ${title}`,
  });
  await expect(saved).toBeVisible();
  await expect(saved).toContainText("محفوظ");
  await expect(page.getByRole("status").filter({ hasText: "حُفظ في المفضلة." })).toBeAttached();
  // The control never opened the listing.
  await expect(page).toHaveURL(/\/market\?/);

  // Reloaded: the server's is_favorite says it is saved.
  await page.reload();
  await expect(
    card(page, title).getByRole("button", { name: `محفوظ في المفضلة، اضغط للإزالة: ${title}` }),
  ).toBeVisible();

  await page.goto("/account/favorites");
  await hydrated(page);
  await card(page, title)
    .getByRole("button", { name: `محفوظ في المفضلة، اضغط للإزالة: ${title}` })
    .click();
  await expect(card(page, title)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "الإعلانات المحفوظة" })).toBeFocused();
  await expect(page.getByText("لم تحفظ أي إعلان بعد")).toBeVisible();
});

test("UC05 a guest is sent to sign in and comes back to the listing, then saves it", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await sellerId(playwright, baseURL);
  const email = newEmail("fav-guest");
  await signUpThroughApi(playwright, baseURL, email);
  const title = `آلة حاسبة ${uniqueWord()}`;
  const id = await insertListing(seller, { title });

  await page.goto(`/listing/${id}`);
  await page.getByRole("link", { name: `سجّل الدخول لتحفظ في المفضلة: ${title}` }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await fillLogin(page, email);
  await captchaSolved(page);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/listing/${id}$`));

  // click() waits until hydration enables the button (SubmitButton, task 4.0).
  await page.getByRole("button", { name: `احفظ في المفضلة: ${title}` }).click();
  await expect(page.getByRole("button", { name: /محفوظ في المفضلة/ })).toContainText(
    "محفوظ في المفضلة",
  );
});

test("UC05 a saved listing archived later is «غير متاح» without its title, and is removed after a confirmation", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await sellerId(playwright, baseURL);
  await member(page, playwright, baseURL);
  const word = uniqueWord();
  const id = await insertListing(seller, { title: `سماعة ${word}` });
  await page.goto("/account/favorites");
  await saveThroughApi(page, id);
  await changeMember(id, ARCHIVE);

  await page.goto("/account/favorites");
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "إعلان غير متاح" })).toBeVisible();
  await expect(page.getByText(word)).toHaveCount(0);
  await expect(page.locator(`a[href*="${id}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: "إزالة" }).click();
  const dialog = page.getByRole("dialog", { name: "إزالة إعلان غير متاح؟" });
  await dialog.getByRole("button", { name: "أزل" }).click();
  await expect(page.getByRole("heading", { name: "إعلان غير متاح" })).toHaveCount(0);
  await expect(page.getByText("لم تحفظ أي إعلان بعد")).toBeVisible();
});
