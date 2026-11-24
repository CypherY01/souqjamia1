// Task 4.2 (FR16 to FR20, BR06, BR08, DEC28, section 6.3): the wizard's rules per step and its
// payload (apps/web/components/sell/wizard.ts), and the restored uploads (followUpload, TC33).
import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResult } from "../../apps/web/lib/client/api.ts";
import { followUpload, type UploadState } from "../../apps/web/lib/client/upload.ts";
import {
  AGREEMENT,
  buildPayload,
  controlIdOf,
  EMPTY_FIELDS,
  fieldErrorText,
  stepErrors,
  type SellCatalog,
} from "../../apps/web/components/sell/wizard.ts";

const catalog: SellCatalog = {
  categories: [{ id: "cat-1", label: "الكتب والدراسة" }],
  points: [{ id: "point-1", kind: "campus", label: "نقطة لقاء تجريبية 1" }],
};

const ready = [
  { phase: "ready", uploadId: "m1" },
  { phase: "ready", uploadId: "m2" },
];

const fields = {
  ...EMPTY_FIELDS,
  title: "  مكتب خشبي  ",
  description: "مكتب بحالة جيدة\r\nمع درج",
  categoryId: "cat-1",
  condition: "good",
  priceText: "٣٥٠",
  negotiable: true,
  place: AGREEMENT,
};

describe("FR16: each step checks its own fields before Next", () => {
  it("BR06 step 1 needs one to ten images, all ready", () => {
    expect(stepErrors(1, fields, [], catalog).media_ids).toBe("أضف صورة واحدة على الأقل.");
    expect(
      stepErrors(1, fields, [{ phase: "processing", uploadId: "m1" }], catalog).media_ids,
    ).toBe("انتظر حتى تجهز كل الصور، أو احذف الصورة التي لم تُقبل.");
    expect(stepErrors(1, fields, ready, catalog)).toEqual({});
  });

  it("FR18 BR04 step 2 needs the title, an offered category, one of five conditions and the description", () => {
    expect(stepErrors(2, fields, ready, catalog)).toEqual({});
    const errors = stepErrors(
      2,
      { ...fields, title: "قق", categoryId: "gone", condition: "broken", description: "" },
      ready,
      catalog,
    );
    expect(errors).toEqual({
      title: "العنوان قصير. اكتب 5 أحرف على الأقل.",
      category_id: "اختر الفئة.",
      condition: "اختر حالة الغرض.",
      description: "اكتب وصفاً للغرض.",
    });
  });

  it("TC08 step 3 takes 0 to 50,000 riyals with two decimals, and a free item is not negotiable", () => {
    expect(stepErrors(3, fields, ready, catalog)).toEqual({});
    expect(stepErrors(3, { ...fields, priceText: "50000.01" }, ready, catalog)).toEqual({
      price_minor: "السعر 50,000 ريال على الأكثر.",
    });
    expect(stepErrors(3, { ...fields, priceText: "1.234" }, ready, catalog).price_minor).toBe(
      "منزلتان عشريتان على الأكثر، مثل 350.50.",
    );
    expect(stepErrors(3, { ...fields, priceText: "0", negotiable: true }, ready, catalog)).toEqual({
      is_negotiable: "التفاوض غير متاح لغرض مجاني.",
    });
  });

  it("DEC28 step 4 takes «حسب الاتفاق» or an offered point, even with no point at all", () => {
    expect(stepErrors(4, fields, ready, catalog)).toEqual({});
    expect(stepErrors(4, { ...fields, place: "point-1" }, ready, catalog)).toEqual({});
    expect(stepErrors(4, { ...fields, place: "" }, ready, catalog).location_id).toBe(
      "اختر مكاناً أو «حسب الاتفاق».",
    );
    // Owner note 1 on task 4.2: no suggested places yet (G02).
    expect(stepErrors(4, fields, ready, { ...catalog, points: [] })).toEqual({});
    expect(
      stepErrors(4, { ...fields, place: "point-1" }, ready, { ...catalog, points: [] }),
    ).toHaveProperty("location_id");
  });
});

