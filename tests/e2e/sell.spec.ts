// Task 4.2 (plan/task-4.2.md): the publication wizard (/sell) with real uploads to the local
// Storage, the real API034 and the worker of playwright.config.ts. FR16 to FR22, FR60, TC07,
// TC09, TC24, TC33, TC64, TC68, TC82, section 6.3, owner note 1 (no meeting points).
// Item 1 of the owner's decisions: the layout and axe of every step at the three widths; the
// functional flows at 360 only (the rules themselves are tested in integration).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { assertLocalUrl, readLocalStack } from "../../scripts/local-supabase.ts";
import { png } from "../fixtures/images/index.ts";
import { logIn, newEmail, openAccountMenu, signUpThroughApi, WCAG_22_AA } from "./auth-helpers.ts";

const DRAFT_KEY = "souq.sell-draft";
const ONE_WIDTH = "mobile-360";

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: assertLocalUrl(readLocalStack().dbUrl) });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function listingsOf(userId: string): Promise<number> {
  const rows = await sql<{ count: string }>(
    "select count(*)::text as count from public.listing where seller_id = $1",
    [userId],
  );
  return Number(rows[0]?.count ?? "0");
}

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

/** A new member, logged in, on /sell once React has hydrated the wizard (task 4.0). */
async function openWizard(
  page: Page,
  playwright: Parameters<typeof signUpThroughApi>[0],
  baseURL: string | undefined,
  prefix: string,
): Promise<{ email: string; userId: string }> {
  const email = newEmail(prefix);
  const userId = await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  await page.goto("/sell");
  await expectStep(page, "الصور");
  return { email, userId };
}

async function expectStep(page: Page, title: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  await expect(page.getByLabel("جهاز مشترك: لا تحفظ ما أكتبه في هذا التبويب")).toBeVisible();
}

async function addImage(page: Page, name = "مكتب.png"): Promise<void> {
  const input = page.getByLabel("اختر صورة");
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name, mimeType: "image/png", buffer: await png(400, 300) });
  const item = page.getByRole("listitem").filter({ hasText: name });
  await expect(item.getByText("جاهزة", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function next(page: Page): Promise<void> {
  await page.getByRole("button", { name: "التالي" }).click();
}

async function fillDetails(page: Page, title = "مكتب دراسة خشبي"): Promise<void> {
  await page.getByLabel("العنوان", { exact: true }).fill(title);
  await page.getByLabel("الفئة", { exact: true }).selectOption({ label: "الكتب والدراسة" });
  await page.getByRole("radio", { name: /بحالة جيدة/ }).check();
  await page
    .getByLabel("الوصف", { exact: true })
    .fill("مكتب بحالة جيدة مع درج واحد.\nالمقاس 120 في 60.");
}

/** From step 1 with one ready image to the review step, «حسب الاتفاق». */
async function toReview(page: Page, title?: string): Promise<void> {
  await next(page);
  await expectStep(page, "المواصفات");
  await fillDetails(page, title);
  await next(page);
  await expectStep(page, "السعر");
  await page.getByLabel("السعر بالريال").fill("٣٥٠");
  await next(page);
  await expectStep(page, "مكان اللقاء");
  await page.getByRole("radio", { name: /حسب الاتفاق/ }).check();
  await next(page);
  await expectStep(page, "المراجعة والنشر");
}

async function published(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 2, name: "نُشر إعلانك" })).toBeVisible({
    timeout: 15_000,
  });
}

test("/sell: a guest is sent to the login page", async ({ page }) => {
  test.skip(test.info().project.name !== ONE_WIDTH, "one width is enough for a redirect");
  await page.goto("/sell");
  await expect(page).toHaveURL(/\/login\?next=%2Fsell$/);
});

