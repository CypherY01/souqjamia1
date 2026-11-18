import { describe, expect, it } from "vitest";
import { devGalleryEnabled } from "../../apps/web/lib/dev-gallery.ts";

describe("/dev/ui availability (owner decision on task 1.5, item 5)", () => {
  it("is available in development and staging, and 404 in production", () => {
    expect(devGalleryEnabled("development")).toBe(true);
    expect(devGalleryEnabled("staging")).toBe(true);
    expect(devGalleryEnabled("production")).toBe(false);
  });
});
