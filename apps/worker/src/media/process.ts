// Task 4.1 (FR61, DEC08, DEC45, DEC83, SEC08, TC32): checks the real bytes of one upload and
// makes its derivatives with sharp (libvips).
//  1. The type from the first bytes (detect.ts) must equal the declared type (DEC83), and the
//     image must not be animated.
//  2. The header must decode as the same format, within 24,000,000 pixels (DEC83).
//  3. Orientation is applied first (rotate() reads the EXIF orientation), then every output is
//     encoded again without any metadata: sharp drops EXIF, XMP, IPTC and the ICC profile unless
//     asked to keep them, and converts to sRGB.
//  4. A processed master in WebP quality 90 at full size, and the w150, w600 and w1200 variants in
//     WebP quality 80 on the longest edge, never enlarged (item 5). A student card gets the master
//     only (DEC45).
// A problem with the image itself is an ImageRejected with its safe reason. Anything else (a
// timeout, the machine) is an ordinary error that the job retries (DEC83).
import { createHash } from "node:crypto";
import {
  IMAGE_MAX_PIXELS,
  VARIANT_EDGES,
  variantsFor,
  type enums,
  type ImageMime,
} from "@souq/domain";
import sharp from "sharp";
import { detectImage } from "./detect.ts";

/** SEC08: the processing timeout, measured over all outputs of one image. */
export const PROCESSING_TIMEOUT_MS = 15_000;
const MASTER_QUALITY = 90;
const VARIANT_QUALITY = 80;

const FORMAT_OF: Record<ImageMime, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export class ImageRejected extends Error {
  override name = "ImageRejected";
  readonly reason: enums.MediaRejectionReason;

  constructor(reason: enums.MediaRejectionReason) {
    super(reason);
    this.reason = reason;
  }
}

export class ProcessingTimeout extends Error {
  override name = "ProcessingTimeout";
  readonly code = "IMAGE_TIMEOUT";
}

export interface ProcessedFile {
  readonly variant: enums.MediaVariant;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface ProcessInput {
  readonly bytes: Buffer;
  readonly declaredMime: string;
  readonly purpose: enums.MediaPurpose;
  readonly timeoutMs?: number;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sharp's error text for a decode or limit failure; never shown, only classified. */
function classify(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  if (/timeout/i.test(message)) return new ProcessingTimeout();
  if (/pixel limit/i.test(message)) return new ImageRejected("too_many_pixels");
  return new ImageRejected("corrupt");
}

export async function processImage(input: ProcessInput): Promise<ProcessedFile[]> {
  const startedAt = performance.now();
  const timeoutMs = input.timeoutMs ?? PROCESSING_TIMEOUT_MS;
  const detected = detectImage(input.bytes);
  if (detected.mime === null || detected.mime !== input.declaredMime) {
    throw new ImageRejected("unsupported_type");
  }
  if (detected.animated) throw new ImageRejected("animated");

  const options = {
    limitInputPixels: IMAGE_MAX_PIXELS,
    failOn: "error",
    animated: false,
  } as const;
  let metadata;
  try {
    metadata = await sharp(input.bytes, options).metadata();
  } catch (error) {
    throw classify(error);
  }
  if (metadata.format !== FORMAT_OF[detected.mime]) throw new ImageRejected("unsupported_type");
  if ((metadata.pages ?? 1) > 1) throw new ImageRejected("animated");
  if (metadata.width * metadata.height > IMAGE_MAX_PIXELS) {
    throw new ImageRejected("too_many_pixels");
  }

  const files: ProcessedFile[] = [];
  for (const variant of variantsFor(input.purpose)) {
    const left = timeoutMs - (performance.now() - startedAt);
    if (left <= 0) throw new ProcessingTimeout();
    let pipeline = sharp(input.bytes, options)
      .timeout({ seconds: Math.max(1, Math.ceil(left / 1000)) })
      .rotate();
    if (variant !== "master") {
      const edge = VARIANT_EDGES[variant];
      pipeline = pipeline.resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    let output;
    try {
      output = await pipeline
        .webp({ quality: variant === "master" ? MASTER_QUALITY : VARIANT_QUALITY })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      throw classify(error);
    }
    files.push({
      variant,
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      sha256: sha256Hex(output.data),
    });
  }
  if (performance.now() - startedAt > timeoutMs) throw new ProcessingTimeout();
  return files;
}
