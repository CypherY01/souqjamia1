// DEC30: Arabic only in Phase 1. Every UI string goes through a key here, so English can be
// added later without rewriting screens. Task 1.5 extends this with formatting helpers.
import common from "./ar/common.json" with { type: "json" };
// Supabase Auth email templates are generated from these keys (packages/db, task 1.4).
import email from "./ar/email.json" with { type: "json" };

const messages = { common, email } as const;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A dotted path to one Arabic string, e.g. "common.app.name". */
export type MessageKey = Leaves<typeof messages>;

export function t(key: MessageKey): string {
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
  return node;
}
