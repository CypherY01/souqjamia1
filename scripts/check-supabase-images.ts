// `pnpm check:supabase-images` (task 2.1, item 9). The CI rule pins Docker images by digest,
// but the Supabase CLI pulls its images by the tags written into its release. This compares
// the digest of every image the local stack is running with packages/db/supabase/images.lock.json
// and fails on any image that is missing or different. After a Supabase CLI upgrade, start the
// full stack and run `pnpm check:supabase-images --write` to record the new digests.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { CONFIG_TOML, DB_DIR } from "./local-supabase.ts";

export const LOCK_FILE = join(DB_DIR, "supabase", "images.lock.json");

export interface ImageLock {
  comment: string;
  images: Record<string, string>;
}

/** image reference (repository:tag) to digest (sha256:...) */
export type RunningImages = ReadonlyMap<string, string>;

export function compareImages(lock: ImageLock, running: RunningImages): string[] {
  const errors: string[] = [];
  if (running.size === 0) errors.push("no running image found; start the stack first");
  for (const [image, digest] of running) {
    const pinned = lock.images[image];
    if (pinned === undefined) errors.push(`${image}: not in images.lock.json`);
    else if (pinned !== digest) errors.push(`${image}: digest ${digest}, pinned ${pinned}`);
  }
  return errors;
}

/** The digest the registry gave for this repository, from `docker image inspect`. */
export function digestFor(image: string, repoDigests: readonly string[]): string | undefined {
  const repository = image.slice(0, image.lastIndexOf(":"));
  const entry = repoDigests.find((d) => d.startsWith(`${repository}@`));
  return entry?.slice(repository.length + 1);
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" });
}

function runningImages(): RunningImages {
  const config = parse(readFileSync(CONFIG_TOML, "utf8")) as { project_id?: unknown };
  if (typeof config.project_id !== "string") throw new Error("config.toml: project_id missing");
  const images = new Set(
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
  const result = new Map<string, string>();
  for (const image of [...images].sort()) {
    const repoDigests = JSON.parse(
      docker(["image", "inspect", "--format", "{{json .RepoDigests}}", image]),
    ) as string[];
    const digest = digestFor(image, repoDigests);
    if (digest === undefined) throw new Error(`${image}: no registry digest (built locally?)`);
    result.set(image, digest);
  }
  return result;
}

function readLock(): ImageLock {
  return JSON.parse(readFileSync(LOCK_FILE, "utf8")) as ImageLock;
}

if (import.meta.main) {
  try {
    const running = runningImages();
    if (process.argv.includes("--write")) {
      const lock = readLock();
      const images = { ...lock.images, ...Object.fromEntries(running) };
      const sorted = Object.fromEntries(
        Object.entries(images).sort(([a], [b]) => a.localeCompare(b)),
      );
      writeFileSync(LOCK_FILE, `${JSON.stringify({ ...lock, images: sorted }, null, 2)}\n`);
      console.log(`check:supabase-images: wrote ${String(running.size)} digests`);
    } else {
      const errors = compareImages(readLock(), running);
      if (errors.length > 0) {
        for (const error of errors) console.error(`check:supabase-images: ${error}`);
        process.exitCode = 1;
      } else {
        console.log(`check:supabase-images: ${String(running.size)} images match their digests`);
      }
    }
  } catch (error) {
    console.error(
      `check:supabase-images: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
