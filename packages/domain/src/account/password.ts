// DEC32, BR24, SEC03, FR01: the password rule (task 3.2, item 1), the same function in the
// browser and on the server. A password is never trimmed or normalized and needs no character
// classes. Its length is counted in code points, 8 to 64. Supabase Auth hashes with bcrypt,
// which reads at most 72 bytes, so a longer UTF-8 encoding is refused instead of being cut.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordError = "too_short" | "too_long" | "too_many_bytes";

const encoder = new TextEncoder();

/** Code points, exactly as typed (no NFC, no trim). */
export function passwordLength(password: string): number {
  return Array.from(password).length;
}

/** UTF-8 bytes, exactly as typed. */
export function passwordBytes(password: string): number {
  return encoder.encode(password).byteLength;
}

/** null when the password follows the rule, otherwise the first rule it breaks. */
export function checkPassword(password: string): PasswordError | null {
  const length = passwordLength(password);
  if (length < PASSWORD_MIN) return "too_short";
  if (length > PASSWORD_MAX) return "too_long";
  if (passwordBytes(password) > PASSWORD_MAX_BYTES) return "too_many_bytes";
  return null;
}
