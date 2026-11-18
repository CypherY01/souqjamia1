// Text rules shared by the server and the UI (task 1.5).

/** Text limits are counted after NFC normalization and trimming (CLAUDE.md). */
export function normalizeText(input: string): string {
  return input.normalize("NFC").trim();
}

/** The length used for every text limit: Unicode code points, not UTF-16 units. */
export function countChars(input: string): number {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are the rule, not graphemes
  return [...normalizeText(input)].length;
}

/**
 * TC31: bidirectional embedding, override and isolate controls (U+202A-U+202E, U+2066-U+2069)
 * let member text reorder what is displayed around it. They are removed when member text is
 * displayed; the stored text keeps them (DEC50). LRM, RLM and ALM marks cannot reorder text and
 * are kept.
 */
export function stripBidiControls(input: string): string {
  return input.replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}
