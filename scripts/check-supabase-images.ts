// `pnpm check:supabase-images` (task 2.1, item 9). The CI rule pins Docker images by digest,
// but the Supabase CLI pulls its images by the tags written into its release. This compares
// the digest of every image the local stack is running with packages/db/supabase/images.lock.json
// and fails on any image that is missing or different. After a Supabase CLI upgrade, start the
// full stack and run `pnpm check:supabase-images --write` to record the new digests.
//
// Task 4.5, item 0 (owner decision, 28 November 2026): the step failed three times in CI and
// passed on rerun, and its log kept only «Error:». So:
//  - On any failure every image is printed: the name `docker ps` shows, its RepoTags, its
//    RepoDigests, the lock key expected and the reason (not_pinned, digest_mismatch, no_digest,
//    registry_not_allowed).
//  - The lock keys stay public.ecr.aws/... . An image pulled from another registry of a fixed
//    list (docker.io, ghcr.io), with the same repository path and tag, passes only when one of
//    its registry digests equals the pinned digest exactly, and prints a warning
//    (`::warning::` in GitHub Actions). A different digest always fails, from any registry.
//  - When `docker ps` shows an image id instead of a name, the image's RepoTags are used.
//  - `--write` records digests from public.ecr.aws only and refuses an image from elsewhere.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { CONFIG_TOML, DB_DIR } from "./local-supabase.ts";

export const LOCK_FILE = join(DB_DIR, "supabase", "images.lock.json");

/** The registry of every lock key. */
export const PINNED_REGISTRY = "public.ecr.aws";
/** Registries an image may come from, with a digest equal to the pinned one. */
export const ALLOWED_REGISTRIES: readonly string[] = [PINNED_REGISTRY, "docker.io", "ghcr.io"];

export interface ImageLock {
  comment: string;
  images: Record<string, string>;
}

/** One running image, as `docker ps` and `docker image inspect` show it. */
export interface RunningImage {
  /** `{{.Image}}` of `docker ps`: a reference, or an image id. */
  shown: string;
  repoTags: readonly string[];
  repoDigests: readonly string[];
}

export type FailureReason = "not_pinned" | "digest_mismatch" | "no_digest" | "registry_not_allowed";

export interface ImageResult {
  image: RunningImage;
  /** The lock key of the first reference tried, or null when there is no tagged reference. */
  expectedKey: string | null;
  ok: boolean;
  reason: FailureReason | null;
  /** Set when the image passed from a registry other than the pinned one. */
  registry: string | null;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
  results: ImageResult[];
}

interface Reference {
  registry: string;
  /** The repository path without the registry, e.g. supabase/postgres. */
  path: string;
  tag: string | null;
  digest: string | null;
}

/** Splits a Docker reference into registry, path, tag and digest (docker.io when none). */
export function parseReference(reference: string): Reference {
  let rest = reference;
  let digest: string | null = null;
  const at = rest.indexOf("@");
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let tag: string | null = null;
  const colon = rest.lastIndexOf(":");
  if (colon > rest.lastIndexOf("/")) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  const slash = rest.indexOf("/");
  const first = slash === -1 ? "" : rest.slice(0, slash);
  let registry = "docker.io";
  let path = rest;
  if (first.includes(".") || first.includes(":") || first === "localhost") {
    registry = first;
    path = rest.slice(slash + 1);
  }
  if (registry === "docker.io" && path.startsWith("library/")) path = path.slice("library/".length);
  return { registry, path, tag, digest };
}

function isImageId(shown: string): boolean {
  return /^(sha256:)?[0-9a-f]{12,64}$/.test(shown);
}

function lockKey(ref: Reference): string {
  return `${PINNED_REGISTRY}/${ref.path}:${ref.tag ?? ""}`;
}

/** The references to try: the shown name, or the image's tags when docker shows an id. */
function referencesOf(image: RunningImage): Reference[] {
  const names = isImageId(image.shown) ? image.repoTags : [image.shown];
  return names.map(parseReference).filter((ref) => ref.tag !== null);
}

function check(lock: ImageLock, image: RunningImage, ref: Reference): ImageResult {
  const expectedKey = lockKey(ref);
  const result = (ok: boolean, reason: FailureReason | null): ImageResult => ({
    image,
    expectedKey,
    ok,
    reason,
    registry: ok && ref.registry !== PINNED_REGISTRY ? ref.registry : null,
  });
  if (!ALLOWED_REGISTRIES.includes(ref.registry)) return result(false, "registry_not_allowed");
  const pinned = lock.images[expectedKey];
  if (pinned === undefined) return result(false, "not_pinned");
  // A registry digest of the same repository path, from an allowed registry.
  const digests = image.repoDigests
    .map(parseReference)
    .filter((d) => d.path === ref.path && ALLOWED_REGISTRIES.includes(d.registry))
    .map((d) => d.digest)
    .filter((d): d is string => d !== null);
  if (digests.length === 0) return result(false, "no_digest");
  return digests.includes(pinned) ? result(true, null) : result(false, "digest_mismatch");
}

