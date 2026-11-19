// Who is calling (task 3.1, item 3, owner condition on task 2.1): the claims are used only after
// the server has verified the JWT signature with getClaims() (ES256 with the project's JWKS,
// cached in the process for 10 minutes, and exp). getClaims checks nothing else, so the claims
// are checked here too. Any failure is a guest; the log line names the reason, never the token.
//
// Role, status and badge never come from the claims (app_metadata, user_metadata): the database
// is the source (TC65, TC87).
//
// DEC73: an ordinary session has the password method in amr. Any other session is limited: a
// recovery link signs in with amr = otp only. Review this rule before adding a sign-in method
// without a password (OAuth, magic link).
import { log } from "@souq/log";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionClient } from "../supabase/server.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** DEC38: a limited (recovery) session may change the password for 5 minutes after the link. */
export const LIMITED_SESSION_SECONDS = 5 * 60;

export interface AmrEntry {
  method: string;
  timestamp: number;
}

export interface Identity {
  userId: string;
  sessionId: string;
  aal: "aal1" | "aal2";
  amr: readonly AmrEntry[];
  /** DEC73: no password method in amr. */
  limited: boolean;
  /** The verified claims, exactly as set for the transaction (request.jwt.claims). */
  claims: Readonly<Record<string, unknown>>;
}

export type ClaimsRejection =
  | "not_an_object"
  | "issuer"
  | "audience"
  | "role"
  | "anonymous"
  | "subject"
  | "session_id"
  | "aal"
  | "amr";

export type ClaimsCheck = { ok: true; identity: Identity } | { ok: false; reason: ClaimsRejection };

/** The issuer Supabase Auth writes into its tokens: <project URL>/auth/v1. */
export function expectedIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

function parseAmr(value: unknown): AmrEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: AmrEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { method, timestamp } = item as Record<string, unknown>;
    if (typeof method !== "string" || typeof timestamp !== "number") return null;
    entries.push({ method, timestamp });
  }
  return entries;
}

/** Checks verified claims (signature and exp already checked by getClaims). Pure, for tests. */
export function checkClaims(claims: unknown, issuer: string): ClaimsCheck {
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    return { ok: false, reason: "not_an_object" };
  }
  const c = claims as Record<string, unknown>;
  if (c.iss !== issuer) return { ok: false, reason: "issuer" };
  const audience = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!audience.includes("authenticated")) return { ok: false, reason: "audience" };
  if (c.role !== "authenticated") return { ok: false, reason: "role" };
  if (c.is_anonymous !== false) return { ok: false, reason: "anonymous" };
  if (typeof c.sub !== "string" || !UUID.test(c.sub)) return { ok: false, reason: "subject" };
  if (typeof c.session_id !== "string" || !UUID.test(c.session_id)) {
    return { ok: false, reason: "session_id" };
  }
  if (c.aal !== "aal1" && c.aal !== "aal2") return { ok: false, reason: "aal" };
  const amr = parseAmr(c.amr);
  if (amr === null || amr.length === 0) return { ok: false, reason: "amr" };
  return {
    ok: true,
    identity: {
      userId: c.sub,
      sessionId: c.session_id,
      aal: c.aal,
      amr,
      limited: !amr.some((entry) => entry.method === "password"),
      claims: c,
    },
  };
}

/**
 * DEC38: a limited session older than 5 minutes is over. Measured from its newest sign-in
 * method (the recovery link's otp). `nowSeconds` is Unix time.
 */
export function limitedSessionExpired(identity: Identity, nowSeconds: number): boolean {
  if (!identity.limited) return false;
  const since = Math.max(...identity.amr.map((entry) => entry.timestamp));
  return nowSeconds > since + LIMITED_SESSION_SECONDS;
}

/**
 * The verified identity of the client's session, or null for a guest. getClaims() refreshes an
 * expired access token first; the client writes the new cookies through its cookie methods.
 */
export async function verifyIdentity(
  client: SessionClient,
  issuer: string,
  traceId: string,
): Promise<Identity | null> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>;
  try {
    result = await client.auth.getClaims();
  } catch (error) {
    log.warn("auth.verify_failed", { trace_id: traceId, name: (error as Error).name });
    return null;
  }
  if (result.error !== null) {
    log.info("auth.claims_rejected", { trace_id: traceId, reason: result.error.name });
    return null;
  }
  if (result.data === null) return null;
  const checked = checkClaims(result.data.claims, issuer);
  if (!checked.ok) {
    log.warn("auth.claims_rejected", { trace_id: traceId, reason: checked.reason });
    return null;
  }
  return checked.identity;
}
