// BR21, TC02, TC65 (task 3.3, item 5): the return path after login is a path on this site only.
// One function for the browser and the server. The login page drops a path that fails it, and
// API002 refuses it with not_local before it calls Supabase Auth.
//
// Each rule closes a known way out of the site:
//   - one leading slash: "//evil.example" and "/\evil.example" are links to another host;
//   - no backslash anywhere: browsers read it as a slash in URLs;
//   - no control, format or space characters: browsers drop tab and newline from URLs, so a
//     slash, a tab, then "/evil.example" becomes "//evil.example";
//   - resolved on a fixed origin, the origin must not change (whatever the rules above missed);
//   - not an API route, and not the login or signup page (a loop).
export const LOCAL_PATH_MAX = 1024;

const BASE = "https://local.invalid";
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Z}\\]/u;
const LOOP_PAGES = new Set(["/login", "/signup"]);

/** The path when it is safe to send the visitor to, otherwise null. */
export function safeLocalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > LOCAL_PATH_MAX) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (UNSAFE_CHARACTER.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  if (LOOP_PAGES.has(url.pathname)) return null;
  return value;
}
