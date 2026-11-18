// SEC06 and TC31: member text is shown as plain text, and only http and https URLs become links.
// Nothing here fetches the target page.

export type TextPart =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "link"; readonly href: string; readonly text: string };

const CANDIDATE = /https?:\/\/[^\s<>"'`]+/giu;

/** Characters that usually end a sentence rather than a URL. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "،", "؛", "؟", "'", '"', "»", "…"]);
const CLOSERS: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Moves trailing punctuation, and unbalanced closing brackets, out of the URL. */
function trimTrailing(candidate: string): string {
  let url = candidate;
  for (;;) {
    const last = url.at(-1);
    if (last === undefined) return url;
    const opener = CLOSERS[last];
    if (TRAILING.has(last) || (opener !== undefined && count(url, last) > count(url, opener))) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

/** A safe href, or null when the candidate must stay text. */
function safeHref(candidate: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  // "https://bank.example@evil.example" shows one host and opens another: keep it as text.
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/** Splits member text into text and link parts. Joining every part's text gives the input back. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let buffer = "";
  let position = 0;
  for (const match of text.matchAll(CANDIDATE)) {
    const candidate = trimTrailing(match[0]);
    const href = candidate === "" ? null : safeHref(candidate);
    const start = match.index;
    if (href === null) continue;
    buffer += text.slice(position, start);
    if (buffer !== "") parts.push({ type: "text", value: buffer });
    buffer = "";
    parts.push({ type: "link", href, text: candidate });
    position = start + candidate.length;
  }
  buffer += text.slice(position);
  if (buffer !== "") parts.push({ type: "text", value: buffer });
  return parts;
}
