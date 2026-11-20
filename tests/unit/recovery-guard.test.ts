// Task 3.4 (plan/task-3.4.md, item 3): the recovery access level without the database, and where
// server pages send a limited session. DEC38 (5 minutes), DEC73 (no password in amr: limited).
import { describe, expect, it } from "vitest";
import {
  limitedSessionPage,
  memberPageRedirect,
  recoveryDenial,
  type SessionAuth,
  type SessionState,
} from "../../apps/web/lib/auth/guards.ts";
import { checkClaims, type Identity } from "../../apps/web/lib/auth/identity.ts";
import { isAuthLinkPath } from "../../apps/web/lib/http/security-headers.ts";

const ISSUER = "http://127.0.0.1:54321/auth/v1";
const LINK_OPENED = 1_800_000_000;

function identity(method: "otp" | "password"): Identity {
  const checked = checkClaims(
    {
      iss: ISSUER,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: false,
      sub: "00000000-0000-4000-8000-000000000001",
      session_id: "00000000-0000-4000-8000-000000000002",
      aal: "aal1",
      amr: [{ method, timestamp: LINK_OPENED }],
    },
    ISSUER,
  );
  if (!checked.ok) throw new Error(checked.reason);
  return checked.identity;
}

const state: SessionState = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "عضو تجريبي",
  accountStatus: "active",
  suspendedUntil: null,
  deletionRequestedAt: null,
  restricted: false,
  emailConfirmed: true,
  termsAcknowledged: true,
  roles: [],
};

describe("recoveryDenial (x-access: recovery)", () => {
  it("a guest is UNAUTHENTICATED, an ordinary session FORBIDDEN", () => {
    expect(recoveryDenial(null, LINK_OPENED)).toBe("UNAUTHENTICATED");
    expect(recoveryDenial(identity("password"), LINK_OPENED)).toBe("FORBIDDEN");
  });

  it("DEC38: a recovery session passes for 5 minutes after the link, then it is over", () => {
    const limited = identity("otp");
    expect(limited.limited).toBe(true);
    expect(recoveryDenial(limited, LINK_OPENED)).toBeNull();
    expect(recoveryDenial(limited, LINK_OPENED + 299)).toBeNull();
    expect(recoveryDenial(limited, LINK_OPENED + 300)).toBeNull();
    expect(recoveryDenial(limited, LINK_OPENED + 301)).toBe("UNAUTHENTICATED");
  });
});

describe("server pages and the limited session", () => {
  it("a limited session goes to /account/reset within its 5 minutes, then to /login", () => {
    const limited = identity("otp");
    expect(limitedSessionPage(limited, LINK_OPENED + 60)).toBe("/account/reset");
    expect(limitedSessionPage(limited, LINK_OPENED + 301)).toBe("/login");
    const auth: SessionAuth = { identity: limited, state };
    expect(memberPageRedirect(auth, "/sell", LINK_OPENED + 60)).toBe("/account/reset");
    expect(memberPageRedirect(auth, "/sell", LINK_OPENED + 301)).toBe("/login");
  });

  it("an ordinary session and a guest are unchanged", () => {
    expect(memberPageRedirect({ identity: identity("password"), state }, "/sell")).toBeNull();
    expect(memberPageRedirect(null, "/sell")).toBe("/login?next=%2Fsell");
  });

  it("SEC03: the recovery pages send no Referer and are never stored", () => {
    expect(isAuthLinkPath("/auth/recover")).toBe(true);
    expect(isAuthLinkPath("/account/reset")).toBe(true);
    expect(isAuthLinkPath("/account/resets")).toBe(false);
    expect(isAuthLinkPath("/recover")).toBe(false);
  });
});
