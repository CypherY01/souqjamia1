// Task 1.5: the RTL shell and component gallery at 360, 768 and 1440 px (NFR01-NFR03, DEC30,
// DEC31, DEC47, TC24 for the shell).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  { name: "home", path: "/" },
  { name: "not found", path: "/no-such-page" },
  { name: "component gallery", path: "/dev/ui" },
] as const;

// Known limit: axe-core 4.14 skips longer Arabic text in its contrast rule (its icon-ligature
// heuristic treats shaped Arabic as ligatures, with no option to turn it off). Latin and short
// text are still checked here; every token pair is checked in tests/unit/design-tokens.test.ts.
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

for (const { name, path } of PAGES) {
  test.describe(`${name} (${path})`, () => {
    test("is Arabic, right to left, without horizontal scrolling (NFR01, DEC30)", async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      expect(await hasHorizontalScroll(page)).toBe(false);
    });

    // Task 4.1: while the web font loads, the fallback font made the header search input about
    // 340 px wide, and the form could not shrink below it (113 px of scroll at 360 px, one run
    // in 30 under load). Blocking the font files keeps the fallback font for the whole test.
    test("has no horizontal scrolling with the fallback font, before the web font loads", async ({
      page,
    }) => {
      await page.route("**/_next/static/media/*", (route) => route.abort());
      await page.goto(path);
      expect(await page.evaluate(() => document.fonts.status)).toBeDefined();
      expect(await hasHorizontalScroll(page)).toBe(false);
    });

    test("has no WCAG 2.2 AA violations (NFR03)", async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });

    test("loads, hydrates and opens the menu without CSP violations (SEC06, task 1.6)", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const store = window as unknown as { cspViolations: string[] };
        store.cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          store.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await page.goto(path, { waitUntil: "load" });
      // The menu opens only after hydration, so this also shows the scripts ran under the CSP.
      const toggle = page.locator("header").first().getByRole("button", { name: "القائمة" });
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
      }
      const violations = await page.evaluate(
        () => (window as unknown as { cspViolations: string[] }).cspViolations,
      );
      expect(violations).toEqual([]);
    });

    test("has no contribution link and no language switch (DEC30, DEC31)", async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('a[href*="contribut"], a[href*="support"]')).toHaveCount(0);
      await expect(page.locator('[hreflang], a[href*="lang="], a[href^="/en"]')).toHaveCount(0);
      await expect(page.getByText(/^(English|EN)$/)).toHaveCount(0);
    });
  });
}

test("an unknown page returns 404 with the generic page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("هذه الصفحة غير متاحة");
});

test("the first Tab reaches the skip link, which moves focus to the content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "تخطَّ إلى المحتوى" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});

test("the menu: collapsible on small screens, always shown on wide ones", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const toggle = page.locator("header").getByRole("button", { name: "القائمة" });
  const nav = page.getByRole("navigation", { name: "القائمة الرئيسية" });

  if (testInfo.project.name === "desktop-1440") {
    await expect(toggle).toBeHidden();
    await expect(nav).toBeVisible();
    return;
  }

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "السوق" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("member text in the gallery is shown as text, with safe links (TC31)", async ({ page }) => {
  let dialogOpened = false;
  page.on("dialog", (dialog) => {
    dialogOpened = true;
    void dialog.dismiss();
  });
  await page.goto("/dev/ui");
  const section = page.locator("section#member-text, section[aria-labelledby='member-text']");
  await expect(section.getByText('<script>alert("x")</script>', { exact: false })).toBeVisible();
  await expect(section.locator("script")).toHaveCount(0);
  const link = section.getByRole("link", { name: /example\.test/ });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
  await expect(section.locator('a[href^="javascript:"], a[href^="data:"]')).toHaveCount(0);
  expect(dialogOpened).toBe(false);
});

test("the dialog opens, closes with Escape and returns focus (chapter 02)", async ({ page }) => {
  await page.goto("/dev/ui");
  const trigger = page.getByRole("button", { name: "افتح النافذة" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "تأكيد الحذف" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
