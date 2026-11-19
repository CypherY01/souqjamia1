// Acting as a database role inside the current transaction (task 2.1).
// anon and authenticated: what PostgREST and Realtime do for the browser.
// souq_web and souq_worker: what the Next.js server and the worker do (DEC36).
import { randomUUID } from "node:crypto";
import type pg from "pg";

export const CALLER_ROLES = [
  "anon",
  "authenticated",
  "service_role",
  "souq_web",
  "souq_worker",
] as const;
export type CallerRole = (typeof CALLER_ROLES)[number];

/** Server roles (SEC02): each app entry point is granted to exactly one of them. */
export const SERVER_ROLES = ["souq_web", "souq_worker"] as const;

export interface Claims {
  sub: string;
  role: "authenticated";
  session_id: string;
  aal: "aal1" | "aal2";
  /** DEC73: an ordinary session has the password method; without it the session is limited. */
  amr?: { method: string; timestamp: number }[];
}

/** amr of a password sign-in, as Supabase Auth writes it (DEC73). */
export function passwordAmr(): { method: string; timestamp: number }[] {
  return [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }];
}

/** Claims as the server would set them after verifying a member's JWT (owner condition 2). */
export function memberClaims(sub: string = randomUUID()): Claims {
  return { sub, role: "authenticated", session_id: randomUUID(), aal: "aal1", amr: passwordAmr() };
}

/**
 * Switches to `role` for the rest of the transaction and, when given, sets the claims for this
 * transaction only, exactly as the server does: set_config('request.jwt.claims', ..., true).
 */
export async function actAs(
  client: pg.ClientBase,
  role: CallerRole | "postgres",
  claims?: Claims | string,
): Promise<void> {
  await client.query(role === "postgres" ? "reset role" : `set local role ${role}`);
  if (claims !== undefined) {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      typeof claims === "string" ? claims : JSON.stringify(claims),
    ]);
  }
}
