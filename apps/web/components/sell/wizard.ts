// Task 4.2 (FR16 to FR22, section 6.3): the wizard's rules per step and its payload, without React,
// so the unit tests run them. The same functions as the server (@souq/domain); the server stays
// the authority and checks everything again.
import {
  LISTING_DESCRIPTION_MAX,
  LISTING_DESCRIPTION_MIN,
  LISTING_IMAGES_MAX,
  LISTING_PRICE_MAX_MINOR,
  LISTING_TITLE_MAX,
  LISTING_TITLE_MIN,
  enums,
  parseListingDescription,
  parseListingPrice,
  parseListingTitle,
  type SellStep,
} from "@souq/domain";
import {
  formatNumber,
  formatPrice,
  messages,
  t,
  type MessageKey,
  type MessageValues,
} from "@souq/i18n";
import type { SellDraftFields } from "../../lib/client/sell-draft.ts";

export const AGREEMENT = "agreement";

export type SellField =
  | "media_ids"
  | "title"
  | "category_id"
  | "condition"
  | "description"
  | "price_minor"
  | "is_negotiable"
  | "location_id";

export type SellErrors = Partial<Record<SellField, string>>;

export interface SellCatalog {
  categories: readonly { id: string; label: string }[];
  points: readonly { id: string; kind: enums.MeetingPointKind; label: string }[];
}

/** The state of the images the wizard needs for its rules. */
export interface ImageSummary {
  readonly phase: string;
  readonly uploadId: string | null;
}

export const EMPTY_FIELDS: SellDraftFields = {
  title: "",
  description: "",
  categoryId: "",
  condition: "",
  priceText: "",
  negotiable: false,
  place: "",
};

const FIELDS: readonly SellField[] = [
  "media_ids",
  "title",
  "category_id",
  "condition",
  "description",
  "price_minor",
  "is_negotiable",
  "location_id",
];

export function isSellField(value: string): value is SellField {
  return (FIELDS as readonly string[]).includes(value);
}

function values(field: SellField): MessageValues {
  switch (field) {
    case "title":
      return { min: formatNumber(LISTING_TITLE_MIN), max: formatNumber(LISTING_TITLE_MAX) };
    case "description":
      return {
        min: formatNumber(LISTING_DESCRIPTION_MIN),
        max: formatNumber(LISTING_DESCRIPTION_MAX),
      };
    case "price_minor":
      return { max: formatPrice(LISTING_PRICE_MAX_MINOR) };
    case "media_ids":
      return { max: formatNumber(LISTING_IMAGES_MAX) };
    default:
      return {};
  }
}

/** The server's price codes in the wizard's words (the amount is typed in riyals). */
const PRICE_CODES: Readonly<Record<string, string>> = {
  too_small: "invalid",
  too_big: "too_large",
  invalid_type: "invalid",
  required: "empty",
};

/**
 * BR04: the five item conditions as choice cards, with their labels and short explanations. Here,
 * not in a client module, so the /dev/ui gallery (a server page) can call it too.
 */
export function conditionOptions(): { value: enums.Condition; label: string; hint: string }[] {
  return enums.Condition.map((value) => ({
    value,
    label: t(`listing.condition.${value}.label`),
    hint: t(`listing.condition.${value}.hint`),
  }));
}

/** The Arabic text of a field error code, from the browser's rules or the server's. */
export function fieldErrorText(field: SellField, code: string): string {
  const groups = messages.sell.fieldErrors as unknown as Record<string, Record<string, string>>;
  const group = groups[field] ?? {};
  let key = field === "price_minor" ? (PRICE_CODES[code] ?? code) : code;
  if (group[key] === undefined && (code === "invalid_format" || code === "invalid_value")) {
    key = "required";
  }
  if (group[key] === undefined) return t("sell.fieldErrors.fallback");
  return t(`sell.fieldErrors.${field}.${key}` as MessageKey, values(field));
}

/** Step 1: one to ten images, all ready (BR06). */
export function imagesErrors(images: readonly ImageSummary[]): SellErrors {
  if (images.length === 0) return { media_ids: fieldErrorText("media_ids", "too_small") };
  if (images.length > LISTING_IMAGES_MAX) {
    return { media_ids: fieldErrorText("media_ids", "too_big") };
  }
  if (images.some((image) => image.phase !== "ready" || image.uploadId === null)) {
    return { media_ids: t("sell.images.waitReady") };
  }
  return {};
}