test("TC24 TC68 FR16 every step is right to left, without horizontal scrolling or WCAG 2.2 AA violations, and publishes", async ({
  page,
  playwright,
  baseURL,
}) => {
  const { userId } = await openWizard(page, playwright, baseURL, "sell-layout");
  await expect(page.getByText("الخطوة 1 من 5")).toBeVisible();
  await rtlAndAxe(page);
  await addImage(page);
  await rtlAndAxe(page);

  await next(page);
  await expectStep(page, "المواصفات");
  // The focus follows the step (WCAG 2.4.3).
  await expect(page.getByRole("heading", { level: 2, name: "المواصفات" })).toBeFocused();
  // Next checks the step first: the errors are under their fields.
  await next(page);
  await expect(page.getByText("اكتب عنواناً للإعلان.")).toBeVisible();
  await expect(page.getByLabel("العنوان", { exact: true })).toBeFocused();
  await rtlAndAxe(page);
  await fillDetails(page);
  await expect(page.getByText("15 من 100 حرفاً")).toBeVisible();
  await next(page);

  await expectStep(page, "السعر");
  await page.getByLabel("السعر بالريال").fill("0");
  await expect(page.getByText("سيظهر الغرض «مجاني»، والتفاوض على سعره غير متاح.")).toBeVisible();
  await expect(page.getByLabel("السعر قابل للتفاوض")).toBeDisabled();
  await page.getByLabel("السعر بالريال").fill("٣٥٠٫٥٠٥");
  await next(page);
  await expect(page.getByText("منزلتان عشريتان على الأكثر، مثل 350.50.")).toBeVisible();
  await rtlAndAxe(page);
  await page.getByLabel("السعر بالريال").fill("٣٥٠");
  await page.getByLabel("السعر قابل للتفاوض").check();
  await next(page);

  await expectStep(page, "مكان اللقاء");
  await expect(
    page.getByText("التقيا في مكان عام، ولا تكتب عنوان سكنك أو رقم غرفتك."),
  ).toBeVisible();
  await rtlAndAxe(page);
  await page.getByRole("radio", { name: /حسب الاتفاق/ }).check();
  await next(page);

  await expectStep(page, "المراجعة والنشر");
  await expect(page.getByText("مكتب دراسة خشبي")).toBeVisible();
  await expect(page.getByText("350 ريال")).toBeVisible();
  await expect(page.getByText("قابل للتفاوض", { exact: true })).toBeVisible();
  await expect(
    page.getByText("ما كتبته محفوظ في هذا التبويب فقط، ويُمسح عند الخروج أو إغلاق التبويب."),
  ).toBeVisible();
  await rtlAndAxe(page);
  await page.getByRole("button", { name: "انشر الإعلان" }).click();
  await published(page);
  await rtlAndAxe(page);
  expect(await listingsOf(userId)).toBe(1);
  // The draft is gone once the listing is published.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY)).toBeNull();
});