describe("the payload is the contract's ListingInput", () => {
  it("FR19 DEC28 the text is normalized, the price in halalas, «حسب الاتفاق» is null", () => {
    expect(buildPayload(fields, ready)).toEqual({
      title: "مكتب خشبي",
      description: "مكتب بحالة جيدة\nمع درج",
      category_id: "cat-1",
      condition: "good",
      location_id: null,
      price_minor: 35_000,
      is_negotiable: true,
      media_ids: ["m1", "m2"],
    });
    expect(buildPayload({ ...fields, place: "point-1" }, ready)?.location_id).toBe("point-1");
    expect(buildPayload({ ...fields, priceText: "0" }, ready)?.is_negotiable).toBe(false);
    expect(buildPayload(fields, [{ phase: "uploading", uploadId: null }])).toBeNull();
  });
});

describe("section 6.3: the server's field errors in the wizard's words", () => {
  it("known codes have their text, an unknown one a general line, never the code", () => {
    expect(fieldErrorText("category_id", "unavailable")).toBe(
      "هذه الفئة لم تعد متاحة. اختر غيرها.",
    );
    expect(fieldErrorText("location_id", "unavailable")).toContain("حسب الاتفاق");
    expect(fieldErrorText("price_minor", "too_big")).toBe("السعر 50,000 ريال على الأكثر.");
    expect(fieldErrorText("media_ids", "too_big")).toBe("10 صور على الأكثر.");
    expect(fieldErrorText("condition", "invalid_value")).toBe("اختر حالة الغرض.");
    expect(fieldErrorText("title", "made_up")).toBe("راجع هذا الحقل.");
    expect(controlIdOf("condition", "new_boxed", AGREEMENT)).toBe("sell-condition-new_boxed");
    expect(controlIdOf("location_id", "new_boxed", AGREEMENT)).toBe("sell-place-agreement");
  });
});

describe("TC33: an upload kept in the draft is asked again", () => {
  function api(answers: ApiResult<unknown>[]): ApiClient {
    return {
      request: () => Promise.resolve((answers.shift() ?? answers[0]) as never),
      resetCsrfToken: () => undefined,
    };
  }
  const upload = (status: string, extra: Record<string, unknown> = {}): ApiResult<unknown> => ({
    ok: true,
    status: 200,
    location: null,
    data: { id: "m1", status, rejection_reason: null, preview: null, expires_at: null, ...extra },
  });
  const deps = (answers: ApiResult<unknown>[]) => ({
    api: api(answers),
    sleep: () => Promise.resolve(),
  });
  const states = (): { list: UploadState[]; on: (state: UploadState) => void } => {
    const list: UploadState[] = [];
    return { list, on: (state) => list.push(state) };
  };

  it("a ready one comes back with a fresh preview", async () => {
    const seen = states();
    const last = await followUpload(
      "m1",
      seen.on,
      deps([upload("ready", { preview: { url: "https://x/p", expires_at: "z" } })]),
    );
    expect(last).toMatchObject({ phase: "ready", uploadId: "m1", previewUrl: "https://x/p" });
  });

  it("RET01 a deleted, unknown, never-sent or past-expiry one is expired, and asks for the file again", async () => {
    const notFound: ApiResult<unknown> = {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      fieldErrors: [],
      retryAfter: null,
      traceId: null,
    };
    for (const answer of [
      upload("deleted"),
      notFound,
      upload("pending"),
      upload("ready", { expires_at: "2026-01-01T00:00:00.000Z" }),
    ]) {
      const last = await followUpload(
        "m1",
        () => undefined,
        deps([answer]),
        () => Date.parse("2026-11-24T00:00:00.000Z"),
      );
      expect(last.phase).toBe("expired");
    }
  });

  it("a processing one is followed until the worker decides", async () => {
    const seen = states();
    const last = await followUpload(
      "m1",
      seen.on,
      deps([upload("processing"), upload("rejected", { rejection_reason: "corrupt" })]),
    );
    expect(last).toMatchObject({ phase: "rejected", reason: "corrupt" });
    expect(seen.list.map((state) => state.phase)).toEqual(["processing", "rejected"]);
  });
});
