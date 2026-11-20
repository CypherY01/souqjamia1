// Task 3.2 (plan/task-3.2.md, items 2, 3 and 6, DEC74): API001 with the real server code against
// the local stack. TC01 after DEC64, TC25 with confirmation off, the profile trigger (UC01),
// RL02 per guest and per address, Turnstile, and a live member who tries to sign up again.
// Confirmation on is tested through our setting only: Supabase keeps confirmation off locally.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireMember, type GuardContext } from "../../apps/web/lib/auth/guards.ts";
import { signup } from "../../apps/web/lib/auth/signup.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import { fingerprint } from "../../apps/web/lib/http/rate-limit.ts";
import { SESSION_MAX_AGE_SECONDS } from "../../apps/web/lib/supabase/server.ts";
import { authenticateCookies } from "../../apps/web/lib/supabase/session.ts";
import {
  flowContext,
  flowEnv,
  guestId,
  jsonRequest,
  outcome,
  signupBody,
} from "./_harness/auth-flow.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import {
  cookiePairs,
  identityFrom,
  memberIdentity,
  recoverySession,
  sessionExists,
} from "./_harness/sessions.ts";
import { authSignup, signUpMember, testEmail } from "./_harness/users.ts";
import { sessionCookies, stackConfig, webDb } from "./_harness/web.ts";

const db = webDb();
const off = flowEnv();

beforeAll(async () => {
  // The database guard of every write (item 6 of task 3.1), compared with the server guard.
  await dbPool().query("drop function if exists app.probe_signup_guard()");
  await dbPool().query(`create function app.probe_signup_guard() returns uuid
    language sql security definer set search_path = ''
    as 'select app.assert_active_member()'`);
  await dbPool().query("grant execute on function app.probe_signup_guard() to souq_web");
});

afterAll(async () => {
  await dbPool().query("drop function if exists app.probe_signup_guard()");
  await db.end();
  await closeDb();
});

function post(body: unknown, env = off, guest = guestId(), forwardedFor?: string) {
  return outcome(() =>
    signup(jsonRequest("/api/auth/signup", body, { guest, forwardedFor }), flowContext(env, db)),
  );
}

async function usersWith(email: string): Promise<string> {
  return scalar<string>(dbPool(), "select count(*)::text from auth.users where email = lower($1)", [
    email,
  ]);
}

function cookiePairs(setCookies: string[]): { name: string; value: string }[] {
  return setCookies
    .map((line) => line.split(";")[0] ?? "")
    .map((pair) => {
      const at = pair.indexOf("=");
      return { name: pair.slice(0, at), value: pair.slice(at + 1) };
    })
    .filter(({ name, value }) => name.startsWith("sb-") && value !== "");
}

describe("TC01 after DEC64: field errors, in both modes", () => {
  it.each([false, true])(
    "confirmation %s: every broken field at once, nothing created",
    async (on) => {
      const body = await signupBody({
        name: " س ",
        email: "not-an-email",
        password: "short",
        college_id: randomUUID(),
        terms_version: "old-terms",
        privacy_version: "old-privacy",
        accept_terms: false,
        acknowledge_privacy: false,
      });
      const result = await post(body, flowEnv({ EMAIL_CONFIRMATION_REQUIRED: on }));
      expect(result.status).toBe(422);
      expect(result.code).toBe("VALIDATION_FAILED");
      expect(result.fieldErrors).toEqual([
        { field: "name", code: "too_small" },
        { field: "email", code: "invalid_format" },
        { field: "password", code: "too_short" },
        { field: "accept_terms", code: "required" },
        { field: "acknowledge_privacy", code: "required" },
        { field: "terms_version", code: "not_current" },
        { field: "privacy_version", code: "not_current" },
        { field: "college_id", code: "unknown" },
      ]);
      expect(result.setCookies).toEqual([]);
    },
  );

  it("missing fields are each required; an unknown field is a 400", async () => {
    const missing = await post({ email: "a@example.test" });
    expect(missing.status).toBe(422);
    expect(missing.fieldErrors?.map((error) => error.field).sort()).toEqual([
      "accept_terms",
      "acknowledge_privacy",
      "captcha_token",
      "name",
      "password",
      "privacy_version",
      "terms_version",
    ]);
    const unknown = await post(await signupBody({ role: "owner" }));
    expect(unknown.status).toBe(400);
    expect(unknown.fieldErrors).toEqual([{ field: "role", code: "unknown_field" }]);
  });

  it("DEC32 on the server: 72 bytes before 64 characters is refused, uncut", async () => {
    const result = await post(await signupBody({ password: "ك".repeat(37) }));
    expect(result.fieldErrors).toEqual([{ field: "password", code: "too_many_bytes" }]);
  });
});

