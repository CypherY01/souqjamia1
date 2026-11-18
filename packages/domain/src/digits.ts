// DEC50: numeric inputs accept Arabic-Indic digits (\u0663\u0665\u0660) and Western digits (350); the server
// converts them before validation. Member free text is stored as typed, so this is applied to
// numeric fields only.

const ARABIC_INDIC_ZERO = 0x0660; // \u0660 to \u0669
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // \u06f0 to \u06f9 (Persian and Urdu keyboards)

/** Replaces Arabic-Indic and extended Arabic-Indic digits with 0-9. Everything else is kept. */
export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero =
      code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}
