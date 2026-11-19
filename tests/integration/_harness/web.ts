// The real web server code against the local stack (task 3.1), as worker.ts does for the worker.
// A web pool logs in as postgres and starts every session as souq_web (the `role` startup
// option), so the server's queries run with exactly that role's grants. Session cookies are
// written by @supabase/ssr itself, from a real signup, through the server's own cookie adapter.
import pg from "pg";
import { inject } from "vitest";
import { createAppDb, type AppDb } from "../../../apps/web/lib/db/app-client.ts";
import {
  createSessionClient,
  type RequestCookie,
  type SupabaseConfig,
} from "../../../apps/web/lib/supabase/server.ts";
import { dbPool } from "./db.ts";
import type { TestMember } from "./users.ts";

export function webPool(max = 5): pg.Pool {
  return new pg.Pool({ connectionString: inject("dbUrl"), options: "-c role=souq_web", max });
}

export function webDb(pool: pg.Pool = webPool()): AppDb {
  return createAppDb(pool);
}

export function stackConfig(): SupabaseConfig {
  const stack = inject("stack");
  return {
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
  };
}

/** The part of the full client the harness uses; the server itself only verifies. */
interface SettableClient {
  auth: {
    setSession(session: { access_token: string; refresh_token: string }): Promise<{
      error: unknown;
    }>;
  };
}

/** The session cookies a browser would hold after `member` signed in, as name and value. */
export async function sessionCookies(member: TestMember): Promise<RequestCookie[]> {
  const jar = new Map<string, string>();
  const client = createSessionClient(stackConfig(), [], (written) => {
    for (const cookie of written) {
      if (cookie.value === null) jar.delete(cookie.name);
      else jar.set(cookie.name, cookie.value);
    }
  }) as unknown as SettableClient;
  const { error } = await client.auth.setSession({
    access_token: member.accessToken,
    refresh_token: member.refreshToken,
  });
  if (error !== null) throw new Error("setSession failed");
  return [...jar].map(([name, value]) => ({ name, value }));
}

const BASE64_PREFIX = "base64-";

function chunkIndex(name: string, base: string): number {
  return name === base ? 0 : Number(name.slice(base.length + 1));
}

/** The session object stored in the cookies (chunks joined, base64url decoded). */
export function readSession(cookies: readonly RequestCookie[]): Record<string, unknown> {
  const first = cookies[0];
  if (first === undefined) throw new Error("no session cookie");
  const base = first.name.replace(/\.\d+$/, "");
  const joined = cookies
    .filter((c) => c.name === base || c.name.startsWith(`${base}.`))
    .sort((a, b) => chunkIndex(a.name, base) - chunkIndex(b.name, base))
    .map((c) => c.value)
    .join("");
  const json = Buffer.from(joined.slice(BASE64_PREFIX.length), "base64url").toString();
  return JSON.parse(json) as Record<string, unknown>;
}

/** Session cookies with an edited session, in one cookie (the reader joins chunks either way). */
export function rewriteSession(
  cookies: readonly RequestCookie[],
  edit: (session: Record<string, unknown>) => Record<string, unknown>,
): RequestCookie[] {
  const first = cookies[0];
  if (first === undefined) throw new Error("no session cookie");
  const base = first.name.replace(/\.\d+$/, "");
  const value =
    BASE64_PREFIX + Buffer.from(JSON.stringify(edit(readSession(cookies)))).toString("base64url");
  return [{ name: base, value }];
}

/** Signs one session out through Supabase Auth: its auth.sessions row is deleted. */
export async function signOutSession(accessToken: string): Promise<void> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, authorization: `Bearer ${accessToken}` },
  });
  if (res.status !== 204) throw new Error(`logout failed with ${String(res.status)}`);
}

/** Removes every acknowledgment of the member: signup records them from task 3.2 (DEC36). */
export async function withdrawAcknowledgments(userId: string): Promise<void> {
  await dbPool().query("delete from public.policy_acknowledgment where user_id = $1", [userId]);
}

/** Acknowledges the policy versions in force (DEC36), as signup does from task 3.2. */
export async function acknowledgeCurrentPolicies(userId: string): Promise<void> {
  await dbPool().query(
    `insert into public.policy_acknowledgment (user_id, policy_type, policy_version)
     select $1, t.policy_type, app.current_policy_version(t.policy_type)
       from unnest(enum_range(null::public.policy_type)) as t(policy_type)
      where app.current_policy_version(t.policy_type) is not null
     on conflict do nothing`,
    [userId],
  );
}

/** Runs one committed statement as postgres with the member id as $1, e.g. a suspension. */
export async function changeMember(userId: string, sql: string): Promise<void> {
  await dbPool().query(sql, [userId]);
}