describe("TC25 with confirmation off (DEC63)", () => {
  it("signs in at once: session cookies with the attributes of task 3.1, and a new guest binding", async () => {
    const guest = guestId();
    const body = await signupBody();
    const result = await post(body, off, guest);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { state: "signed_in", next: "/" } });

    const session = result.setCookies.filter((line) => line.startsWith("sb-"));
    expect(session.length).toBeGreaterThan(0);
    for (const line of session) {
      expect(line).toContain("HttpOnly");
      expect(line).toContain("Secure");
      expect(line).toContain("SameSite=Lax");
      expect(line).toContain(`Max-Age=${String(SESSION_MAX_AGE_SECONDS)}`);
    }
    // No PKCE code verifier reaches the browser: only the session itself.
    expect(result.setCookies.some((line) => line.includes("code-verifier"))).toBe(false);
    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);

    // The member writes to the market right away: the server guard and the database guard.
    const { identity } = await authenticateCookies(
      stackConfig(),
      cookiePairs(result.setCookies),
      "trace",
    );
    if (identity === null) throw new Error("expected a session");
    const ctx: GuardContext = { traceId: "trace", identity: () => Promise.resolve(identity) };
    const auth = await requireMember(ctx, { db });
    expect(auth.state.displayName).toBe("عضو تجريبي");
    await expect(
      db.withActor(identity.claims, "trace", (tx) => tx.query("select app.probe_signup_guard()")),
    ).resolves.toBeDefined();
  });

  it("item 2: the acknowledgments and the college are written with the account", async () => {
    const college = await scalar<string>(
      dbPool(),
      "select id::text from public.college where is_active order by display_order limit 1",
    );
    const body = await signupBody({ college_id: college });
    expect((await post(body)).status).toBe(200);
    const row = await dbPool().query<{ college: string; acks: string }>(
      `select p.college_id::text as college,
              (select string_agg(a.policy_type || ':' || a.policy_version, ',' order by a.policy_type)
                 from public.policy_acknowledgment a where a.user_id = p.id) as acks
         from auth.users u join public.profile p on p.id = u.id where u.email = lower($1)`,
      [body.email],
    );
    expect(row.rows[0]?.college).toBe(college);
    expect(row.rows[0]?.acks).toBe(
      `terms:${String(body.terms_version)},privacy:${String(body.privacy_version)}`,
    );
  });

  it("DEC64: a used address in any case is 422 email_registered, with no account and no session", async () => {
    const body = await signupBody();
    expect((await post(body)).status).toBe(200);
    const again = await post({ ...body, email: String(body.email).toUpperCase() });
    expect(again.status).toBe(422);
    expect(again.fieldErrors).toEqual([{ field: "email", code: "email_registered" }]);
    expect(again.setCookies).toEqual([]);
    expect(await usersWith(String(body.email))).toBe("1");
  });
});

describe("confirmation on (our setting, TC01)", () => {
  const on = flowEnv({ EMAIL_CONFIRMATION_REQUIRED: true });

  it("a new and a used address get the same 202, and no cookie", async () => {
    const used = await signupBody();
    expect((await post(used)).status).toBe(200);
    const fresh = await post(await signupBody(), on);
    const again = await post({ ...used }, on);
    for (const result of [fresh, again]) {
      expect(result.status).toBe(202);
      expect(result.body).toEqual({ data: { status: "accepted" } });
      expect(result.setCookies).toEqual([]);
    }
  });

  it("a session Supabase opens anyway is ended at once (its setting differs locally)", async () => {
    const body = await signupBody();
    expect((await post(body, on)).status).toBe(202);
    const sessions = await scalar<string>(
      dbPool(),
      `select count(*)::text from auth.sessions s join auth.users u on u.id = s.user_id
        where u.email = lower($1)`,
      [body.email],
    );
    expect(sessions).toBe("0");
  });

  it("RL03 counts the signup: a resend for the address in the same minute would wait", async () => {
    const body = await signupBody();
    expect((await post(body, on)).status).toBe(202);
    const counted = await scalar<string>(
      dbPool(),
      "select coalesce(sum(count), 0)::text from app.rate_limit_bucket where scope = 'RL03:email:minute' and key_hash = $1",
      [fingerprint(on.APP_SECRET, "email", String(body.email))],
    );
    expect(counted).toBe("1");
  });
});

describe("DEC36, DEC52: Turnstile", () => {
  it("no token: 403 CAPTCHA_FAILED and no account", async () => {
    const body = await signupBody({ captcha_token: "" });
    const result = await post(body);
    expect(result.status).toBe(403);
    expect(result.code).toBe("CAPTCHA_FAILED");
    expect(await usersWith(String(body.email))).toBe("0");
  });
});