/** Step 2: title, category, condition and description (FR18, BR04, BR05). */
export function detailsErrors(fields: SellDraftFields, catalog: SellCatalog): SellErrors {
  const errors: SellErrors = {};
  const title = parseListingTitle(fields.title);
  if (!title.ok) errors.title = fieldErrorText("title", title.error);
  if (!catalog.categories.some((category) => category.id === fields.categoryId)) {
    errors.category_id = fieldErrorText("category_id", "required");
  }
  if (!(enums.Condition as readonly string[]).includes(fields.condition)) {
    errors.condition = fieldErrorText("condition", "required");
  }
  const description = parseListingDescription(fields.description);
  if (!description.ok) errors.description = fieldErrorText("description", description.error);
  return errors;
}

/** Step 3: a price from 0 to 50,000 riyals with two decimals at most, never rounded (FR19). */
export function priceErrors(fields: SellDraftFields): SellErrors {
  const price = parseListingPrice(fields.priceText);
  if (!price.ok)
    return { price_minor: t(`sell.fieldErrors.price_minor.${price.error}`, values("price_minor")) };
  if (price.halalas === 0 && fields.negotiable) {
    return { is_negotiable: fieldErrorText("is_negotiable", "not_allowed") };
  }
  return {};
}

/** The halalas of the typed price, or null while it is not valid. */
export function priceOf(fields: SellDraftFields): number | null {
  const price = parseListingPrice(fields.priceText);
  return price.ok ? price.halalas : null;
}

/**
 * Task 4.4: a stored price as the riyals the member typed (Western digits, two decimals only when
 * there are halalas), so the edit page starts from it and parseListingPrice reads it back exactly.
 */
export function priceTextOf(halalas: number): string {
  const riyals = Math.trunc(halalas / 100);
  const rest = halalas % 100;
  return rest === 0 ? String(riyals) : `${String(riyals)}.${String(rest).padStart(2, "0")}`;
}

/** Step 4: a suggested point still in the list, or «حسب الاتفاق» (DEC28). */
export function placeErrors(fields: SellDraftFields, catalog: SellCatalog): SellErrors {
  if (fields.place === AGREEMENT) return {};
  if (catalog.points.some((point) => point.id === fields.place)) return {};
  return { location_id: fieldErrorText("location_id", "required") };
}

export function stepErrors(
  step: SellStep,
  fields: SellDraftFields,
  images: readonly ImageSummary[],
  catalog: SellCatalog,
): SellErrors {
  switch (step) {
    case 1:
      return imagesErrors(images);
    case 2:
      return detailsErrors(fields, catalog);
    case 3:
      return priceErrors(fields);
    case 4:
      return placeErrors(fields, catalog);
    default:
      return {};
  }
}

/** The contract's ListingInput. */
export interface ListingPayload {
  title: string;
  description: string;
  category_id: string;
  condition: string;
  location_id: string | null;
  price_minor: number;
  is_negotiable: boolean;
  media_ids: string[];
}

/** The payload of a wizard whose four steps are valid, or null. */
export function buildPayload(
  fields: SellDraftFields,
  images: readonly ImageSummary[],
): ListingPayload | null {
  const title = parseListingTitle(fields.title);
  const description = parseListingDescription(fields.description);
  const price = parseListingPrice(fields.priceText);
  const ids = images.map((image) => image.uploadId);
  if (!title.ok || !description.ok || !price.ok || ids.some((id) => id === null)) return null;
  return {
    title: title.value,
    description: description.value,
    category_id: fields.categoryId,
    condition: fields.condition,
    location_id: fields.place === AGREEMENT || fields.place === "" ? null : fields.place,
    price_minor: price.halalas,
    is_negotiable: price.halalas > 0 && fields.negotiable,
    media_ids: ids.filter((id): id is string => id !== null),
  };
}

/** The id of the control to focus for a field error. */
export function controlIdOf(field: SellField, firstCondition: string, firstPlace: string): string {
  switch (field) {
    case "media_ids":
      return "sell-images-file";
    case "title":
      return "sell-title";
    case "category_id":
      return "sell-category";
    case "condition":
      return `sell-condition-${firstCondition}`;
    case "description":
      return "sell-description";
    case "price_minor":
      return "sell-price";
    case "is_negotiable":
      return "sell-negotiable";
    case "location_id":
      return `sell-place-${firstPlace}`;
  }
}
