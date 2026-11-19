// Task 3.1 (plan/task-3.1.md, items 3 to 8): the server's identity, refresh and guards, with the
// real server code against the local stack and real sessions from Supabase Auth.
// FR04, BR01, FR78, DEC38, DEC63, DEC73; basis of TC25 and TC67.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  limitedSessionDenial,
  requireMember,
  requireSession,
  type GuardContext,
} from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import { SESSION_MAX_AGE_SECONDS } from "../../apps/web/lib/supabase/server.ts";
import { authenticateCookies } from "../../apps/web/lib/supabase/session.ts";
import { closeDb, dbPool } from "./_harness/db.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";
import {
  acknowledgeCurrentPolicies,
  changeMember,
  readSession,
  rewriteSession,
  sessionCookies,
  signOutSession,
  stackConfig,
  webDb,
} from "./_harness/web.ts";

const db = webDb();
const trace = (): string => randomBytes(16).toString("hex");

beforeAll(async () => {
  // An entry point running app.assert_active_member(), to compare it with the server guard
  // (item 6). Committed, because the server code runs on its own connections; dropped below.
  await dbPool().query("drop function if exists app.probe_web_guard()");
  await dbPool().query(`create function app.probe_web_guard() returns uuid
    language sql security definer set search_path = ''
    as 'select app.assert_active_member()'`);
  await dbPool().query("grant execute on function app.probe_web_guard() to souq_web");
});

afterAll(async () => {
  await dbPool().query("drop function if exists app.probe_web_guard()");
  await db.end();
  await closeDb();
});

async function authenticate(cookies: Awaited<ReturnType<typeof sessionCookies>>) {
  return authenticateCookies(stackConfig(), cookies, trace());
}

async function identityOf(member: TestMember): Promise<Identity> {
  const { identity } = await authenticate(await sessionCookies(member));
  if (identity === null) throw new Error("expected a verified identity");
  return identity;
}

function ctx(identity: Identity | null): GuardContext {
  return { traceId: trace(), identity: () => Promise.resolve(identity) };
}

