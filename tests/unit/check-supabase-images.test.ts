// Task 2.1, item 9: the Supabase images the stack runs match their recorded digests.
// Task 4.5, item 0: full diagnostics on failure, and an image from another allowed registry
// passes only with the pinned digest exactly.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_REGISTRIES,
  LOCK_FILE,
  checkImages,
  describe as describeImage,
  lockEntries,
  parseReference,
  type ImageLock,
  type RunningImage,
} from "../../scripts/check-supabase-images.ts";

const POSTGRES = "public.ecr.aws/supabase/postgres:17.11.0.011";
const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const lock: ImageLock = { comment: "", images: { [POSTGRES]: DIGEST } };

function image(shown: string, digests: string[], tags: string[] = [shown]): RunningImage {
  return { shown, repoTags: tags, repoDigests: digests };
}

describe("check:supabase-images", () => {
  it("passes when every running image has its pinned digest", () => {
    const result = checkImages(lock, [
      image(POSTGRES, [`public.ecr.aws/supabase/postgres@${DIGEST}`]),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("fails on a changed digest, with the full diagnostic", () => {
    const running = image(POSTGRES, [`public.ecr.aws/supabase/postgres@${OTHER}`]);
    const result = checkImages(lock, [running]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(`${POSTGRES}: digest_mismatch`);
    expect(result.errors[0]).toContain(`expected key ${POSTGRES}`);
    expect(result.errors[0]).toContain(`RepoDigests ["public.ecr.aws/supabase/postgres@${OTHER}"]`);
    expect(result.errors[0]).toContain(`RepoTags ["${POSTGRES}"]`);
  });

  it("fails on an image that is not pinned, and when nothing runs", () => {
    const gotrue = "public.ecr.aws/supabase/gotrue:v9.9.9";
    const result = checkImages(lock, [image(gotrue, [`public.ecr.aws/supabase/gotrue@${DIGEST}`])]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(`${gotrue}: not_pinned`);
    expect(checkImages(lock, []).errors).toEqual(["no running image found; start the stack first"]);
  });

  it("fails without a registry digest of the same repository", () => {
    const result = checkImages(lock, [image(POSTGRES, [])]);
    expect(result.errors[0]).toContain(`${POSTGRES}: no_digest`);
    const elsewhere = checkImages(lock, [
      image(POSTGRES, [`public.ecr.aws/supabase/gotrue@${DIGEST}`]),
    ]);
    expect(elsewhere.errors[0]).toContain("no_digest");
  });

  it("passes an image from Docker Hub with the pinned digest exactly, and warns", () => {
    for (const shown of [
      "supabase/postgres:17.11.0.011",
      "docker.io/supabase/postgres:17.11.0.011",
    ]) {
      const result = checkImages(lock, [image(shown, [`supabase/postgres@${DIGEST}`])]);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        `${shown}: pulled from docker.io, digest equals the pin of ${POSTGRES}`,
      ]);
    }
    const ghcr = "ghcr.io/supabase/postgres:17.11.0.011";
    const fromGhcr = checkImages(lock, [image(ghcr, [`ghcr.io/supabase/postgres@${DIGEST}`])]);
    expect(fromGhcr.errors).toEqual([]);
    expect(fromGhcr.warnings).toHaveLength(1);
  });

  it("never accepts a different digest from another registry", () => {
    const shown = "supabase/postgres:17.11.0.011";
    const result = checkImages(lock, [image(shown, [`supabase/postgres@${OTHER}`])]);
    expect(result.errors[0]).toContain(`${shown}: digest_mismatch`);
    expect(result.warnings).toEqual([]);
  });

  it("refuses a registry outside the fixed list, even with the pinned digest", () => {
    expect(ALLOWED_REGISTRIES).toEqual(["public.ecr.aws", "docker.io", "ghcr.io"]);
    const shown = "quay.io/supabase/postgres:17.11.0.011";
    const result = checkImages(lock, [image(shown, [`quay.io/supabase/postgres@${DIGEST}`])]);
    expect(result.errors[0]).toContain(`${shown}: registry_not_allowed`);
  });

  it("refuses another tag with the same digest", () => {
    const shown = "supabase/postgres:17.11.0.012";
    const result = checkImages(lock, [image(shown, [`supabase/postgres@${DIGEST}`])]);
    expect(result.errors[0]).toContain("not_pinned");
    expect(result.errors[0]).toContain("expected key public.ecr.aws/supabase/postgres:17.11.0.012");
  });

  it("uses the RepoTags when docker ps shows an image id", () => {
    const id = "sha256:" + "c".repeat(64);
    const pass = checkImages(lock, [
      image(id, [`public.ecr.aws/supabase/postgres@${DIGEST}`], [POSTGRES]),
    ]);
    expect(pass.errors).toEqual([]);
    const untagged = checkImages(lock, [image("0123456789ab", [], [])]);
    expect(untagged.errors[0]).toContain("0123456789ab: not_pinned");
    expect(untagged.errors[0]).toContain("expected key (no tagged reference)");
  });

  it("describes a passing image too, for the list printed on failure", () => {
    const [result] = checkImages(lock, [
      image(POSTGRES, [`public.ecr.aws/supabase/postgres@${DIGEST}`]),
    ]).results;
    expect(result && describeImage(result)).toContain(`${POSTGRES}: ok`);
  });

  it("parses references with and without a registry", () => {
    expect(parseReference("supabase/postgres:1")).toEqual({
      registry: "docker.io",
      path: "supabase/postgres",
      tag: "1",
      digest: null,
    });
    expect(parseReference("library/node:26")).toMatchObject({
      registry: "docker.io",
      path: "node",
    });
    expect(parseReference(`public.ecr.aws/supabase/kong@${DIGEST}`)).toEqual({
      registry: "public.ecr.aws",
      path: "supabase/kong",
      tag: null,
      digest: DIGEST,
    });
  });

  it("--write records public.ecr.aws images only", () => {
    expect(lockEntries([image(POSTGRES, [`public.ecr.aws/supabase/postgres@${DIGEST}`])])).toEqual({
      [POSTGRES]: DIGEST,
    });
    expect(() =>
      lockEntries([image("supabase/postgres:17.11.0.011", [`supabase/postgres@${DIGEST}`])]),
    ).toThrow(/--write records public\.ecr\.aws images only/);
    expect(() => lockEntries([image(POSTGRES, [])])).toThrow(/no registry digest/);
  });

  it("the committed lock pins every image by a sha256 digest", () => {
    const committed = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as ImageLock;
    const entries = Object.entries(committed.images);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const [key, digest] of entries) {
      expect(key).toMatch(/^public\.ecr\.aws\/supabase\/[a-z-]+:[\w.-]+$/);
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
