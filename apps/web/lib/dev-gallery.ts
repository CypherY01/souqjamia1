import type { ServerEnv } from "./env.ts";

/** Owner decision on task 1.5, item 5: /dev/ui exists locally and on staging, never in production. */
export function devGalleryEnabled(appEnv: ServerEnv["APP_ENV"]): boolean {
  return appEnv !== "production";
}
