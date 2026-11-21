// Task 3.5 (plan/task-3.5.md): the account (API015, app.me()) and the profile edit (API016,
// app.update_profile()) with the real server code against the local stack and real sessions.
// FR49, UC20, DEC58, DEC73, DEC77, DEC78, TC21, TC65.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadAccount } from "../../apps/web/lib/account/me.ts";
import { updateProfile } from "../../apps/web/lib/account/profile.ts";
import { requireIdentity } from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import { outcome, type Outcome } from "./_harness/auth-flow.ts";
import { setClock } from "./_harness/clock.ts";
import { closeDb, dbError, dbPool, rolledBack } from "./_harness/db.ts";
import { limitedSession, memberIdentity } from "./_harness/sessions.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";
import { changeMember, signOutSession, webDb, withdrawAcknowledgments } from "./_harness/web.ts";

const db = webDb();
const trace = (): string => randomBytes(16).toString("hex");

afterAll(async () => {
  await db.end();
  await closeDb();
});

interface Member {
  member: TestMember;
  identity: Identity;
}

async function newMember(name = "عضو الحساب التجريبي"): Promise<Member> {
  const member = await signUpMember(name);
  return { member, identity: (await memberIdentity(member)).identity };
}

async function errorCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/profile/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** API016 as the route runs it, with the member's verified identity. */
function patch(identity: Identity | null, body: unknown): Promise<Outcome> {
  return outcome(async () => {
    const { me } = await updateProfile(patchRequest(body), {
      db,
      traceId: trace(),
      identity: () => Promise.resolve(identity),
    });
    return Response.json({ data: me });
  });
}

interface ProfileRow {
  display_name: string;
  college_id: string | null;
  version: number;
}

