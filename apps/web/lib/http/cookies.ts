// Minimal cookie reading and writing for route handlers and the proxy, without framework types,
// so the HTTP layer stays testable on its own.

/** The value of one cookie from the request's Cookie header, or undefined. */
export function readCookie(headers: Headers, name: string): string | undefined {
  const header = headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict";
  path: "/";
  /** Seconds. Omitted: a session cookie. */
  maxAge?: number;
}

/** A Set-Cookie header value. Names and values here are ours (base64url), never user input. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    options.maxAge === undefined ? "" : `Max-Age=${String(options.maxAge)}`,
    options.httpOnly ? "HttpOnly" : "",
    options.secure ? "Secure" : "",
    `SameSite=${options.sameSite}`,
  ]
    .filter(Boolean)
    .join("; ");
}
