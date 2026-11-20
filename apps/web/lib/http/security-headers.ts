// SEC06: nonce-based Content Security Policy and the other security headers (task 1.6).
// The nonce is new for every request, so every page is rendered on request (owner decision on
// task 1.6, item 4); task 8.4 measures the cost under load.
import { randomBytes } from "node:crypto";

/**
 * Task 3.2, DEC36: Cloudflare Turnstile. Its script is added by our own (nonce-trusted) code, so
 * 'strict-dynamic' lets it run; the challenge itself is a frame from this origin.
 */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

export interface CspOptions {
  nonce: string;
  /** `next dev`: React needs eval there, and the dev server injects unsigned styles. */
  dev: boolean;
  /** Supabase API origin: images from Storage, and Realtime over WebSocket. */
  supabaseUrl: string;
  /** The site is served over https (staging and production). */
  https: boolean;
}

export function buildCsp({ nonce, dev, supabaseUrl, https }: CspOptions): string {
  const supabase = new URL(supabaseUrl);
  const supabaseWs = `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data: ${supabase.origin}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase.origin} ${supabaseWs}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Headers that never change: also sent with static files (next.config.ts). */
export const STATIC_SECURITY_HEADERS: readonly [string, string][] = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-Frame-Options", "DENY"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
];

/**
 * SEC03, task 3.2 item 5: pages under /auth/ carry a token in their address (the email links), so
 * they send no Referer and are never stored. They load nothing from outside the site either.
 * Task 3.4: the new-password page of the recovery session gets the same headers.
 */
export function isAuthLinkPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/") || pathname === "/account/reset";
}

export const AUTH_LINK_HEADERS: readonly [string, string][] = [
  ["Referrer-Policy", "no-referrer"],
  ["Cache-Control", "no-store"],
];

export interface SecurityHeaderOptions {
  https: boolean;
  /** Staging and development pages stay out of search engines. */
  noindex: boolean;
}

export function securityHeaders({ https, noindex }: SecurityHeaderOptions): [string, string][] {
  return [
    ...STATIC_SECURITY_HEADERS,
    ...(https
      ? [["Strict-Transport-Security", "max-age=31536000; includeSubDomains"] as [string, string]]
      : []),
    ...(noindex ? [["X-Robots-Tag", "noindex, nofollow"] as [string, string]] : []),
  ];
}