describe("DEC74: RL02 counted before the call (DEC70)", () => {
  it("the sixth attempt in an hour from one guest is 429, failed attempts included", async () => {
    const guest = guestId();
    // Turnstile refuses these, after our counter took each attempt.
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await post(await signupBody({ captcha_token: "" }), off, guest)).status).toBe(403);
    }
    const sixth = await post(await signupBody(), off, guest);
    expect(sixth.status).toBe(429);
    expect(sixth.code).toBe("RATE_LIMITED");
    expect(sixth.retryAfter).toBeGreaterThan(0);
    // Another guest is not affected.
    expect((await post(await signupBody({ captcha_token: "" }), off)).status).toBe(403);
  });

  it("field errors do not count: they never reach Supabase", async () => {
    const guest = guestId();
    for (let attempt = 0; attempt < 6; attempt++) {
      expect((await post(await signupBody({ password: "short" }), off, guest)).status).toBe(422);
    }
    expect((await post(await signupBody({ captcha_token: "" }), off, guest)).status).toBe(403);
  });

  it("per address behind a trusted proxy, with the limit from SIGNUP_IP_LIMIT_PER_HOUR", async () => {
    const env = flowEnv({ TRUSTED_PROXY_HOPS: 1, SIGNUP_IP_LIMIT_PER_HOUR: 2 });
    const address = `198.51.100.${String(Math.floor(Math.random() * 250) + 1)}`;
    const attempt = async () =>
      post(await signupBody({ captcha_token: "" }), env, guestId(), `203.0.113.9, ${address}`);
    expect((await attempt()).status).toBe(403);
    expect((await attempt()).status).toBe(403);
    const third = await attempt();
    expect(third.status).toBe(429);
    // Another address, as the next proxy hop sees it, is not limited.
    const other = await post(
      await signupBody({ captcha_token: "" }),
      env,
      guestId(),
      `${address}, 192.0.2.77`,
    );
    expect(other.status).toBe(403);
  });
});

describe("item 3: who may sign up", () => {
  it("a live member session is refused with 403 FORBIDDEN", async () => {
    const member = await signUpMember();
    const { identity } = await authenticateCookies(
      stackConfig(),
      await sessionCookies(member),
      "trace",
    );
    const result = await outcome(() =>
      signup(
        jsonRequest("/api/auth/signup", {}, { guest: guestId() }),
        flowContext(off, db, identity),
      ),
    );
    expect(result.status).toBe(403);
    expect(result.code).toBe("FORBIDDEN");
  });

  it("task 3.4 (fix from 3.2): a recovery session is ended first, and the signup goes on", async () => {
    const owner = await signUpMember();
    const limited = await recoverySession(owner.email);
    const { cookies, identity } = await memberIdentity(limited);
    expect(identity.limited).toBe(true);
    const body = await signupBody();
    const result = await outcome(() =>
      signup(
        jsonRequest("/api/auth/signup", body, { guest: guestId(), cookies }),
        flowContext(off, db, identity),
      ),
    );
    expect(result.status).toBe(200);
    expect(await sessionExists(limited.sessionId)).toBe(false);
    const next = await identityFrom(cookiePairs(result.setCookies));
    expect(next.limited).toBe(false);
    expect(next.userId).not.toBe(owner.id);
  });

  it("a request without the guest binding is refused (the proxy checked CSRF against it)", async () => {
    const body = await signupBody();
    const noGuest = await outcome(() =>
      signup(jsonRequest("/api/auth/signup", body), flowContext(off, db)),
    );
    expect(noGuest.code).toBe("CSRF_FAILED");
    expect(await usersWith(String(body.email))).toBe("0");
  });
});

describe("item 2: Supabase Auth called directly still needs the versions in force (UC01)", () => {
  it.each([
    ["no versions", { terms_version: null, privacy_version: null }],
    ["an old terms version", { terms_version: "old-terms" }],
    ["an unknown college", { college_id: randomUUID() }],
    ["a college that is not a uuid", { college_id: "college-1" }],
  ])("%s: refused as a whole, no login identity left", async (_name, data) => {
    const email = testEmail("direct");
    const res = await authSignup(email, "عضو تجريبي", data);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("Failing row");
    expect(await usersWith(email)).toBe("0");
  });

  it("an inactive college is refused too", async () => {
    const client = await dbPool().connect();
    try {
      const id = await scalar<string>(
        client,
        `insert into public.college (key, label_ar, display_order, is_active, source_ref)
         values ($1, $2, 99, false, 'fixture') returning id::text`,
        [
          `it_inactive_${randomUUID().slice(0, 8)}`,
          `كلية معطلة تجريبية ${randomUUID().slice(0, 8)}`,
        ],
      );
      const email = testEmail("direct");
      expect((await authSignup(email, "عضو تجريبي", { college_id: id })).status).toBe(500);
      expect(await usersWith(email)).toBe("0");
      await client.query("delete from public.college where id = $1", [id]);
    } finally {
      client.release();
    }
  });
});
