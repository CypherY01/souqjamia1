// Task 1.6, owner condition 2: every server key is derived from APP_SECRET with HKDF-SHA256,
// one purpose name per key, so a key for one job can never be used for another.
// Changing APP_SECRET invalidates CSRF tokens and open cursors (ops/runbooks/secrets.md).
import { hkdfSync } from "node:crypto";

export type KeyPurpose = "csrf" | "cursor";

/** Fixed per application and format version; changing it is the same as changing APP_SECRET. */
export const HKDF_SALT = "souqjamia1/keys/v1";
const KEY_BYTES = 32;

const cache = new Map<string, Map<KeyPurpose, Buffer>>();

export function deriveKey(appSecret: string, purpose: KeyPurpose): Buffer {
  let keys = cache.get(appSecret);
  if (keys === undefined) {
    keys = new Map();
    cache.set(appSecret, keys);
  }
  let key = keys.get(purpose);
  if (key === undefined) {
    key = Buffer.from(hkdfSync("sha256", appSecret, HKDF_SALT, purpose, KEY_BYTES));
    keys.set(purpose, key);
  }
  return key;
}
