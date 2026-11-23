// Task 4.1 (SEC08, TC32, DEC83): the real type of an upload from its bytes, and the limits the
// browser checks before sending (packages/domain/src/media.ts).
import { describe, expect, it } from "vitest";
import {
  declaredImageProblem,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  privateObjectKey,
  variantsFor,
} from "@souq/domain";
import { detectImage } from "../../apps/worker/src/media/detect.ts";
import {
  animatedWebp,
  apng,
  gif,
  heicHeader,
  jpeg,
  png,
  svg,
  textAsImage,
  webp,
} from "../fixtures/images/index.ts";

describe("TC32: the type comes from the bytes", () => {
  it("JPEG, PNG and WebP are recognized, not animated", async () => {
    expect(detectImage(await jpeg())).toEqual({ mime: "image/jpeg", animated: false });
    expect(detectImage(await png())).toEqual({ mime: "image/png", animated: false });
    expect(detectImage(await webp())).toEqual({ mime: "image/webp", animated: false });
  });

  it("TC32 animated WebP and APNG are animated", async () => {
    expect(detectImage(await animatedWebp())).toEqual({ mime: "image/webp", animated: true });
    expect(detectImage(await apng())).toEqual({ mime: "image/png", animated: true });
  });

  it("TC32 GIF, SVG, HEIC, text and empty input are not images we accept", async () => {
    expect(detectImage(await gif())).toEqual({ mime: null, kind: "gif" });
    expect(detectImage(svg())).toEqual({ mime: null, kind: "svg" });
    expect(
      detectImage(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("\n <svg/>")])),
    ).toEqual({
      mime: null,
      kind: "svg",
    });
    expect(detectImage(heicHeader())).toEqual({ mime: null, kind: "heif" });
    expect(detectImage(textAsImage())).toEqual({ mime: null, kind: "unknown" });
    expect(detectImage(new Uint8Array())).toEqual({ mime: null, kind: "unknown" });
  });

  it("a PNG with a broken chunk length is read safely", async () => {
    const bytes = Buffer.from(await png());
    bytes.writeUInt32BE(0xffffffff, 8);
    expect(detectImage(bytes)).toEqual({ mime: "image/png", animated: false });
  });
});

describe("FR17, DEC08, DEC45, DEC83: the limits and variants", () => {
  it("DEC83 5 MiB and 24,000,000 pixels, as the browser checks them first", () => {
    const ok = { bytes: IMAGE_MAX_BYTES, mime: "image/jpeg", width: 6000, height: 4000 };
    expect(IMAGE_MAX_PIXELS).toBe(24_000_000);
    expect(declaredImageProblem(ok)).toBeNull();
    expect(declaredImageProblem({ ...ok, bytes: IMAGE_MAX_BYTES + 1 })).toBe("too_large");
    expect(declaredImageProblem({ ...ok, height: 4001 })).toBe("too_many_pixels");
    expect(declaredImageProblem({ ...ok, mime: "image/gif" })).toBe("unsupported_type");
    expect(declaredImageProblem({ ...ok, mime: "image/heic" })).toBe("unsupported_type");
    expect(declaredImageProblem({ ...ok, mime: "" })).toBe("unsupported_type");
  });

  it("DEC45 a student card has the master only; the other purposes the three variants too", () => {
    expect(variantsFor("student_card")).toEqual(["master"]);
    for (const purpose of ["listing", "avatar", "chat"] as const) {
      expect(variantsFor(purpose)).toEqual(["master", "w150", "w600", "w1200"]);
    }
    expect(privateObjectKey("abc", "w600")).toBe("abc/w600.webp");
  });
});
