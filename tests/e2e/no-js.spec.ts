// Task 4.0, items C and D (SEC05, SEC06, owner condition 2 and the owner's request on item D).
// A page React has not hydrated: /login with JavaScript off, and /signup with JavaScript on but
// the app's scripts never loading (without JavaScript /signup stays on its loading state, since
// React inserts the streamed content with a script). The <noscript> message says why buttons
// are disabled; the submit button is disabled with «جارٍ التحميل» for screen readers; Enter in
// the password field sends nothing and never puts a field into the address. And the POST a
// browser would send for <form method="post"> is refused (no CSRF token), signs no one in,
// creates no account, and leaves neither the body nor the password in the server's log.
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { t } from "@souq/i18n";
import {
  accountExists,
  fillLogin,
  meOf,
  newEmail,
  PASSWORD,
  signUpThroughApi,
} from "./auth-helpers.ts";
import { serverLogFile } from "./local-env.ts";
import { PORT } from "./ports.ts";

/** The app's own script files (Next.js chunks); inline scripts still run. */
const APP_SCRIPTS = /\/_next\/static\/chunks\/.+\.js(\?.*)?$/;

/** Every document request the page makes from now on (a native submit is one). */
function documentRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") seen.push(request);
  });
  return seen;
}

/**
 * Opens the page and checks the state before hydration. The <noscript> message is checked in the
 * document the server sent: with JavaScript off, Playwright stops script execution only, and
 * Chromium may still parse <noscript> as if scripts ran and draw nothing. A browser with
 * JavaScript turned off in its settings shows it (the owner's review).
 */
async function openBeforeHydration(page: Page, path: string, submitName: string): Promise<void> {
  const document = await page.goto(path);
  const html = (await document?.text()) ?? "";
  const body = html.slice(html.indexOf("<body"));
  const noscript = /<noscript><p class="[^"]+">([^<]*)<\/p><\/noscript>/.exec(body);
  expect(noscript?.[1]).toBe(t("layout.noscript"));
  // At the top of the page, before the header with its menu button.
  expect(body.indexOf("<noscript>")).toBeLessThan(body.indexOf("<header"));
  const form = page.getByRole("main").locator("form");
  await expect(form).toHaveCount(1);
  await expect(form).toHaveAttribute("method", "post");
  const submit = form.getByRole("button", { name: submitName });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await expect(submit).toHaveAccessibleName(`${submitName} ${t("ui.loading")}`);
  // The header's menu button too (hidden on wide screens, so found by its panel link).
  const menu = page.locator("header button[aria-controls]");
  await expect(menu).toHaveCount(1);
  await expect(menu).toBeDisabled();
  await expect(menu).toHaveAttribute("aria-busy", "true");
}

/**
 * What the browser would send for the form, refused by the proxy (CSRF_FAILED), and the server
 * log line of that refusal: method, path and code only.
 */
async function nativePost(page: Page, path: string, fields: Record<string, string>) {
  const origin = `http://localhost:${String(PORT)}`;
  const response = await page.request.post(path, {
    form: fields,
    headers: { origin, "sec-fetch-site": "same-origin" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
  expect(((await response.json()) as { code?: string }).code).toBe("CSRF_FAILED");
  const traceId = response.headers()["x-trace-id"] ?? "";
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  const file = serverLogFile(PORT);
  await expect.poll(() => readFileSync(file, "utf8")).toContain(traceId);
  const log = readFileSync(file, "utf8");
  const line = log.split(/\r?\n/).find((entry) => entry.includes(traceId)) ?? "";
  expect(JSON.parse(line)).toMatchObject({
    event: "http.rejected",
    method: "POST",
    path,
    code: "CSRF_FAILED",
  });
  const body = new URLSearchParams(fields).toString();
  for (const secret of [...Object.values(fields), body, "password="]) {
    expect(log).not.toContain(secret);
  }
  // No session cookie in the browser, and the server sees a guest.
  const cookies = await page.context().cookies();
  expect(cookies.filter(({ name }) => /^sb-[\w-]+-auth-token/.test(name))).toEqual([]);
  expect((await meOf(page)).status).toBe(401);
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("/login: explained, disabled, nothing sent; a native POST signs no one in", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const email = newEmail("nojs-login");
    await signUpThroughApi(playwright, baseURL, email, "عضو بلا جافاسكربت");
    await openBeforeHydration(page, "/login", t("auth.login.submit"));

    const sent = documentRequests(page);
    await fillLogin(page, email);
    await page.getByLabel("كلمة المرور", { exact: true }).press("Enter");
    // The right password of a real account: only the missing CSRF token stops the sign-in.
    await nativePost(page, "/login", { email, password: PASSWORD });
    // By now a native submit from Enter would have been requested.
    expect(sent.map((request) => request.url())).toEqual([]);
    expect(new URL(page.url()).search).toBe("");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("/signup before hydration (its scripts never load): explained, disabled, nothing sent; a native POST creates no account", async ({
  page,
}) => {
  await page.route(APP_SCRIPTS, (route) => route.abort());
  const email = newEmail("nojs-signup");
  await openBeforeHydration(page, "/signup", t("auth.signup.submit"));

  const sent = documentRequests(page);
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByLabel("كلمة المرور", { exact: true }).press("Enter");
  await nativePost(page, "/signup", { name: "عضو بلا جافاسكربت", email, password: PASSWORD });
  expect(await accountExists(email)).toBe(false);
  expect(sent.map((request) => request.url())).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  await expect(page).toHaveURL(/\/signup$/);
});