/** One line per image, for the diagnostics printed on any failure. */
export function describe(result: ImageResult): string {
  const state = result.ok ? "ok" : (result.reason ?? "failed");
  return [
    `${result.image.shown}: ${state}`,
    `expected key ${result.expectedKey ?? "(no tagged reference)"}`,
    `RepoTags ${JSON.stringify(result.image.repoTags)}`,
    `RepoDigests ${JSON.stringify(result.image.repoDigests)}`,
  ].join("; ");
}

export function checkImages(lock: ImageLock, images: readonly RunningImage[]): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const results: ImageResult[] = [];
  if (images.length === 0) errors.push("no running image found; start the stack first");
  for (const image of images) {
    const tried = referencesOf(image).map((ref) => check(lock, image, ref));
    const passed = tried.find((r) => r.ok);
    const result: ImageResult = passed ??
      tried[0] ?? { image, expectedKey: null, ok: false, reason: "not_pinned", registry: null };
    results.push(result);
    if (!result.ok) errors.push(describe(result));
    else if (result.registry !== null) {
      warnings.push(
        `${image.shown}: pulled from ${result.registry}, digest equals the pin of ${result.expectedKey ?? ""}`,
      );
    }
  }
  return { errors, warnings, results };
}

/** `--write`: the lock entries of the running images; public.ecr.aws only. */
export function lockEntries(images: readonly RunningImage[]): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const image of images) {
    const ref = parseReference(image.shown);
    if (ref.registry !== PINNED_REGISTRY || ref.tag === null) {
      throw new Error(
        `${image.shown}: --write records ${PINNED_REGISTRY} images only (${describeShort(image)})`,
      );
    }
    const digest = image.repoDigests
      .map(parseReference)
      .find((d) => d.registry === PINNED_REGISTRY && d.path === ref.path)?.digest;
    if (digest === undefined || digest === null) {
      throw new Error(
        `${image.shown}: no registry digest (built locally?) (${describeShort(image)})`,
      );
    }
    entries[lockKey(ref)] = digest;
  }
  return entries;
}

function describeShort(image: RunningImage): string {
  return `RepoDigests ${JSON.stringify(image.repoDigests)}`;
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" });
}

function runningImages(): RunningImage[] {
  const config = parse(readFileSync(CONFIG_TOML, "utf8")) as { project_id?: unknown };
  if (typeof config.project_id !== "string") throw new Error("config.toml: project_id missing");
  const shown = new Set(
    docker([
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${config.project_id}`,
      "--format",
      "{{.Image}}",
    ])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  return [...shown].sort().map((image) => {
    const inspected = JSON.parse(
      docker([
        "image",
        "inspect",
        "--format",
        '{"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}}}',
        image,
      ]),
    ) as { tags: string[] | null; digests: string[] | null };
    return { shown: image, repoTags: inspected.tags ?? [], repoDigests: inspected.digests ?? [] };
  });
}

function readLock(): ImageLock {
  return JSON.parse(readFileSync(LOCK_FILE, "utf8")) as ImageLock;
}

if (import.meta.main) {
  const warningPrefix = process.env.GITHUB_ACTIONS === "true" ? "::warning::" : "warning: ";
  try {
    const running = runningImages();
    if (process.argv.includes("--write")) {
      const lock = readLock();
      const entries = lockEntries(running);
      const images = { ...lock.images, ...entries };
      const sorted = Object.fromEntries(
        Object.entries(images).sort(([a], [b]) => a.localeCompare(b)),
      );
      writeFileSync(LOCK_FILE, `${JSON.stringify({ ...lock, images: sorted }, null, 2)}\n`);
      console.log(`check:supabase-images: wrote ${String(running.length)} digests`);
    } else {
      const { errors, warnings, results } = checkImages(readLock(), running);
      for (const warning of warnings)
        console.log(`${warningPrefix}check:supabase-images: ${warning}`);
      if (errors.length > 0) {
        for (const error of errors) console.error(`check:supabase-images: ${error}`);
        console.error("check:supabase-images: every running image:");
        for (const result of results) console.error(`check:supabase-images:   ${describe(result)}`);
        process.exitCode = 1;
      } else {
        console.log(`check:supabase-images: ${String(running.length)} images match their digests`);
      }
    }
  } catch (error) {
    console.error(
      `check:supabase-images: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