async function profileOf(id: string): Promise<ProfileRow> {
  const result = await dbPool().query<ProfileRow>(
    "select display_name, college_id, version from public.profile where id = $1",
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("no profile");
  return row;
}

async function audits(id: string): Promise<{ action: string; metadata_minimal: unknown }[]> {
  const result = await dbPool().query<{ action: string; metadata_minimal: unknown }>(
    `select action, metadata_minimal from app.audit_event
      where target_id = $1 and action = 'profile.update' order by occurred_at`,
    [id],
  );
  return result.rows;
}

async function colleges(): Promise<{ active: string; other: string }> {
  const result = await dbPool().query<{ id: string }>(
    "select id from public.college where is_active order by display_order, id limit 2",
  );
  const [active, other] = result.rows;
  if (active === undefined || other === undefined) throw new Error("two active colleges needed");
  return { active: active.id, other: other.id };
}

describe("API015 and app.me(): the private account fields (DEC58, DEC77)", () => {
  it("a member reads its own account, with the capabilities of the member guard", async () => {
    const { member, identity } = await newMember("صاحب الحساب");
    const { me, joinedAt, state } = await loadAccount(db, identity, trace());
    expect(me).toEqual({
      id: member.id,
      email: member.email,
      email_confirmed: true,
      pending_email: null,
      display_name: "صاحب الحساب",
      college: null,
      avatar: null,
      locale: "ar",
      account_status: "active",
      suspended_until: null,
      deletion_requested_at: null,
      roles: [],
      mfa_enrolled: false,
      terms_acknowledged: true,
      student_badge: { status: null, badge_expires_at: null },
      preferences: {
        email_groups: {
          offers: false,
          meetups: false,
          deals: false,
          reviews: false,
          reports: false,
        },
        version: 1,
      },
      capabilities: { market_write: true, admin: false },
      version: 1,
    });
    expect(joinedAt).toBeInstanceOf(Date);
    expect(state.userId).toBe(member.id);
  });

  it.each([
    {
      name: "an unconfirmed email",
      sql: "update auth.users set email_confirmed_at = null where id = $1",
      shows: { email_confirmed: false },
    },
    {
      name: "a suspension",
      sql: "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
      shows: { account_status: "suspended", suspended_until: expect.any(String) as string },
    },
    {
      name: "a ban",
      sql: "update public.account_control set status = 'banned' where user_id = $1",
      shows: { account_status: "banned" },
    },
    {
      name: "a deletion request",
      sql: "update public.account_control set deletion_requested_at = now() where user_id = $1",
      shows: { deletion_requested_at: expect.any(String) as string },
    },
  ])("DEC58: $name still reads its account, with every capability false", async (state) => {
    const { member, identity } = await newMember();
    await changeMember(member.id, state.sql);
    const { me } = await loadAccount(db, identity, trace());
    expect(me).toMatchObject(state.shows);
    expect(me.capabilities).toEqual({ market_write: false, admin: false });
  });

  it("DEC58: without the current policy versions it reads its account, market_write false", async () => {
    const { member, identity } = await newMember();
    await withdrawAcknowledgments(member.id);
    const { me } = await loadAccount(db, identity, trace());
    expect(me.terms_acknowledged).toBe(false);
    expect(me.capabilities.market_write).toBe(false);
  });

  it("the college is a CatalogRef, and stays when deactivated later", async () => {
    const { active } = await colleges();
    const { member, identity } = await newMember();
    await changeMember(
      member.id,
      `update public.profile set college_id = '${active}' where id = $1`,
    );
    const { me } = await loadAccount(db, identity, trace());
    expect(me.college).toMatchObject({ id: active });
    expect(Object.keys(me.college ?? {}).sort()).toEqual(["id", "key", "label_ar", "label_en"]);
  });

  it("DEC73: a limited session is refused by the guard and by app.me()", async () => {
    const limited = await limitedSession();
    const { identity } = await memberIdentity(limited);
    expect(identity.limited).toBe(true);
    expect(
      await errorCode(() =>
        requireIdentity({ traceId: trace(), identity: () => Promise.resolve(identity) }),
      ),
    ).toBe("RECOVERY_SESSION_ONLY");
    expect(await errorCode(() => loadAccount(db, identity, trace()))).toBe("RECOVERY_SESSION_ONLY");
  });

  it("FR04: after sign-out the same token reads nothing", async () => {
    const { member, identity } = await newMember();
    await signOutSession(member.accessToken);
    expect(await errorCode(() => loadAccount(db, identity, trace()))).toBe("UNAUTHENTICATED");
  });

  it("DEC77 app.me(): a guest is UNAUTHENTICATED", async () => {
    expect(
      await errorCode(() =>
        db.withActor(null, trace(), (tx) => tx.query("select user_id, email from app.me()")),
      ),
    ).toBe("UNAUTHENTICATED");
    expect(
      await errorCode(() =>
        requireIdentity({ traceId: trace(), identity: () => Promise.resolve(null) }),
      ),
    ).toBe("UNAUTHENTICATED");
  });

  it("DEC77 app.me(): another member's session reads only its own account", async () => {
    const a = await newMember("العضو أ للحساب");
    const b = await newMember("العضو ب للحساب");
    const { me } = await loadAccount(db, b.identity, trace());
    expect(me.id).toBe(b.member.id);
    expect(me.email).toBe(b.member.email);
    // B's session with A's id: the session belongs to B, so nothing of A is read.
    const forged = { ...b.identity, claims: { ...b.identity.claims, sub: a.member.id } };
    expect(await errorCode(() => loadAccount(db, forged, trace()))).toBe("UNAUTHENTICATED");
  });
});

describe("API016 and app.update_profile(): the permitted fields (FR49, TC21, TC65)", () => {
  it("TC21 Edit permitted profile fields, inject a role and sign out", async () => {
    const { active } = await colleges();
    const { member, identity } = await newMember("الاسم القديم");

    const saved = await patch(identity, {
      display_name: "  الاسم الجديد  ",
      college_id: active,
      expected_version: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      data: { display_name: "الاسم الجديد", college: { id: active }, version: 2 },
    });
    expect(await profileOf(member.id)).toEqual({
      display_name: "الاسم الجديد",
      college_id: active,
      version: 2,
    });
    // Item 3: the audit names the changed fields, never their values.
    expect(await audits(member.id)).toEqual([
      { action: "profile.update", metadata_minimal: { fields: ["display_name", "college_id"] } },
    ]);

    const injected = await patch(identity, {
      display_name: "اسم مع دور",
      role: "owner",
      expected_version: 2,
    });
    expect(injected).toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(injected.fieldErrors).toEqual([{ field: "role", code: "unknown_field" }]);
    expect((await profileOf(member.id)).display_name).toBe("الاسم الجديد");

    await signOutSession(member.accessToken);
    expect(await errorCode(() => loadAccount(db, identity, trace()))).toBe("UNAUTHENTICATED");
    expect(
      await patch(identity, { display_name: "بعد الخروج", expected_version: 2 }),
    ).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("TC65 Inject role and badge fields into the profile", async () => {
    const { member, identity } = await newMember("اسم ثابت");
    const injections: Record<string, unknown>[] = [
      { role: "owner" },
      { roles: ["owner", "moderator"] },
      { student_badge: true },
      { rating: { count: 99, average: 5 } },
      { account_status: "active" },
      { id: member.id },
      { user_id: member.id },
      { version: 99 },
      { email: "other@example.test" },
      { hidden_from_public: false },
    ];
    for (const field of injections) {
      const result = await patch(identity, {
        ...field,
        display_name: "اسم محقون",
        expected_version: 1,
      });
      expect(result).toMatchObject({ status: 400, code: "BAD_REQUEST" });
      expect(result.fieldErrors?.[0]).toMatchObject({ code: "unknown_field" });
    }
    expect(await profileOf(member.id)).toEqual({
      display_name: "اسم ثابت",
      college_id: null,
      version: 1,
    });
    const grants = await dbPool().query("select 1 from public.role_grant where user_id = $1", [
      member.id,
    ]);
    expect(grants.rowCount).toBe(0);
    expect(await audits(member.id)).toEqual([]);
  });

  it("TC65: the database refuses the same injections on its own", async () => {
    const { identity } = await newMember();
    const error = await rolledBack(async (client) => {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ]);
      return dbError(client, "select app.update_profile(1, $1::jsonb)", [
        JSON.stringify({ role: "owner" }),
      ]);
    });
    expect(error.code).toBe("SJ001");
    expect(error.message).toBe("BAD_REQUEST");
  });

  it("STATE_CONFLICT: a stale expected_version changes nothing, even with no change", async () => {
    const { member, identity } = await newMember("اسم النسخة");
    expect((await patch(identity, { display_name: "اسم ثانٍ", expected_version: 1 })).status).toBe(
      200,
    );
    expect(await patch(identity, { display_name: "اسم ثالث", expected_version: 1 })).toMatchObject({
      status: 409,
      code: "STATE_CONFLICT",
    });
    expect(await patch(identity, { expected_version: 1 })).toMatchObject({
      status: 409,
      code: "STATE_CONFLICT",
    });
    expect(await profileOf(member.id)).toMatchObject({ display_name: "اسم ثانٍ", version: 2 });
  });

  it("STATE_CONFLICT: two edits of the same version at once, one wins", async () => {
    const { member, identity } = await newMember("اسم السباق");
    const results = await Promise.all([
      patch(identity, { display_name: "الطلب الأول", expected_version: 1 }),
      patch(identity, { display_name: "الطلب الثاني", expected_version: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await profileOf(member.id)).version).toBe(2);
    expect(await audits(member.id)).toHaveLength(1);
  });

  it("item 10: a request that changes nothing returns 200 without a new version or audit", async () => {
    const { member, identity } = await newMember("اسم بلا تغيير");
    const same = await patch(identity, { display_name: "اسم بلا تغيير ", expected_version: 1 });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ data: { version: 1 } });
    expect((await patch(identity, { expected_version: 1, locale: "ar" })).status).toBe(200);
    expect((await profileOf(member.id)).version).toBe(1);
    expect(await audits(member.id)).toEqual([]);
  });

  it("FR01: the name is 2 to 50 code points after NFC and trim, without bidi controls", async () => {
    const { member, identity } = await newMember("اسم الحدود");
    const tooShort = await patch(identity, { display_name: "ع", expected_version: 1 });
    expect(tooShort).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(tooShort.fieldErrors).toEqual([{ field: "display_name", code: "too_small" }]);
    const empty = await patch(identity, { display_name: "   ", expected_version: 1 });
    expect(empty.fieldErrors).toEqual([{ field: "display_name", code: "required" }]);
    const tooLong = await patch(identity, { display_name: "ع".repeat(51), expected_version: 1 });
    expect(tooLong.fieldErrors).toEqual([{ field: "display_name", code: "too_big" }]);
    const rlo = String.fromCodePoint(0x202e);
    const bidi = await patch(identity, { display_name: `اسم${rlo}مقلوب`, expected_version: 1 });
    expect(bidi.fieldErrors).toEqual([{ field: "display_name", code: "invalid_format" }]);

    // 50 code points with emoji (each one code point, two UTF-16 units) is accepted.
    const fifty = `${"ع".repeat(45)}${"😀".repeat(5)}`;
    expect((await patch(identity, { display_name: fifty, expected_version: 1 })).status).toBe(200);
    expect((await profileOf(member.id)).display_name).toBe(fifty);
    // Two code points: the lower bound.
    expect((await patch(identity, { display_name: "عب", expected_version: 2 })).status).toBe(200);
    // NFC: a decomposed letter is stored composed.
    const decomposed = "Cafe" + String.fromCodePoint(0x301) + " عربي";
    expect((await patch(identity, { display_name: decomposed, expected_version: 3 })).status).toBe(
      200,
    );
    expect((await profileOf(member.id)).display_name).toBe(decomposed.normalize("NFC"));
  });

  it("the college: active, or the current one; unknown otherwise; null removes it", async () => {
    const { active, other } = await colleges();
    const { member, identity } = await newMember();
    expect((await patch(identity, { college_id: active, expected_version: 1 })).status).toBe(200);
    await dbPool().query("update public.college set is_active = false where id = $1", [active]);
    try {
      // Item 5: the deactivated current college stays, and a name change keeps it.
      const kept = await patch(identity, {
        display_name: "اسم مع كلية معطلة",
        college_id: active,
        expected_version: 2,
      });
      expect(kept.status).toBe(200);
      expect((await profileOf(member.id)).college_id).toBe(active);

      const second = await newMember();
      const refused = await patch(second.identity, { college_id: active, expected_version: 1 });
      expect(refused).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
      expect(refused.fieldErrors).toEqual([{ field: "college_id", code: "unknown" }]);
    } finally {
      await dbPool().query("update public.college set is_active = true where id = $1", [active]);
    }
    const unknown = await patch(identity, {
      college_id: "00000000-0000-4000-8000-000000000000",
      expected_version: 3,
    });
    expect(unknown.fieldErrors).toEqual([{ field: "college_id", code: "unknown" }]);
    expect((await patch(identity, { college_id: other, expected_version: 3 })).status).toBe(200);
    expect((await patch(identity, { college_id: null, expected_version: 4 })).status).toBe(200);
    expect((await profileOf(member.id)).college_id).toBeNull();
  });

  it("item 2: avatar_id until task 4.7, and the only locale", async () => {
    const { member, identity } = await newMember();
    const avatar = await patch(identity, {
      avatar_id: "00000000-0000-4000-8000-000000000000",
      expected_version: 1,
    });
    expect(avatar).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(avatar.fieldErrors).toEqual([{ field: "avatar_id", code: "unknown" }]);
    expect((await patch(identity, { avatar_id: null, expected_version: 1 })).status).toBe(200);
    const english = await patch(identity, { locale: "en", expected_version: 1 });
    expect(english).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(english.fieldErrors?.[0]?.field).toBe("locale");
    expect((await profileOf(member.id)).version).toBe(1);
  });

  it.each([
    {
      name: "an unconfirmed email",
      sql: "update auth.users set email_confirmed_at = null where id = $1",
      code: "EMAIL_NOT_CONFIRMED",
    },
    {
      name: "a suspension",
      sql: "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
      code: "ACCOUNT_RESTRICTED",
    },
    {
      name: "a deletion request",
      sql: "update public.account_control set deletion_requested_at = now() where user_id = $1",
      code: "DELETION_PENDING",
    },
  ])("BR01: $name may not edit ($code), and nothing changes", async (state) => {
    const { member, identity } = await newMember("اسم مقيد");
    await changeMember(member.id, state.sql);
    expect(await patch(identity, { display_name: "اسم جديد", expected_version: 1 })).toMatchObject({
      status: 403,
      code: state.code,
    });
    expect((await profileOf(member.id)).display_name).toBe("اسم مقيد");
  });

  it("DEC36: without the current policy versions the edit is TERMS_NOT_ACKNOWLEDGED", async () => {
    const { member, identity } = await newMember("اسم بلا إقرار");
    await withdrawAcknowledgments(member.id);
    expect(await patch(identity, { display_name: "اسم جديد", expected_version: 1 })).toMatchObject({
      status: 403,
      code: "TERMS_NOT_ACKNOWLEDGED",
    });
  });

  it("a guest and a limited session may not edit", async () => {
    expect(await patch(null, { display_name: "زائر", expected_version: 1 })).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    const limited = await limitedSession();
    const { identity } = await memberIdentity(limited);
    expect(
      await patch(identity, { display_name: "جلسة محدودة", expected_version: 1 }),
    ).toMatchObject({ status: 403, code: "RECOVERY_SESSION_ONLY" });
  });

  it("a third party: B's edit never touches A's profile (the identity comes from the session)", async () => {
    const a = await newMember("ملف العضو أ");
    const b = await newMember("ملف العضو ب");
    expect(
      (await patch(b.identity, { display_name: "اسم ب الجديد", expected_version: 1 })).status,
    ).toBe(200);
    expect(await profileOf(a.member.id)).toMatchObject({ display_name: "ملف العضو أ", version: 1 });
    expect(await profileOf(b.member.id)).toMatchObject({
      display_name: "اسم ب الجديد",
      version: 2,
    });
  });

  it("DEC78: 10 successful edits per hour; rejected and unchanged requests do not count", async () => {
    const { identity } = await newMember("اسم الحد 0");
    // A fixed time ten minutes into the current hour, so the window cannot roll over mid-test.
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const result = await rolledBack(async (client) => {
      await setClock(client, new Date(hour + 600_000));
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ]);
      const edit = (version: number, patchBody: Record<string, unknown>) =>
        client.query<{ v: number }>("select app.update_profile($1, $2::jsonb) as v", [
          version,
          JSON.stringify(patchBody),
        ]);
      // Neither counts: a stale version (rolled back) and a request that changes nothing.
      expect((await dbError(client, "select app.update_profile(5, '{}'::jsonb)")).message).toBe(
        "STATE_CONFLICT",
      );
      await edit(1, { display_name: "اسم الحد 0" });
      let version = 1;
      for (let i = 1; i <= 10; i += 1) {
        version = (await edit(version, { display_name: `اسم الحد ${String(i)}` })).rows[0]?.v ?? 0;
      }
      const limited = await dbError(client, "select app.update_profile($1, $2::jsonb)", [
        version,
        JSON.stringify({ display_name: "اسم الحد 11" }),
      ]);
      // The next hour: a new window.
      await setClock(client, new Date(hour + 3_600_000 + 60_000));
      const next = (await edit(version, { display_name: "اسم الساعة التالية" })).rows[0]?.v;
      return { version, limited, next };
    });
    expect(result.version).toBe(11);
    expect(result.limited.message).toBe("RATE_LIMITED");
    expect(JSON.parse(result.limited.detail ?? "{}")).toMatchObject({
      retry_after: expect.any(Number) as number,
    });
    expect(result.next).toBe(12);
  });
});
