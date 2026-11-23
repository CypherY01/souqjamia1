// Task 4.1 (FR17, DEC08, DEC45, DEC54, DEC83, SEC08, RL09, RET01): the image limits and names
// shared by the server, the worker and the browser. The database has the same values in
// 20261123090000_media.sql, and tests/integration/media-upload.test.ts compares the two.
import type { MediaPurpose, MediaRejectionReason, MediaVariant } from "./enums.ts";

/** FR17, DEC08: 5 MiB per input image. */
export const IMAGE_MAX_BYTES = 5_242_880;
/** FR17, DEC08, DEC83: 24 megapixels means 24,000,000 pixels (width times height). */
export const IMAGE_MAX_PIXELS = 24_000_000;
/** FR17: the only accepted types. SVG, GIF, HEIC and animated images are refused (SEC08). */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

/** Item 9: the purposes API037 accepts in task 4.1. chat comes with its conversations (5.3). */
export const UPLOAD_PURPOSES: readonly MediaPurpose[] = ["listing", "avatar", "student_card"];

/** SEC08, DEC83: the bytes must be announced (API038) within five minutes of the authorization. */
export const UPLOAD_WINDOW_SECONDS = 5 * 60;
/**
 * DEC83: how long Supabase Storage's signed upload token lives (a server-wide setting). The raw
 * object is kept until then, so the token cannot create it again. An integration test fails if
 * the real token lives longer.
 */
export const UPLOAD_TOKEN_LIFETIME_SECONDS = 2 * 60 * 60;
/** RET01: an unattached image is deleted 24 hours after its upload or detachment. */
export const UNATTACHED_LIFETIME_HOURS = 24;
/** BR26, SEC08: private links last at most 60 seconds. */
export const PRIVATE_LINK_SECONDS = 60;

/** RL09: per member, before processing. */
export const RL09_UPLOADS_PER_HOUR = 60;
export const RL09_BYTES_PER_DAY = 200 * 1024 * 1024;

/** SEC08: the Storage buckets (item 3). */
export const MEDIA_BUCKETS = {
  quarantine: "quarantine",
  private: "media-private",
  public: "media-public",
} as const;

/** DEC08: the longest edge of each variant, never upscaled. */
export const VARIANT_EDGES = { w150: 150, w600: 600, w1200: 1200 } as const;

/** DEC45: a student card keeps one private master and no variants. */
export function variantsFor(purpose: MediaPurpose): readonly MediaVariant[] {
  return purpose === "student_card" ? ["master"] : ["master", "w150", "w600", "w1200"];
}

/** The fixed key of a private derivative in media-private, so a repeated job writes the same file. */
export function privateObjectKey(mediaId: string, variant: MediaVariant): string {
  return `${mediaId}/${variant}.webp`;
}

export function isImageMime(value: string): value is ImageMime {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export interface DeclaredImage {
  readonly bytes: number;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
}

/**
 * What the browser can check before uploading, with the reason the worker would give. The server
 * and the worker check again: this only saves a useless upload.
 */
export function declaredImageProblem(image: DeclaredImage): MediaRejectionReason | null {
  if (!isImageMime(image.mime)) return "unsupported_type";
  if (image.bytes > IMAGE_MAX_BYTES) return "too_large";
  if (image.width * image.height > IMAGE_MAX_PIXELS) return "too_many_pixels";
  return null;
}
