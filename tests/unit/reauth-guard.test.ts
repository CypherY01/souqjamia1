// Task 3.6 (plan/task-3.6.md, design item 1): the member_reauth window without the database.
// DEC38: a sensitive change needs a password entry in amr within the last 5 minutes.
import { describe, expect, it } from "vitest";
import {
  openReauthWindow,
  REAUTH_SECONDS,
  reauthDenial,
  reauthenticatedUntil,
} from "../../apps/web/lib/auth/guards.ts";
import { checkClaims, type AmrEntry, type Identity } from "../../apps/web/lib/auth/identity.ts";

const ISSUER = "http://127.0.0.1:54321/auth/v1";
const SIGNED_IN = 1_800_000_000;

function identity(amr: AmrEntry[]): Identity {
  const checked = checkClaims(
    {
      iss: ISSUER,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: false,
      sub: "00000000-0000-4000-8000-000000000001",
      session_id: "00000000-0000-4000-8000-000000000002",
      aal: "aal1",
      amr,
    },
    ISSUER,
  );
  if (!checked.ok) throw new Error(checked.reason);
  return checked.identity;
}

describe("member_reauth (DEC38): the 5-minute window", () => {
  it("is 5 minutes", () => {
    expect(REAUTH_SECONDS).toBe(300);
  });

  it("opens at the newest password entry and closes 5 minutes after it", () => {
    const session = identity([{ method: "password", timestamp: SIGNED_IN }]);
    expect(reauthenticatedUntil(session)).toBe(SIGNED_IN + 300);
    expect(reauthDenial(session, SIGNED_IN + 300)).toBeNull();
    expect(reauthDenial(session, SIGNED_IN + 301)).toBe("REAUTH_REQUIRED");
    expect(openReauthWindow(session, SIGNED_IN + 10)).toEqual(new Date((SIGNED_IN + 300) * 1000));
    expect(openReauthWindow(session, SIGNED_IN + 301)).toBeNull();
  });

  it("takes the newest password entry and ignores other methods", () => {
    const session = identity([
      { method: "totp", timestamp: SIGNED_IN + 900 },
      { method: "password", timestamp: SIGNED_IN },
      { method: "password", timestamp: SIGNED_IN + 600 },
    ]);
    expect(reauthenticatedUntil(session)).toBe(SIGNED_IN + 900);
    expect(reauthDenial(session, SIGNED_IN + 900)).toBeNull();
  });

  it("a session without a password entry (a recovery link, DEC73) is never reauthenticated", () => {
    const session = identity([{ method: "otp", timestamp: SIGNED_IN }]);
    expect(reauthenticatedUntil(session)).toBeNull();
    expect(reauthDenial(session, SIGNED_IN)).toBe("REAUTH_REQUIRED");
    expect(openReauthWindow(session, SIGNED_IN)).toBeNull();
  });
});
