// DEC30: Arabic only in Phase 1. Every UI string goes through a key here, so English can be
// added later without rewriting screens.
import account from "./ar/account.json" with { type: "json" };
import auth from "./ar/auth.json" with { type: "json" };
import common from "./ar/common.json" with { type: "json" };
import dev from "./ar/dev.json" with { type: "json" };
// Supabase Auth email templates are generated from these keys (packages/db, task 1.4).
import email from "./ar/email.json" with { type: "json" };
import errors from "./ar/errors.json" with { type: "json" };
import format from "./ar/format.json" with { type: "json" };
import layout from "./ar/layout.json" with { type: "json" };
// Task 4.2: listing values shared by the wizard and the market (conditions, places).
import listing from "./ar/listing.json" with { type: "json" };
// Task 4.3: the home page, the market and the listing page.
import market from "./ar/market.json" with { type: "json" };
// Task 4.1: image upload states and the safe rejection reasons (API039, FR80).
import media from "./ar/media.json" with { type: "json" };
// Task 3.8: the notifications page, the in-app text of each event, and the email preferences.
import notifications from "./ar/notifications.json" with { type: "json" };
// Task 4.2: the publication wizard (/sell).
import sell from "./ar/sell.json" with { type: "json" };
import ui from "./ar/ui.json" with { type: "json" };

export const messages = {
  account,
  auth,
  common,
  dev,
  email,
  errors,
  format,
  layout,
  listing,
  market,
  media,
  notifications,
  sell,
  ui,
} as const;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A dotted path to one Arabic string, e.g. "common.app.name". */
export type MessageKey = Leaves<typeof messages>;

/** Values for `{name}` placeholders. Numbers should already be formatted (format.ts). */
export type MessageValues = Readonly<Record<string, string | number>>;

export function t(key: MessageKey, values?: MessageValues): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) {
      throw new Error(`Missing message key: ${key}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") {
    throw new Error(`Message key is not a string: ${key}`);
  }
  if (values === undefined) return node;
  return node.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Missing value "${name}" for message key: ${key}`);
    }
    return String(values[name]);
  });
}
