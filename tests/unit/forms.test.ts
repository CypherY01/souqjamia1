// Task 4.0, items C and D (SEC05, SEC06, owner condition 2 and the owner's request on item D).
// Forms that JavaScript sends are method="post", so a submit before React hydrates them never
// puts the fields (a password) into the address. Their submit buttons are SubmitButton, disabled
// until hydration with «جارٍ التحميل» for screen readers (the server's HTML is checked in
// tests/e2e/no-js.spec.ts). And a POST that arrives before hydration is refused by the proxy (no
// CSRF token), signs no one in and leaves neither the body nor the password in any log line.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "../../scripts/local-supabase.ts";

const WEB = join(REPO_ROOT, "apps", "web");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

interface FormTag {
  file: string;
  /** The opening tag's attributes, up to the handler or the closing bracket. */
  head: string;
}

function forms(): FormTag[] {
  return tsxFiles(WEB).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const found: FormTag[] = [];
    for (let i = source.indexOf("<form"); i >= 0; i = source.indexOf("<form", i + 1)) {
      const head = source.slice(i, i + 600).split(/onSubmit=|\n\s*>\s*\n/)[0] ?? "";
      found.push({ file: relative(WEB, path).replaceAll("\\", "/"), head });
    }
    return found;
  });
}

describe("task 4.0 (item D): forms never submit their fields in the address", () => {
  it('every form is method="post", except the header search (get) and Dialog (dialog)', () => {
    const all = forms();
    const posted = all.filter(({ head }) => head.includes('method="post"'));
    const others = all.filter(({ head }) => !head.includes('method="post"'));
    expect(others.map(({ file, head }) => [file, /method="(\w+)"/.exec(head)?.[1]])).toEqual([
      ["components/layout/SiteHeader.tsx", "get"],
      ["components/ui/Dialog.tsx", "dialog"],
    ]);
    expect(others[0]?.head).toContain('role="search"');
    // The thirteen forms of tasks 3.2 to 3.8; later tasks only add to this.
    expect(posted.length).toBeGreaterThanOrEqual(13);
  });

  it("a form sent by JavaScript submits with SubmitButton, never a plain submit Button", () => {
    const scripted = [...new Set(forms().map(({ file }) => file))].filter((file) =>
      readFileSync(join(WEB, file), "utf8").includes("onSubmit="),
    );
    expect(scripted.length).toBeGreaterThanOrEqual(13);
    for (const file of scripted) {
      const source = readFileSync(join(WEB, file), "utf8");
      expect([file, source.includes('type="submit"')]).toEqual([file, false]);
      expect([file, source.includes("<SubmitButton")]).toEqual([file, true]);
    }
  });
});

describe("task 4.0 (item D, owner's request): a POST that arrives before hydration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is refused with CSRF_FAILED, signs no one in, and logs neither body nor password", async () => {
    const origin = "http://localhost:3000";
    // Built at run time: the repository never holds a secret-like string.
    const values = {
      APP_ENV: "development",
      APP_ORIGIN: origin,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(8).toString("hex")}`,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      EMAIL_CONFIRMATION_REQUIRED: "false",
      APP_SECRET: randomBytes(32).toString("base64url"),
      PROBE_TOKEN: randomBytes(32).toString("base64url"),
      TRUSTED_PROXY_HOPS: "0",
      DATABASE_URL: "postgresql://souq_web@127.0.0.1:54322/postgres",
      CONTACT_EMAIL: "contact@souqjamia1.test",
    };
    for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }

    // The proxy reads only method, headers and nextUrl; next/server is the web app's package, so
    // its request type is written out here.
    type Proxy = (request: Request & { nextUrl: URL }) => Promise<Response>;
    // A computed path: the tests' type check does not follow it into the web app (next/server).
    const proxyPath = new URL("../../apps/web/proxy.ts", import.meta.url).href;
    const { proxy } = (await import(proxyPath)) as { proxy: Proxy };
    const email = `nojs-${randomBytes(4).toString("hex")}@example.test`;
    const password = `pw-${randomBytes(12).toString("hex")}`;
    // What the browser sends for <form method="post"> on /login before React hydrates it.
    const body = new URLSearchParams({ email, password }).toString();
    const url = `${origin}/login`;
    const request = new Request(url, {
      method: "POST",
      headers: {
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const response = await proxy(Object.assign(request, { nextUrl: new URL(url) }));

    expect(response.status).toBe(403);
    const answer = await response.text();
    expect(JSON.parse(answer)).toMatchObject({ code: "CSRF_FAILED" });
    expect(answer).not.toContain(email);
    // No session cookie, and Supabase Auth was never called.
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(/sb-[\w-]+-auth-token/);
    expect(network).not.toHaveBeenCalled();
    // The rejection is logged with method, path and code only.
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "http.rejected",
      method: "POST",
      path: "/login",
      code: "CSRF_FAILED",
    });
    for (const secret of [password, email, body, "password="]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });
});
