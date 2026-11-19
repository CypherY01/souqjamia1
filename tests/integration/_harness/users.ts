// Members for integration tests, created through the real Supabase Auth signup (task 2.2), and
// Data API (PostgREST) requests as anon or as one of them.
import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { dbPool } from "./db.ts";

/** Cloudflare's dummy token: accepted only by the public test secret in config.toml. */
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
export const TEST_PASSWORD = "كلمة-مرور-تجريبية-1";
export const TEST_NAME = "عضو تجريبي";

export interface TestMember {
  id: string;
  email: string;
  accessToken: string;
  /** Task 3.1: for the session cookies of the server tests. */
  refreshToken: string;
  sessionId: string;
}

export function testEmail(prefix = "it"): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

export interface PolicyVersions {
  terms: string;
  privacy: string;
}

/** DEC36: the versions in force, which every signup acknowledges (task 3.2, item 2). */
export async function currentPolicyVersions(): Promise<PolicyVersions> {
  const result = await dbPool().query<{ terms: string | null; privacy: string | null }>(
    `select app.current_policy_version('terms') as terms,
            app.current_policy_version('privacy') as privacy`,
  );
  const row = result.rows[0];
  if (row?.terms == null || row.privacy == null) throw new Error("no published policy versions");
  return { terms: row.terms, privacy: row.privacy };
}

/**
 * The signup data our server sends (task 3.2): the name, the versions in force and the optional
 * college. `data` replaces or adds keys; a key set to undefined is left out.
 */
export async function signupData(
  displayName?: string,
  data: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const versions = await currentPolicyVersions();
  const merged: Record<string, unknown> = {
    display_name: displayName,
    terms_version: versions.terms,
    privacy_version: versions.privacy,
    ...data,
  };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

/** Supabase Auth signup, directly, with the data our server sends (see signupData). */
export async function authSignup(
  email: string,
  displayName?: string,
  data: Record<string, unknown> = {},
): Promise<Response> {
  const stack = inject("stack");
  return fetch(`${stack.apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: TEST_PASSWORD,
      data: await signupData(displayName, data),
      gotrue_meta_security: { captcha_token: TURNSTILE_DUMMY_TOKEN },
    }),
  });
}

/** A signed-in member (DEC63: signup opens a session at once). */
export async function signUpMember(displayName: string = TEST_NAME): Promise<TestMember> {
  const email = testEmail();
  const res = await authSignup(email, displayName);
  if (res.status !== 200) throw new Error(`signup failed with ${String(res.status)}`);
  const body = (await res.json()) as { access_token: string; refresh_token: string };
  const claims = JSON.parse(
    Buffer.from(body.access_token.split(".")[1] ?? "", "base64url").toString(),
  ) as { sub: string; session_id: string };
  return {
    id: claims.sub,
    email,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    sessionId: claims.session_id,
  };
}

/** Deletes the login identity through the Auth admin API (local secret key only). */
export function deleteAuthUser(id: string): Promise<Response> {
  const stack = inject("stack");
  return fetch(`${stack.apiUrl}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: stack.secretKey },
  });
}

export interface RestInit {
  method?: string;
  /** A member's access token; without it the request is anon. */
  token?: string;
  body?: unknown;
}

/** A Data API request, as the browser would send it. */
export function rest(path: string, init: RestInit = {}): Promise<Response> {
  const stack = inject("stack");
  return fetch(`${stack.apiUrl}/rest/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: stack.publishableKey,
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** PostgreSQL's error code from a failed Data API response. */
export async function restErrorCode(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}
