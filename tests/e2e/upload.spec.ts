// Task 4.1 (plan/task-4.1.md, item 11): /dev/upload with real uploads to the local Storage, the
// real API037 to API040 and the worker of playwright.config.ts, at the three widths with axe.
// FR17, FR61, FR80, SEC08, DEC83, TC07, TC32. The rules themselves are tested in integration
// (media-upload, media-processing, media-cleanup, storage-access); here, what the member sees.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { png } from "../fixtures/images/index.ts";
import { logIn, newEmail, signUpThroughApi, WCAG_22_AA } from "./auth-helpers.ts";

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

async function openAsMember(
  page: Page,
  playwright: Parameters<typeof signUpThroughApi>[0],
  baseURL: string | undefined,
  prefix: string,
) {
  const email = newEmail(prefix);
  await signUpThroughApi(playwright, baseURL, email);
  await logIn(page, email);
  await page.goto("/dev/upload");
  await expect(page.getByRole("heading", { level: 1, name: "تجربة رفع الصور" })).toBeVisible();
}

/** The file input of one section, once React has hydrated it (task 4.0). */
async function pickerIn(page: Page, section: string) {
  const region = page.getByRole("region", { name: section });
  const input = region.getByLabel("اختر صورة");
  await expect(input).toBeEnabled();
  return { region, input };
}

test("/dev/upload: a guest is sent to the login page", async ({ page }) => {
  await page.goto("/dev/upload");
  await expect(page).toHaveURL(/\/login\?next=%2Fdev%2Fupload$/);
});

test("/dev/upload: an image becomes ready with its private preview; RTL and axe", async ({
  page,
  playwright,
  baseURL,
}) => {
  await openAsMember(page, playwright, baseURL, "upload-ready");
  await rtlAndAxe(page);
  const { region, input } = await pickerIn(page, "صورة إعلان");
  await input.setInputFiles({
    name: "كتاب.png",
    mimeType: "image/png",
    buffer: await png(400, 300),
  });
  const item = region.getByRole("listitem");
  await expect(item.getByText("جاهزة", { exact: true })).toBeVisible({ timeout: 30_000 });
  const preview = item.getByRole("img", { name: "معاينة الصورة" });
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(400);
  expect(await preview.getAttribute("src")).toContain("/storage/v1/object/sign/media-private/");
  await rtlAndAxe(page);

  // API040: the member removes it.
  await item.getByRole("button", { name: "إزالة الصورة" }).click();
  await expect(region.getByRole("listitem")).toHaveCount(0);
});

test("/dev/upload: TC07 a forged type is rejected by the worker with its reason", async ({
  page,
  playwright,
  baseURL,
}) => {
  await openAsMember(page, playwright, baseURL, "upload-forged");
  const { region, input } = await pickerIn(page, "صورة إعلان");
  // Real PNG bytes named and declared as JPEG (DEC83).
  await input.setInputFiles({ name: "صورة.jpg", mimeType: "image/jpeg", buffer: await png() });
  const item = region.getByRole("listitem");
  await expect(item.getByText("مرفوضة", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(item.getByRole("alert")).toContainText(
    "نوع الملف غير مدعوم. استعمل صورة JPEG أو PNG أو WebP.",
  );
  await expect(item.getByRole("img")).toHaveCount(0);
  await rtlAndAxe(page);
});

test("/dev/upload: a file over 5 MiB and a GIF are refused before any upload", async ({
  page,
  playwright,
  baseURL,
}) => {
  await openAsMember(page, playwright, baseURL, "upload-early");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/uploads") || request.url().includes("/storage/v1/")) {
      requests.push(request.url());
    }
  });
  const { region, input } = await pickerIn(page, "صورة إعلان");
  await input.setInputFiles([
    { name: "كبيرة.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(5_242_881, 0xff) },
    { name: "متحركة.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") },
  ]);
  const items = region.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByRole("alert")).toContainText("حجم الصورة أكبر من 5 ميغابايت.");
  await expect(items.nth(1).getByRole("alert")).toContainText("نوع الملف غير مدعوم.");
  expect(requests).toEqual([]);
});

test("/dev/upload: DEC83 a student card shows no preview after upload", async ({
  page,
  playwright,
  baseURL,
}) => {
  await openAsMember(page, playwright, baseURL, "upload-card");
  const { region, input } = await pickerIn(page, "صورة البطاقة الجامعية");
  await input.setInputFiles({
    name: "بطاقة.png",
    mimeType: "image/png",
    buffer: await png(300, 200),
  });
  const item = region.getByRole("listitem");
  await expect(item.getByText("جاهزة", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(item.getByText("صورة البطاقة لا تُعرض بعد رفعها، ويراها المشرف فقط.")).toBeVisible();
  await expect(item.getByRole("img")).toHaveCount(0);
});
