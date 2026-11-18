// Task 2.1, item 9: the Supabase images the stack runs match their recorded digests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOCK_FILE,
  compareImages,
  digestFor,
  type ImageLock,
} from "../../scripts/check-supabase-images.ts";

const POSTGRES = "public.ecr.aws/supabase/postgres:17.11.0.011";
const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const lock: ImageLock = { comment: "", images: { [POSTGRES]: DIGEST } };

describe("check:supabase-images", () => {
  it("passes when every running image has its pinned digest", () => {
    expect(compareImages(lock, new Map([[POSTGRES, DIGEST]]))).toEqual([]);
  });

  it("fails on a changed digest", () => {
    expect(compareImages(lock, new Map([[POSTGRES, OTHER]]))).toEqual([
      `${POSTGRES}: digest ${OTHER}, pinned ${DIGEST}`,
    ]);
  });

  it("fails on an image that is not pinned, and when nothing runs", () => {
    const image = "public.ecr.aws/supabase/gotrue:v9.9.9";
    expect(compareImages(lock, new Map([[image, DIGEST]]))).toEqual([
      `${image}: not in images.lock.json`,
    ]);
    expect(compareImages(lock, new Map())).toEqual([
      "no running image found; start the stack first",
    ]);
  });

  it("reads the digest of the same repository from docker's RepoDigests", () => {
    expect(digestFor(POSTGRES, [`public.ecr.aws/supabase/postgres@${DIGEST}`])).toBe(DIGEST);
    expect(digestFor(POSTGRES, [`docker.io/supabase/postgres@${DIGEST}`])).toBeUndefined();
  });

  it("the committed lock pins every image by a sha256 digest", () => {
    const committed = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as ImageLock;
    const entries = Object.entries(committed.images);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const [image, digest] of entries) {
      expect(image).toMatch(/^public\.ecr\.aws\/supabase\/[a-z-]+:[\w.-]+$/);
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
