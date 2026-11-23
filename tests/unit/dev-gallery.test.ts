import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { devGalleryEnabled } from "../../apps/web/lib/dev-gallery.ts";
import { REPO_ROOT } from "../../scripts/local-supabase.ts";

const DEV = join(REPO_ROOT, "apps", "web", "app", "dev");

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

describe("/dev/ui availability (owner decision on task 1.5, item 5)", () => {
  it("is available in development and staging, and 404 in production", () => {
    expect(devGalleryEnabled("development")).toBe(true);
    expect(devGalleryEnabled("staging")).toBe(true);
    expect(devGalleryEnabled("production")).toBe(false);
  });

  // Owner note 1 on the approval of task 4.1: /dev/upload is like /dev/ui.
  it("every page under /dev, /dev/upload included, starts with the production 404", () => {
    const found = pages(DEV).map((path) => relative(DEV, path).replaceAll("\\", "/"));
    expect(found).toEqual(expect.arrayContaining(["ui/page.tsx", "upload/page.tsx"]));
    for (const path of pages(DEV)) {
      const source = readFileSync(path, "utf8");
      const body = /export default (?:async )?function \w+\(\) \{\n([^\n]*)\n/.exec(source)?.[1];
      expect(body?.trim(), relative(DEV, path)).toBe(
        "if (!devGalleryEnabled(serverEnv().APP_ENV)) notFound();",
      );
      expect(source).toContain('import { notFound } from "next/navigation";');
    }
  });
});
