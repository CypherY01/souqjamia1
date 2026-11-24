// Task 4.2 (FR60, DEC07, BR25, TC33, TC82, item 3): the wizard's draft in this tab only
// (apps/web/lib/client/sell-draft.ts), with an in-memory store in place of sessionStorage.
import { describe, expect, it } from "vitest";
import {
  clearSellDraft,
  loadDraft,
  removeDraft,
  saveDraft,
  SELL_DRAFT_KEY,
  setSharedDevice,
  sharedDevice,
  type DraftStore,
  type SellDraft,
} from "../../apps/web/lib/client/sell-draft.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const KEY = "44444444-4444-4444-8444-444444444444";

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function draft(overrides: Partial<SellDraft> = {}): SellDraft {
  return {
    v: 1,
    owner: OWNER,
    step: 3,
    fields: {
      title: "مكتب خشبي",
      description: "مكتب بحالة جيدة",
      categoryId: "c",
      condition: "good",
      priceText: "٣٥٠",
      negotiable: true,
      place: "agreement",
    },
    images: [
      { mediaId: MEDIA, fileName: "desk.jpg" },
      { mediaId: null, fileName: "second.jpg" },
    ],
    publish: { key: KEY, unconfirmed: null },
    ...overrides,
  };
}

describe("FR60 DEC07: the draft lives in this tab", () => {
  it("TC33 a reload restores the text, the choices, the step and the upload ids as typed", () => {
    const store = memoryStore();
    expect(saveDraft(store, draft())).toBe(true);
    expect(loadDraft(store, OWNER)).toEqual(draft());
  });

  it("BR25 only text, choices and ids are kept: no file, preview or link", () => {
    const store = memoryStore();
    saveDraft(store, draft());
    const stored = store.data.get(SELL_DRAFT_KEY) ?? "";
    expect(stored).not.toMatch(/blob:|data:|https?:|token|password/i);
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(
      ["fields", "images", "owner", "publish", "step", "v"].sort(),
    );
  });

  it("TC82 another member's draft in the same tab is removed, never shown", () => {
    const store = memoryStore();
    saveDraft(store, draft());
    expect(loadDraft(store, OTHER)).toBeNull();
    expect(store.data.has(SELL_DRAFT_KEY)).toBe(false);
  });

  it("TC82 logout, login and signup remove the draft", () => {
    const store = memoryStore();
    saveDraft(store, draft());
    clearSellDraft(store);
    expect(loadDraft(store, OWNER)).toBeNull();
  });

  it("a broken or older draft is removed, and the wizard starts empty", () => {
    for (const raw of [
      "{not json",
      JSON.stringify({ ...draft(), v: 0 }),
      JSON.stringify({ ...draft(), step: 9 }),
      JSON.stringify({ ...draft(), images: [{ mediaId: "not-a-uuid", fileName: "x" }] }),
      JSON.stringify({ ...draft(), publish: { key: "nope" } }),
      JSON.stringify({ ...draft(), fields: { title: 1 } }),
    ]) {
      const store = memoryStore();
      store.setItem(SELL_DRAFT_KEY, raw);
      expect(loadDraft(store, OWNER)).toBeNull();
      expect(store.data.has(SELL_DRAFT_KEY)).toBe(false);
    }
  });

  it("item 3: a shared device removes the draft and is remembered for the tab", () => {
    const store = memoryStore();
    saveDraft(store, draft());
    expect(sharedDevice(store)).toBe(false);
    setSharedDevice(store, true);
    expect(sharedDevice(store)).toBe(true);
    expect(loadDraft(store, OWNER)).toBeNull();
    setSharedDevice(store, false);
    expect(sharedDevice(store)).toBe(false);
  });

  it("a browser that refuses storage: nothing is saved, and nothing throws", () => {
    const refusing: DraftStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(saveDraft(refusing, draft())).toBe(false);
    expect(loadDraft(refusing, OWNER)).toBeNull();
    expect(sharedDevice(refusing)).toBe(false);
    expect(() => {
      removeDraft(refusing);
      setSharedDevice(refusing, true);
    }).not.toThrow();
    expect(saveDraft(null, draft())).toBe(false);
    expect(loadDraft(null, OWNER)).toBeNull();
  });
});
