// Task 3.3 (plan/task-3.3.md, item 2): API003 with the real server code against the local stack.
// FR49, TC56 (the server side: the session is revoked and its cookies removed), DEC73, and
// DEC76: the device is signed out even when Supabase Auth does not answer.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { requireSession, type GuardContext } from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { logout } from "../../apps/web/lib/auth/logout.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import { flowEnv, guestId, jsonRequest, outcome } from "./_harness/auth-flow.ts";
import { closeDb } from "./_harness/db.ts";
import {
  limitedSession,
  memberIdentity,
  passwordSession,
  refreshWorks,
  sessionExists,
} from "./_harness/sessions.ts";
import { signUpMember } from "./_harness/users.ts";
import { signOutSession, webDb } from "./_harness/web.ts";

const db = webDb();

afterAll(async () => {
  await db.end();
  await closeDb();
});

function signOut(
  cookies: readonly RequestCookie[],
  identity: Identity | null,
  env = flowEnv(),
  guest = guestId(),
) {
  return outcome(() =>
    logout(jsonRequest("/api/auth/logout", {}, { guest, cookies }), {
      env,
      traceId: "trace",
      identity: () => Promise.resolve(identity),
    }),
  );
}

/** Every session cookie sent is removed (Max-Age=0), and a new guest cookie is set. */
function expectSignedOutDevice(
  setCookies: readonly string[],
  cookies: readonly RequestCookie[],
  guest: string,
): void {
  for (const { name } of cookies) {
    const line = setCookies.find((entry) => entry.startsWith(`${name}=`));
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`^${name.replace(/[.-]/g, "\\$&")}=;`));
    expect(line).toContain("Max-Age=0");
    expect(line).toContain("HttpOnly");
  }
  const rotated = setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
  expect(rotated).toBeDefined();
  expect(rotated).not.toContain(guest);
}

describe("FR49: sign-out", () => {
  it("204: this session is revoked, its cookies removed, and the guest binding renewed", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const guest = guestId();
    const result = await signOut(cookies, identity, flowEnv(), guest);
    expect(result.status).toBe(204);
    expectSignedOutDevice(result.setCookies, cookies, guest);

    expect(await sessionExists(member.sessionId)).toBe(false);
    // TC56: the access token still has minutes left, but the server refuses its session.
    const ctx: GuardContext = { traceId: "trace", identity: () => Promise.resolve(identity) };
    await expect(requireSession(ctx, { db })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await refreshWorks(member.refreshToken)).toBe(false);
  });

  it("the member's other devices stay signed in (scope local)", async () => {
    const member = await signUpMember();
    const other = await passwordSession(member.email);
    const { cookies, identity } = await memberIdentity(member);
    expect((await signOut(cookies, identity)).status).toBe(204);
    expect(await sessionExists(member.sessionId)).toBe(false);
    expect(await sessionExists(other.sessionId)).toBe(true);
  });

  it("DEC73: a limited session signs out too", async () => {
    const limited = await limitedSession();
    const { cookies, identity } = await memberIdentity(limited);
    expect(identity.limited).toBe(true);
    expect((await signOut(cookies, identity)).status).toBe(204);
    expect(await sessionExists(limited.sessionId)).toBe(false);
  });

  it("a session Supabase no longer has: 204, the cookies removed", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    await signOutSession(member.accessToken);
    const guest = guestId();
    const result = await signOut(cookies, identity, flowEnv(), guest);
    expect(result.status).toBe(204);
    expectSignedOutDevice(result.setCookies, cookies, guest);
  });

  it("no session: 401, and the cookies are removed anyway", async () => {
    const stale = [{ name: "sb-127-auth-token", value: "base64-eyJub3QiOiJ2YWxpZCJ9" }];
    const guest = guestId();
    const result = await signOut(stale, null, flowEnv(), guest);
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: "UNAUTHENTICATED" });
    expectSignedOutDevice(result.setCookies, stale, guest);
  });

  it("DEC76: Supabase Auth does not answer: still 204 and the cookies removed", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    // A closed port: the revocation fails at once, as an outage does.
    const unreachable = flowEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9" });
    const guest = guestId();
    const result = await signOut(cookies, identity, unreachable, guest);
    expect(result.status).toBe(204);
    expectSignedOutDevice(result.setCookies, cookies, guest);
    // The session itself lives on at Supabase until it ends; its refresh token left the browser.
    expect(await sessionExists(member.sessionId)).toBe(true);
    await signOutSession(member.accessToken);
  });
});
