// DEC26, FR01: any valid email address, with no university domain (task 3.2, item 1). The
// address is trimmed and sent as typed; Supabase Auth stores it in lower case and compares it
// that way. The pattern is the one zod 4 uses for z.email(): dots only between characters of the
// local part, a domain of labels and a top-level domain of at least two letters.
export const EMAIL_MAX = 254;

const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export type EmailError = "required" | "too_big" | "invalid_format";

export type EmailResult = { ok: true; value: string } | { ok: false; error: EmailError };

export function parseEmail(input: string): EmailResult {
  const value = input.trim();
  if (value === "") return { ok: false, error: "required" };
  if (value.length > EMAIL_MAX) return { ok: false, error: "too_big" };
  if (!EMAIL.test(value)) return { ok: false, error: "invalid_format" };
  return { ok: true, value };
}