test.describe("at one width", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== ONE_WIDTH, "the flows run at 360 only (item 1)");
  });

  test("TC09 back keeps every value, and a double click publishes once", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const { userId } = await openWizard(page, playwright, baseURL, "sell-back");
    await addImage(page);
    await toReview(page, "آلة حاسبة علمية");
    // An edit link goes to its step with the values kept; the browser's back button returns.
    await page.getByRole("button", { name: "تعديل المواصفات" }).click();
    await expectStep(page, "المواصفات");
    await expect(page.getByLabel("العنوان", { exact: true })).toHaveValue("آلة حاسبة علمية");
    await expect(page.getByRole("radio", { name: /بحالة جيدة/ })).toBeChecked();
    await page.goBack();
    await expectStep(page, "المراجعة والنشر");
    await page.getByRole("button", { name: "السابق" }).click();
    await expectStep(page, "مكان اللقاء");
    await expect(page.getByRole("radio", { name: /حسب الاتفاق/ })).toBeChecked();
    await next(page);
    await page.getByRole("button", { name: "انشر الإعلان" }).dblclick();
    await published(page);
    expect(await listingsOf(userId)).toBe(1);
  });

  test("TC09 FR22 an answer that never arrived: the retry returns the same listing", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const { userId } = await openWizard(page, playwright, baseURL, "sell-retry");
    await addImage(page);
    await toReview(page);
    const keys: string[] = [];
    let lost = false;
    await page.route("**/api/listings", async (route) => {
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      if (!lost) {
        lost = true;
        // The server publishes, and the answer is lost on the way back.
        await route.fetch();
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "انشر الإعلان" }).click();
    await expect(
      page.getByText("تعذّر إرسال الإعلان. تحقق من الاتصال ثم أعد المحاولة."),
    ).toBeVisible();
    expect(await listingsOf(userId)).toBe(1);
    await page.getByRole("button", { name: "انشر الإعلان" }).click();
    await published(page);
    expect(await listingsOf(userId)).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  test("TC33 FR60 a reload keeps the text; an expired image is picked again and the text stays", async ({
    page,
    playwright,
    baseURL,
  }) => {
    await openWizard(page, playwright, baseURL, "sell-reload");
    await addImage(page);
    await next(page);
    await fillDetails(page, "دراجة هوائية");
    await page.reload();
    await expectStep(page, "المواصفات");
    await expect(page.getByText("استعدنا ما كتبته في هذا التبويب.")).toBeVisible();
    await expect(page.getByLabel("العنوان", { exact: true })).toHaveValue("دراجة هوائية");
    await expect(page.getByRole("radio", { name: /بحالة جيدة/ })).toBeChecked();

    // RET01: the temporary image is gone (24 hours), as media.cleanup leaves it.
    const draft = await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY);
    const mediaId = (JSON.parse(draft ?? "{}") as { images: { mediaId: string }[] }).images[0]
      ?.mediaId;
    await sql(
      "update public.media_asset set status = 'deleted', expires_at = now() where id = $1",
      [mediaId],
    );
    await page.reload();
    await expectStep(page, "المواصفات");
    await page.getByRole("button", { name: "السابق" }).click();
    await expectStep(page, "الصور");
    await expect(page.getByText("انتهت مدة الصورة المؤقتة. اخترها من جديد.")).toBeVisible();
    await next(page);
    await expect(
      page.getByText("انتظر حتى تجهز كل الصور، أو احذف الصورة التي لم تُقبل."),
    ).toBeVisible();
    await page.getByRole("button", { name: "إزالة الصورة" }).click();
    await addImage(page, "صورة جديدة.png");
    await next(page);
    await expect(page.getByLabel("العنوان", { exact: true })).toHaveValue("دراجة هوائية");
  });

  test("TC82 logout removes the draft, and another member in the same tab starts empty; a shared device saves nothing", async ({
    page,
    playwright,
    baseURL,
  }) => {
    await openWizard(page, playwright, baseURL, "sell-logout");
    await addImage(page);
    await next(page);
    await fillDetails(page, "طاولة صغيرة");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY)).not.toBeNull();
    await openAccountMenu(page);
    await page.locator("header").first().getByRole("button", { name: "خروج" }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY)).toBeNull();

    const other = newEmail("sell-other");
    await signUpThroughApi(playwright, baseURL, other);
    await logIn(page, other);
    await page.goto("/sell");
    await expectStep(page, "الصور");
    await expect(page.getByText("0 من 10")).toBeVisible();
    await expect(page.getByText("استعدنا ما كتبته في هذا التبويب.")).toHaveCount(0);

    // Item 3: a shared device removes the draft and stops saving in this tab.
    await addImage(page);
    await page.getByLabel("جهاز مشترك: لا تحفظ ما أكتبه في هذا التبويب").check();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY)).toBeNull();
    await next(page);
    await fillDetails(page, "كرسي مكتب");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY)).toBeNull();
    await page.reload();
    await expectStep(page, "الصور");
    await expect(page.getByLabel("جهاز مشترك: لا تحفظ ما أكتبه في هذا التبويب")).toBeChecked();
    await expect(page.getByText("0 من 10")).toBeVisible();
  });

  test("TC07 an eleventh image is not added, and the member is told", async ({
    page,
    playwright,
    baseURL,
  }) => {
    await openWizard(page, playwright, baseURL, "sell-eleven");
    // The cap is the browser's here (the server's is in integration): no upload is needed.
    await page.route("**/api/uploads/authorize", (route) => route.abort("failed"));
    const buffer = await png(40, 30);
    const files = Array.from({ length: 11 }, (_, index) => ({
      name: `صورة ${String(index + 1)}.png`,
      mimeType: "image/png",
      buffer,
    }));
    await page.getByLabel("اختر صورة").setInputFiles(files);
    await expect(
      page.getByText("اخترت صوراً أكثر من المتبقي، فأُضيفت أول 10 منها فقط."),
    ).toBeVisible();
    await expect(page.getByText("10 من 10")).toBeVisible();
    await expect(page.getByLabel("اختر صورة")).toBeDisabled();
    await expect(
      page.getByText("وصلت إلى 10 صور، وهو الحد الأعلى. احذف صورة لتضيف غيرها."),
    ).toBeVisible();
  });

  test("TC64 API034 refuses a request without the CSRF token, and has no state-changing GET", async ({
    request,
    baseURL,
  }) => {
    const post = await request.post("/api/listings", {
      headers: { origin: baseURL ?? "", "idempotency-key": crypto.randomUUID() },
      data: { title: "x" },
    });
    expect(post.status()).toBe(403);
    expect(((await post.json()) as { code: string }).code).toBe("CSRF_FAILED");
    expect((await request.get("/api/listings")).status()).toBe(405);
    const catalog = await request.get("/api/catalog");
    expect(catalog.status()).toBe(200);
    expect(catalog.headers()["cache-control"]).toBe("public, max-age=300");
    const body = (await catalog.json()) as { data: { categories: unknown[] } };
    expect(body.data.categories).toHaveLength(7);
  });
});

