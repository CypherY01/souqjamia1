// Task 3.3: sessions for the login and logout tests, against the local stack. A password session
// straight from Supabase Auth (another device of the same member), a limited session from a
// consumed email link (amr otp only, DEC73), and the rows of auth.sessions.
import { inject } from "vitest";
import {
  verifyIdentity,
  expectedIssuer,
  type Identity,
} from "../../../apps/web/lib/auth/identity.ts";
import { createSessionClient, type RequestCookie } from "../../../apps/web/lib/supabase/server.ts";
import { generateSignupLink } from "./auth-flow.ts";
import { dbPool, scalar } from "./db.ts";
import { TEST_PASSWORD, testEmail, type TestMember } from "./users.ts";
import { sessionCookies, stackConfig } from "./web.ts";

/** Cloudflare's dummy token, accepted by the public test secret in config.toml. */
export const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

interface TokenBody {
  access_token: string;
  refresh_token: string;
}

function claimsOf(accessToken: string): { sub: string; session_id: string } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()) as {
    sub: string;
    session_id: string;
  };
}

function memberFrom(email: string, body: TokenBody): TestMember {
  const claims = claimsOf(body.access_token);
  return {
    id: claims.sub,
    email,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    sessionId: claims.session_id,
  };
}

/** One more password session of an existing member, straight from Supabase Auth. */
export async function passwordSession(
  email: string,
  password = TEST_PASSWORD,
): Promise<TestMember> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password, gotrue_meta_security: { captcha_token: CAPTCHA } }),
  });
  if (res.status !== 200) throw new Error(`password sign-in failed with ${String(res.status)}`);
  return memberFrom(email, (await res.json()) as TokenBody);
}

/**
 * A limited session (DEC73): an account made through generate_link, whose confirmation link is
 * consumed here. Supabase opens a session with amr otp only, as a recovery link does.
 */
export async function limitedSession(): Promise<TestMember> {
  const stack = inject("stack");
  const email = testEmail("limited");
  const link = await generateSignupLink(email);
  const res = await fetch(`${stack.apiUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ type: "signup", token_hash: link.hashedToken }),
  });
  if (res.status !== 200) throw new Error(`verify failed with ${String(res.status)}`);
  return memberFrom(email, (await res.json()) as TokenBody);
}

/** The verified identity of a member's session, as the server sees it. */
export async function identityFrom(cookies: readonly RequestCookie[]): Promise<Identity> {
  const client = createSessionClient(stackConfig(), cookies);
  const identity = await verifyIdentity(
    client,
    expectedIssuer(stackConfig().NEXT_PUBLIC_SUPABASE_URL),
    "trace",
  );
  if (identity === null) throw new Error("expected a verified session");
  return identity;
}

export async function memberIdentity(member: TestMember): Promise<{
  cookies: RequestCookie[];
  identity: Identity;
}> {
  const cookies = await sessionCookies(member);
  return { cookies, identity: await identityFrom(cookies) };
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  return (
    (await scalar<string>(dbPool(), "select count(*)::text from auth.sessions where id = $1", [
      sessionId,
    ])) === "1"
  );
}

export async function sessionCount(userId: string): Promise<number> {
  return Number(
    await scalar<string>(dbPool(), "select count(*)::text from auth.sessions where user_id = $1", [
      userId,
    ]),
  );
}

/** Session cookies from Set-Cookie lines, as the browser keeps them (removals left out). */
export function cookiePairs(setCookies: readonly string[]): RequestCookie[] {
  return setCookies
    .map((line) => line.split(";")[0] ?? "")
    .map((pair) => {
      const at = pair.indexOf("=");
      return { name: pair.slice(0, at), value: pair.slice(at + 1) };
    })
    .filter(({ name, value }) => name.startsWith("sb-") && value !== "");
}

/** Whether a refresh token still works at Supabase Auth. */
export async function refreshWorks(refreshToken: string): Promise<boolean> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return res.status === 200;
}
