// Task 4.1: test images, built at run time with sharp and by editing bytes, so the repository
// holds no binary file (plan/task-4.1.md). Each is small and made here: no real photo, place or
// person. The GPS position is a made-up point in the sea.
import { crc32 } from "node:zlib";
import sharp from "sharp";

/** A plain colored image. */
function solid(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 11, g: 59, b: 45 } },
  });
}

/** TC32: a JPEG carrying EXIF with a GPS position, a camera name and orientation 6. */
export async function jpegWithGps(width = 64, height = 32): Promise<Buffer> {
  return (
    solid(width, height)
      .jpeg({ quality: 80 })
      .withExif({
        IFD0: { Make: "TestCamera", Model: "Fixture 1" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "10/1 0/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "60/1 0/1 0/1",
        },
      })
      // sharp writes the orientation tag from here, not from withExif.
      .withMetadata({ orientation: 6 })
      .toBuffer()
  );
}

export function jpeg(width = 40, height = 30): Promise<Buffer> {
  return solid(width, height).jpeg({ quality: 80 }).toBuffer();
}

export function png(width = 40, height = 30): Promise<Buffer> {
  return solid(width, height).png().toBuffer();
}

export function webp(width = 40, height = 30): Promise<Buffer> {
  return solid(width, height).webp({ quality: 80 }).toBuffer();
}

/** A large photo-like image, for the three variants (longest edge over 1200). */
export function largeJpeg(): Promise<Buffer> {
  return solid(1600, 900).jpeg({ quality: 70 }).toBuffer();
}

/** TC32: 6000 x 4001 = 24,006,000 pixels, just over the 24,000,000 of DEC83, yet small in bytes. */
export function tooManyPixels(): Promise<Buffer> {
  return solid(6000, 4001).png({ compressionLevel: 9 }).toBuffer();
}

/** An animated WebP of two frames. */
export async function animatedWebp(): Promise<Buffer> {
  const frames = await Promise.all([
    solid(20, 20).png().toBuffer(),
    sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 197, g: 155, b: 39 } },
    })
      .png()
      .toBuffer(),
  ]);
  return sharp(frames, { join: { animated: true } })
    .webp({ loop: 0 })
    .toBuffer();
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** An APNG: a valid PNG with an acTL chunk (two frames) right after IHDR. */
export async function apng(): Promise<Buffer> {
  const still = await png(20, 20);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  actl.writeUInt32BE(0, 4);
  return Buffer.concat([
    still.subarray(0, ihdrEnd),
    pngChunk("acTL", actl),
    still.subarray(ihdrEnd),
  ]);
}

export function gif(): Promise<Buffer> {
  return solid(20, 20).gif().toBuffer();
}

export function svg(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
    "utf8",
  );
}

/** The first bytes of a HEIC file (ftyp box), as an iPhone writes it. */
export function heicHeader(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftypheic", 4, "ascii");
  box.write("mif1heic", 16, "ascii");
  return box;
}

/** TC07: a JPEG cut in the middle of its data. */
export async function truncatedJpeg(): Promise<Buffer> {
  const whole = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: "#000000",
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return whole.subarray(0, Math.floor(whole.length / 2));
}

/** TC07, TC32: text named as an image. */
export function textAsImage(): Buffer {
  return Buffer.from("This is not an image, only text with a .jpg name.\n", "utf8");
}

/** What sharp reads back from an output: the metadata that must be gone (TC32). */
export async function metadataOf(data: Buffer) {
  const meta = await sharp(data).metadata();
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    exif: meta.exif,
    icc: meta.icc,
    xmp: meta.xmp,
    iptc: meta.iptc,
    orientation: meta.orientation,
  };
}
