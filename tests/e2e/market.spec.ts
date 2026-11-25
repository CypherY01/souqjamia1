// Task 4.3 (plan/task-4.3.md): the home page, /market and /listing/{id}. FR06 to FR13, NFR14,
// RL04, DEC84, TC04, TC05, TC29, TC31, TC81. The layout and axe of each page at the three widths;
// the functional flows at 360 only (the rules are tested in integration, as in task 4.2).
// The wizard's link to the listing page and its images after media.publish are in sell.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { newEmail, signUpThroughApi } from "./auth-helpers.ts";
import {
  brokenImages,
  insertListing,
  insertListings,
  rtlAndAxe,
  uniqueWord,
} from "./market-helpers.ts";

const ONE_WIDTH = "mobile-360";

function only360(): void {
  test.skip(test.info().project.name !== ONE_WIDTH, "the flow is the same at every width");
}

type Playwright = Parameters<typeof signUpThroughApi>[0];

async function newSeller(playwright: Playwright, baseURL: string | undefined): Promise<string> {
  return signUpThroughApi(playwright, baseURL, newEmail("market"));
}

function results(page: Page) {
  return page.getByRole("region", { name: "الإعلانات" });
}

test("FR06 FR13 the home page, the market and a listing are right to left, without horizontal scrolling or WCAG 2.2 AA violations", async ({
  page,
  playwright,
  baseURL,
}) => {
  const seller = await newSeller(playwright, baseURL);
  const word = uniqueWord();
  const id = await insertListing(seller, {
    title: `طاولة دراسة للعرض ${word}`,
    description: "إعلان لاختبار التخطيط.\nسطر ثان فيه رابط https://example.test/item",
  });
  await insertListing(seller, { title: `كرسي للعرض ${word}`, priceMinor: 0, ageSeconds: 5 });
  const broken = brokenImages(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "أحدث الإعلانات" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تصفح السوق" })).toHaveAttribute("href", "/market");
  await expect(page.getByRole("region", { name: "الفئات" }).getByRole("link")).toHaveCount(6);
  await rtlAndAxe(page);

  await page.goto(`/market?q=${word}`);
  await expect(results(page).getByRole("article")).toHaveCount(2);
  await expect(results(page).getByText("مجاني")).toBeVisible();
  await expect(results(page).getByText("الصور قيد التجهيز").first()).toBeVisible();
  await rtlAndAxe(page);
  await page.getByText("الفلاتر والترتيب").click();
  await expect(page.getByLabel("الفئة", { exact: true })).toBeVisible();
  await rtlAndAxe(page);

  await page.goto(`/listing/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("طاولة دراسة للعرض");
  await rtlAndAxe(page);
  expect(broken).toEqual([]);
});

test("FR07 DEC84 the header search works without JavaScript: exact results, then «نتائج قريبة من بحثك»", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await newSeller(playwright, baseURL);
  const word = uniqueWord();
  await insertListing(seller, { title: `لابتوب ديل ${word}` });
  await insertListing(seller, { title: `لابتوبات مستعملة ${word}`, ageSeconds: 3600 });
  await page.route("**/_next/static/chunks/*.js", (route) => route.abort());

  await page.goto("/");
  await page.getByRole("searchbox", { name: "ابحث في السوق" }).fill(`لابتوبات ${word}`);
  await page.getByRole("searchbox", { name: "ابحث في السوق" }).press("Enter");
  await expect(page).toHaveURL(/\/market\?q=/);
  const cards = results(page).getByRole("article");
  await expect(cards).toHaveCount(2);
  // The exact match first although it is older, then the close one under its heading.
  await expect(cards.first()).toContainText("لابتوبات مستعملة");
  const close = page.getByRole("region", { name: "نتائج قريبة من بحثك" });
  await expect(close.getByRole("article")).toHaveCount(1);
  await expect(close).toContainText("لابتوب ديل");
});

test("TC04 FR12 the filters live in the URL, applying them shows the first page, and reset restores the defaults", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await newSeller(playwright, baseURL);
  const word = uniqueWord();
  await insertListing(seller, {
    title: `جهاز كالجديد ${word}`,
    category: "electronics",
    condition: "like_new",
  });
  await insertListing(seller, {
    title: `جهاز مستعمل ${word}`,
    category: "electronics",
    condition: "used",
  });
  await insertListing(seller, {
    title: `كتاب كالجديد ${word}`,
    category: "books_study",
    condition: "like_new",
  });

  await page.goto(`/market?q=${word}`);
  await expect(results(page).getByRole("article")).toHaveCount(3);
  const panel = page.locator("details");
  await panel.getByText("الفلاتر والترتيب").click();
  await page.getByLabel("الفئة", { exact: true }).selectOption({ label: "الإلكترونيات" });
  await page.getByLabel("حالة الغرض", { exact: true }).selectOption({ label: "كالجديد" });
  await panel.getByRole("button", { name: "اعرض النتائج" }).click();

  await expect(page).toHaveURL(/category=electronics/);
  expect(new URL(page.url()).searchParams.get("condition")).toBe("like_new");
  expect(new URL(page.url()).searchParams.get("q")).toBe(word);
  expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
  await expect(results(page).getByRole("article")).toHaveCount(1);
  await expect(results(page).getByRole("article")).toContainText("جهاز كالجديد");

  // No results is not a failure (FR07), and it offers the reset.
  await page.goto(`/market?q=${word}&category=vehicles`);
  await expect(page.getByRole("heading", { name: "لا نتائج" })).toBeVisible();
  // Next.js keeps an empty route announcer with role=alert outside the results.
  await expect(results(page).getByRole("alert")).toHaveCount(0);

  await page.getByRole("link", { name: "إعادة ضبط" }).first().click();
  await expect(page).toHaveURL(/\/market$/);
  await expect(page.getByRole("searchbox", { name: "ابحث في الإعلانات" })).toHaveValue("");

  // TC29: a bad filter or cursor in a shared link is its own state, with the first page.
  await page.goto(`/market?q=${word}&cursor=forged`);
  await expect(page.getByRole("heading", { name: "الرابط غير صالح" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ابدأ من الصفحة الأولى" })).toHaveAttribute(
    "href",
    `/market?q=${word}`,
  );
  await page.goto("/market?category=cars");
  await expect(page.getByRole("heading", { name: "الرابط غير صالح" })).toBeVisible();
});

test("NFR14 RL04 «أظهر المزيد» adds the next page; a failure or a 429 keeps the cards shown", async ({
  page,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await newSeller(playwright, baseURL);
  const word = uniqueWord();
  await insertListings(
    seller,
    Array.from({ length: 22 }, (_, index) => ({
      title: `غرض رقم ${String(index + 1)} ${word}`,
      ageSeconds: index,
    })),
  );

  await page.goto(`/market?q=${word}`);
  const cards = results(page).getByRole("article");
  await expect(cards).toHaveCount(20);
  const more = page.getByRole("link", { name: "أظهر المزيد" });
  // Without JavaScript the same control is a link to the next page.
  await expect(more).toHaveAttribute("href", /cursor=/);
  await expect(more).toBeVisible();
  // Wait for React before clicking, so the click fetches instead of navigating.
  await expect(page.locator('[data-hydrated="true"]')).toHaveCount(1);
  await more.click();
  await expect(cards).toHaveCount(22);
  await expect(page.getByText("هذه كل الإعلانات.")).toBeVisible();
  await expect(page.locator('[data-index="20"]')).toBeFocused();

  await page.reload();
  await expect(cards).toHaveCount(20);
  await expect(page.locator('[data-hydrated="true"]')).toHaveCount(1);
  await page.route("**/api/listings?*", (route) =>
    route.fulfill({
      status: 429,
      headers: { "retry-after": "40", "content-type": "application/json" },
      body: JSON.stringify({ code: "RATE_LIMITED", message: "", field_errors: [], trace_id: "t" }),
    }),
  );
  await page.getByRole("link", { name: "أظهر المزيد" }).click();
  await expect(page.getByText("طلبات كثيرة في وقت قصير")).toBeVisible();
  await expect(page.getByText("حاول خلال 40 ثانية.")).toBeVisible();
  await expect(cards).toHaveCount(20);

  await page.unroute("**/api/listings?*");
  await page.route("**/api/listings?*", (route) =>
    route.fulfill({
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "INTERNAL_ERROR",
        message: "",
        field_errors: [],
        trace_id: "t",
      }),
    }),
  );
  await page.getByRole("link", { name: "أعد المحاولة" }).click();
  await expect(page.getByText("تعذّر تحميل المزيد. الإعلانات المعروضة باقية.")).toBeVisible();
  await expect(cards).toHaveCount(20);
});

test("FR13 TC31 TC81 the listing page: text as written, safe links only, and its states", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  only360();
  const seller = await newSeller(playwright, baseURL);
  const word = uniqueWord();
  const description = [
    "سطر أول <script>window.__xss = 1</script>",
    "سطر ثان javascript:alert(1)",
    "رابط https://example.test/safe",
  ].join("\n");
  const id = await insertListing(seller, {
    title: `Laptop HP Pavilion للبيع ${word}`,
    description,
  });
  const sold = await insertListing(seller, { title: `دراجة مباعة ${word}`, status: "sold" });
  const archived = await insertListing(seller, { title: `غرض مؤرشف ${word}`, status: "archived" });

  await page.goto(`/listing/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Laptop HP Pavilion للبيع");
  const text = page.getByRole("region", { name: "الوصف" });
  await expect(text).toContainText("<script>window.__xss = 1</script>");
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  const links = text.getByRole("link");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "https://example.test/safe");
  await expect(links).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
  expect(await text.locator("p").innerText()).toContain("\n");
  await expect(page.getByText("الصور قيد التجهيز")).toBeVisible();
  await expect(page.getByText("بائع جديد")).toBeVisible();
  await expect(page.getByText("حسب الاتفاق")).toBeVisible();

  // TC81: the same link opens the same listing for anyone.
  const guest = await browser.newContext();
  const other = await guest.newPage();
  await other.goto(`${baseURL ?? ""}/listing/${id}`);
  await expect(other.getByRole("heading", { level: 1 })).toContainText("Laptop HP Pavilion للبيع");
  await guest.close();

  await page.goto(`/listing/${sold}`);
  await expect(page.getByText("بيع هذا الغرض")).toBeVisible();

  // TC05: archived and unknown look the same.
  for (const missing of [archived, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
    await page.goto(`/listing/${missing}`);
    await expect(page.getByRole("heading", { name: "هذه الصفحة غير متاحة" })).toBeVisible();
  }
});
