// Task 4.2 (FR21, FR60, DEC07, BR25, TC33, TC82): the wizard's draft, kept in this tab only
// (sessionStorage), never on the server and never after the tab closes.
//  - Only non-sensitive text and choices, the ids of temporary uploads and their order, and the
//    publication's Idempotency-Key with the last payload whose outcome is unknown. Never a file,
//    a preview, a signed link or a password.
//  - The draft belongs to one member: another member's draft is removed when read (an account
//    change in the same tab), and logout, login and signup remove it (clearSellDraft).
//  - "Shared device" removes it and stops saving in this tab (item 3).
//  - Storage may be missing or refuse (private mode, blocked site data): every access is in
//    try/catch, and the wizard works without saving.
import { SELL_STEPS, type SellStep } from "@souq/domain";

export const SELL_DRAFT_KEY = "souq.sell-draft";
export const SELL_SHARED_KEY = "souq.sell-draft.shared";
const VERSION = 1;
const MAX_IMAGES = 10;
const MAX_TEXT = 10_000;

export interface SellDraftFields {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  /** As typed, so "٣٥٠" stays "٣٥٠" (DEC50). */
  priceText: string;
  negotiable: boolean;
  /** "" none chosen yet, "agreement" for «حسب الاتفاق» (DEC28), else a meeting point id. */
  place: string;
}

export interface SellDraftImage {
  /** null: the upload had no id yet when the tab was reloaded, so its file must be picked again. */
  mediaId: string | null;
  fileName: string;
}

export interface SellDraftPublish {
  key: string;
  /** The payload of the last request whose answer never came (FR22), or null. */
  unconfirmed: unknown;
}

export interface SellDraft {
  v: typeof VERSION;
  owner: string;
  step: SellStep;
  fields: SellDraftFields;
  images: SellDraftImage[];
  publish: SellDraftPublish | null;
}

/** The part of Storage the draft uses, so tests pass their own. */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The tab's sessionStorage, or null when the browser refuses it. */
export function browserStore(): DraftStore | null {
  try {
    const store = window.sessionStorage;
    const probe = `${SELL_DRAFT_KEY}.probe`;
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT;
}

function parseFields(value: unknown): SellDraftFields | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    !isText(v.title) ||
    !isText(v.description) ||
    !isText(v.categoryId) ||
    !isText(v.condition) ||
    !isText(v.priceText) ||
    typeof v.negotiable !== "boolean" ||
    !isText(v.place)
  ) {
    return null;
  }
  return {
    title: v.title,
    description: v.description,
    categoryId: v.categoryId,
    condition: v.condition,
    priceText: v.priceText,
    negotiable: v.negotiable,
    place: v.place,
  };
}

function parseImages(value: unknown): SellDraftImage[] | null {
  if (!Array.isArray(value) || value.length > MAX_IMAGES) return null;
  const images: SellDraftImage[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { mediaId, fileName } = item as Record<string, unknown>;
    if (!(mediaId === null || (typeof mediaId === "string" && UUID.test(mediaId)))) return null;
    if (typeof fileName !== "string" || fileName.length > 255) return null;
    images.push({ mediaId, fileName });
  }
  return images;
}

function parsePublish(value: unknown): SellDraftPublish | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { key, unconfirmed } = value as Record<string, unknown>;
  if (typeof key !== "string" || !UUID.test(key)) return undefined;
  return { key, unconfirmed: unconfirmed ?? null };
}

/** The member's draft, or null. A draft of another member, or a broken one, is removed. */
export function loadDraft(store: DraftStore | null, owner: string): SellDraft | null {
  if (store === null) return null;
  try {
    const raw = store.getItem(SELL_DRAFT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fields = parseFields(parsed.fields);
    const images = parseImages(parsed.images);
    const publish = parsePublish(parsed.publish);
    const step = parsed.step;
    if (
      parsed.v !== VERSION ||
      parsed.owner !== owner ||
      fields === null ||
      images === null ||
      publish === undefined ||
      !SELL_STEPS.includes(step as SellStep)
    ) {
      store.removeItem(SELL_DRAFT_KEY);
      return null;
    }
    return { v: VERSION, owner, step: step as SellStep, fields, images, publish };
  } catch {
    try {
      store.removeItem(SELL_DRAFT_KEY);
    } catch {
      // Nothing more to do: the wizard starts empty.
    }
    return null;
  }
}

/** Writes the draft. false when the browser refused it (full, blocked). */
export function saveDraft(store: DraftStore | null, draft: SellDraft): boolean {
  if (store === null) return false;
  try {
    store.setItem(SELL_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(store: DraftStore | null): void {
  try {
    store?.removeItem(SELL_DRAFT_KEY);
  } catch {
    // Storage refused: there is nothing it could have kept either.
  }
}

/** Item 3: whether this tab was marked as a shared device. */
export function sharedDevice(store: DraftStore | null): boolean {
  try {
    return store?.getItem(SELL_SHARED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Marks or unmarks the tab as a shared device. Marking removes the draft. */
export function setSharedDevice(store: DraftStore | null, shared: boolean): void {
  try {
    if (shared) {
      store?.removeItem(SELL_DRAFT_KEY);
      store?.setItem(SELL_SHARED_KEY, "1");
    } else {
      store?.removeItem(SELL_SHARED_KEY);
    }
  } catch {
    // Without storage nothing is saved anyway.
  }
}

/** TC82: logout, login and signup remove any draft in this tab. */
export function clearSellDraft(store: DraftStore | null = browserStore()): void {
  removeDraft(store);
}