/** "ok", or the contract code the call was refused with. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
}

/** app.assert_active_member() for these claims, through souq_web as a write would run it. */
function databaseGuard(identity: Identity): Promise<string> {
  return outcome(() =>
    db.withActor(identity.claims, trace(), (tx) => tx.query("select app.probe_web_guard()")),
  );
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** The same token with another subject, keeping the original signature. */
function tamperedToken(token: string): string {
  const [header = "", payload = "", signature = ""] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
    string,
    unknown
  >;
  return [header, base64url({ ...claims, sub: randomUUID() }), signature].join(".");
}

/** The same claims signed with a key the project does not know (generated at run time). */
function foreignToken(token: string): string {
  const [, payload = ""] = token.split(".");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const head = `${base64url({ alg: "ES256", typ: "JWT", kid: randomUUID() })}.${payload}`;
  const sig = sign("sha256", Buffer.from(head), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${head}.${sig.toString("base64url")}`;
}

const past = () => Math.floor(Date.now() / 1000) - 60;

describe("item 3: the identity comes from a verified session only", () => {
  it("a real session is an ordinary identity, and nothing is rewritten", async () => {
    const member = await signUpMember();
    const auth = await authenticate(await sessionCookies(member));
    expect(auth.identity).toMatchObject({
      userId: member.id,
      sessionId: member.sessionId,
      aal: "aal1",
      limited: false,
    });
    expect(auth.identity?.claims.sub).toBe(member.id);
    expect(auth.setCookies).toEqual([]);
  });

  it("no session cookie: a guest, without asking Supabase", async () => {
    const auth = await authenticate([{ name: "__Host-souq-guest", value: "x".repeat(43) }]);
    expect(auth).toEqual({ identity: null, setCookies: [], updates: new Map() });
  });

  it("a changed payload or a token signed with an unknown key is a guest", async () => {
    const member = await signUpMember();
    const cookies = await sessionCookies(member);
    for (const forge of [tamperedToken, foreignToken]) {
      const forged = rewriteSession(cookies, (s) => ({
        ...s,
        access_token: forge(String(s.access_token)),
      }));
      expect((await authenticate(forged)).identity, forge.name).toBeNull();
    }
  });

  it("an expired token with an unusable refresh token is a guest, and the cookies are removed", async () => {
    const member = await signUpMember();
    const expired = rewriteSession(await sessionCookies(member), (s) => ({
      ...s,
      expires_at: past(),
      refresh_token: "not-a-refresh-token",
    }));
    const auth = await authenticate(expired);
    expect(auth.identity).toBeNull();
    expect(auth.setCookies.length).toBeGreaterThan(0);
    expect(auth.setCookies.every((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});

describe("item 4: refreshing an expired access token", () => {
  it("refreshes in place: same session, new cookies with our attributes (item 2)", async () => {
    const member = await signUpMember();
    const cookies = await sessionCookies(member);
    const before = readSession(cookies);
    const auth = await authenticate(rewriteSession(cookies, (s) => ({ ...s, expires_at: past() })));
    expect(auth.identity).toMatchObject({ userId: member.id, sessionId: member.sessionId });
    expect(auth.setCookies.length).toBeGreaterThan(0);
    for (const cookie of auth.setCookies) {
      expect(cookie).toMatch(/^sb-[A-Za-z0-9_-]+-auth-token(\.\d+)?=/);
      expect(cookie).toContain("; Path=/");
      expect(cookie).toContain("; HttpOnly");
      expect(cookie).toContain("; Secure");
      expect(cookie).toContain("; SameSite=Lax");
      expect(cookie).not.toMatch(/Domain=/i);
    }
    expect(
      auth.setCookies.some((c) => c.includes(`Max-Age=${String(SESSION_MAX_AGE_SECONDS)}`)),
    ).toBe(true);
    const written = [...auth.updates].flatMap(([name, value]) =>
      value === null ? [] : [{ name, value }],
    );
    const after = readSession(written);
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
  });

  it("a session signed out elsewhere cannot refresh: a guest, and the cookies are removed", async () => {
    const member = await signUpMember();
    const cookies = await sessionCookies(member);
    await signOutSession(member.accessToken);
    const auth = await authenticate(rewriteSession(cookies, (s) => ({ ...s, expires_at: past() })));
    expect(auth.identity).toBeNull();
    expect(auth.setCookies.some((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});

interface StateCase {
  name: string;
  acknowledge: boolean;
  change?: string;
  session: string;
  member: string;
}

// Item 8: the six states of the plan (guest separately below), plus the edges of two of them.
const states: StateCase[] = [
  { name: "active", acknowledge: true, session: "ok", member: "ok" },
  {
    name: "active without the current terms (DEC36)",
    acknowledge: false,
    session: "ok",
    member: "TERMS_NOT_ACKNOWLEDGED",
  },
  {
    name: "unconfirmed",
    acknowledge: true,
    change: "update auth.users set email_confirmed_at = null where id = $1",
    session: "ok",
    member: "EMAIL_NOT_CONFIRMED",
  },
  {
    name: "suspended",
    acknowledge: true,
    change:
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
    session: "ok",
    member: "ACCOUNT_RESTRICTED",
  },
  {
    name: "suspended until a time already past",
    acknowledge: true,
    change:
      "update public.account_control set status = 'suspended', suspended_until = now() - interval '1 minute' where user_id = $1",
    session: "ok",
    member: "ok",
  },
  {
    name: "banned",
    acknowledge: true,
    change: "update public.account_control set status = 'banned' where user_id = $1",
    session: "ok",
    member: "ACCOUNT_RESTRICTED",
  },
  {
    name: "awaiting deletion",
    acknowledge: true,
    change: "update public.account_control set deletion_requested_at = now() where user_id = $1",
    session: "ok",
    member: "DELETION_PENDING",
  },
];

describe("item 8: the permission matrix (basis of TC25)", () => {
  it("a guest: UNAUTHENTICATED at both levels", async () => {
    expect(await outcome(() => requireSession(ctx(null), { db }))).toBe("UNAUTHENTICATED");
    expect(await outcome(() => requireMember(ctx(null), { db }))).toBe("UNAUTHENTICATED");
  });

  it.each(states)("$name: session $session, member $member", async (state) => {
    const member = await signUpMember();
    if (state.acknowledge) await acknowledgeCurrentPolicies(member.id);
    if (state.change !== undefined) await changeMember(member.id, state.change);
    const identity = await identityOf(member);

    expect(await outcome(() => requireSession(ctx(identity), { db }))).toBe(state.session);
    expect(await outcome(() => requireMember(ctx(identity), { db }))).toBe(state.member);
    // Item 6: the database guard of every write gives the same answer as the member level.
    const expected = state.member === "ok" ? "ok" : state.member;
    expect(await databaseGuard(identity)).toBe(expected);
  });

  it("the session state carries what the pages need", async () => {
    const member = await signUpMember("عضو تجريبي للحالة");
    await acknowledgeCurrentPolicies(member.id);
    await changeMember(
      member.id,
      "update public.account_control set status = 'suspended', suspended_until = '2030-01-02T03:04:05Z' where user_id = $1",
    );
    const { state } = await requireSession(ctx(await identityOf(member)), { db });
    expect(state).toEqual({
      userId: member.id,
      displayName: "عضو تجريبي للحالة",
      accountStatus: "suspended",
      suspendedUntil: new Date("2030-01-02T03:04:05Z"),
      deletionRequestedAt: null,
      restricted: true,
      emailConfirmed: true,
      termsAcknowledged: true,
      roles: [],
    });
  });
});

describe("item 7, DEC73: a session without the password method is limited", () => {
  it("RECOVERY_SESSION_ONLY in the server guards and in the database, then over after 5 minutes", async () => {
    const member = await signUpMember();
    await acknowledgeCurrentPolicies(member.id);
    const ordinary = await identityOf(member);
    const otpAt = Math.floor(Date.now() / 1000);
    // A recovery link signs in with amr = otp only (checked on local Supabase, task 3.1).
    const amr = [{ method: "otp", timestamp: otpAt }];
    const limited: Identity = {
      ...ordinary,
      amr,
      limited: true,
      claims: { ...ordinary.claims, amr },
    };

    expect(await outcome(() => requireSession(ctx(limited), { db, nowSeconds: otpAt + 60 }))).toBe(
      "RECOVERY_SESSION_ONLY",
    );
    expect(await outcome(() => requireMember(ctx(limited), { db, nowSeconds: otpAt + 60 }))).toBe(
      "RECOVERY_SESSION_ONLY",
    );
    expect(await databaseGuard(limited)).toBe("RECOVERY_SESSION_ONLY");
    expect(limitedSessionDenial(limited, otpAt + 300)).toBe("RECOVERY_SESSION_ONLY");
    expect(await outcome(() => requireSession(ctx(limited), { db, nowSeconds: otpAt + 301 }))).toBe(
      "UNAUTHENTICATED",
    );
    expect(await databaseGuard(ordinary)).toBe("ok");
  });
});

describe("FR04: the live session, and the basis of TC67", () => {
  it("after sign-out the same token, still validly signed, is refused", async () => {
    const member = await signUpMember();
    await acknowledgeCurrentPolicies(member.id);
    const cookies = await sessionCookies(member);
    const identity = await identityOf(member);
    expect(await outcome(() => requireMember(ctx(identity), { db }))).toBe("ok");

    await signOutSession(member.accessToken);
    // The signature and expiry still verify: only the database knows the session ended.
    const again = (await authenticate(cookies)).identity;
    expect(again?.sessionId).toBe(member.sessionId);
    expect(await outcome(() => requireSession(ctx(again), { db }))).toBe("UNAUTHENTICATED");
    expect(await databaseGuard(identity)).toBe("UNAUTHENTICATED");
  });

  it("a suspension during a live session is refused on the next request", async () => {
    const member = await signUpMember();
    await acknowledgeCurrentPolicies(member.id);
    const identity = await identityOf(member);
    expect(await outcome(() => requireMember(ctx(identity), { db }))).toBe("ok");

    await changeMember(
      member.id,
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '7 days' where user_id = $1",
    );
    expect(await outcome(() => requireMember(ctx(identity), { db }))).toBe("ACCOUNT_RESTRICTED");
    expect(await databaseGuard(identity)).toBe("ACCOUNT_RESTRICTED");
    expect(await outcome(() => requireSession(ctx(identity), { db }))).toBe("ok");
  });
});