// These two change the meeting points every page reads, so they run one after the other.
test.describe("at one width, the meeting points", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== ONE_WIDTH, "the flows run at 360 only (item 1)");
  });

  test("section 6.3 a server error goes back to the step of its field", async ({
    page,
    playwright,
    baseURL,
  }) => {
    await openWizard(page, playwright, baseURL, "sell-error");
    await addImage(page);
    await next(page);
    await fillDetails(page);
    await next(page);
    await page.getByLabel("السعر بالريال").fill("120");
    await next(page);
    await page.getByRole("radio", { name: /نقطة لقاء تجريبية 1/ }).check();
    await next(page);
    await expectStep(page, "المراجعة والنشر");
    await expect(page.getByText("نقطة لقاء تجريبية 1")).toBeVisible();
    await sql("update public.meeting_point set is_active = false where key = 'test_point_1'");
    try {
      await page.getByRole("button", { name: "انشر الإعلان" }).click();
      await expectStep(page, "مكان اللقاء");
      await expect(
        page.getByText("هذا المكان لم يعد متاحاً. اختر غيره أو «حسب الاتفاق»."),
      ).toBeVisible();
      await expect(page.getByRole("radio", { name: /حسب الاتفاق/ })).toBeFocused();
    } finally {
      await sql("update public.meeting_point set is_active = true where key = 'test_point_1'");
    }
  });

  test("owner note 1: with no suggested place, «حسب الاتفاق» alone, no error, and the listing publishes", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const active = await sql<{ id: string }>(
      "update public.meeting_point set is_active = false where is_active returning id::text as id",
    );
    try {
      const { userId } = await openWizard(page, playwright, baseURL, "sell-no-points");
      await addImage(page);
      await next(page);
      await fillDetails(page);
      await next(page);
      await page.getByLabel("السعر بالريال").fill("0");
      await next(page);
      await expectStep(page, "مكان اللقاء");
      await expect(
        page.getByText(
          "لا توجد أماكن مقترحة بعد. اختر «حسب الاتفاق»، واتفقا على المكان في المحادثة.",
        ),
      ).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(1);
      await expect(page.getByText("اختر مكاناً أو «حسب الاتفاق».")).toHaveCount(0);
      await rtlAndAxe(page);
      await page.getByRole("radio", { name: /حسب الاتفاق/ }).check();
      await next(page);
      await expect(page.getByText("مجاني", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "انشر الإعلان" }).click();
      await published(page);
      expect(await listingsOf(userId)).toBe(1);
    } finally {
      await sql("update public.meeting_point set is_active = true where id = any($1::uuid[])", [
        active.map((row) => row.id),
      ]);
    }
  });
});
