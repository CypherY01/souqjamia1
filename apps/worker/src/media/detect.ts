// Task 4.1 (SEC08, FR61, TC32, DEC83): what an upload really is, from its first bytes, before any
// decoder sees it. Only JPEG, PNG and WebP go further, and only when not animated: GIF, SVG,
// HEIC and anything else are refused with a format error, whatever the browser declared.
import type { ImageMime } from "@souq/domain";

export type Detected =
  | { readonly mime: ImageMime; readonly animated: boolean }
  | { readonly mime: null; readonly kind: "gif" | "svg" | "heif" | "unknown" };

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** APNG: an acTL chunk before the first IDAT (PNG chunks: length, type, data, CRC). */
function isAnimatedPng(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

/** WebP: the VP8X header's animation flag, or an ANIM or ANMF chunk anywhere in the file. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (ascii(bytes, 12, 4) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    if (type === "ANIM" || type === "ANMF") return true;
    const size = view.getUint32(offset + 4, true);
    offset += 8 + size + (size % 2);
  }
  return false;
}

/** Text that opens like markup (SVG, XML, HTML), after an optional BOM and white space. */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  let offset = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (offset < bytes.length && [0x09, 0x0a, 0x0d, 0x20].includes(bytes[offset] ?? 0)) {
    offset += 1;
  }
  return bytes[offset] === 0x3c;
}

export function detectImage(bytes: Uint8Array): Detected {
  if (startsWith(bytes, JPEG)) return { mime: "image/jpeg", animated: false };
  if (startsWith(bytes, PNG)) return { mime: "image/png", animated: isAnimatedPng(bytes) };
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mime: "image/webp", animated: isAnimatedWebp(bytes) };
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { mime: null, kind: "gif" };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") return { mime: null, kind: "heif" };
  if (looksLikeMarkup(bytes)) return { mime: null, kind: "svg" };
  return { mime: null, kind: "unknown" };
}
