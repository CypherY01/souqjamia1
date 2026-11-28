// Task 4.5 (plan/task-4.5.md): the rules of favorites without the database. FR15, UC05, DEC86,
// items 1, 2 and 7.
import { describe, expect, it } from "vitest";
import { FAVORITE_SAVES_PER_HOUR, FAVORITES_MAX, favoriteView } from "@souq/domain";
import { t } from "@souq/i18n";
import type { SessionAuth, SessionState } from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { favoriteModeOf } from "../../apps/web/lib/favorites/mode.ts";
import { routes } from "../../apps/web/lib/routes.ts";

const STATE: SessionState = {
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

function auth(state: Partial<SessionState> = {}, limited = false): SessionAuth {
  return {
    identity: { limited } as unknown as Identity,
    state: { ...STATE, ...state },
  };
}

describe("DEC86: the limits", () => {
  it("500 favorites per member and 120 new saves per hour", () => {
    expect(FAVORITES_MAX).toBe(500);
    expect(FAVORITE_SAVES_PER_HOUR).toBe(120);
  });
});

describe("UC05: what a favorite shows", () => {
  it("an available favorite carries its card", () => {
    expect(favoriteView("id-1", "2026-11-28T10:00:00.000Z", { title: "كتاب" })).toEqual({
      listing_id: "id-1",
      available: true,
      listing: { title: "كتاب" },
      saved_at: "2026-11-28T10:00:00.000Z",
    });
  });

  it("an unavailable favorite is only its id and the time it was saved", () => {
    expect(favoriteView("id-2", "2026-11-28T10:00:00.000Z", null)).toEqual({
      listing_id: "id-2",
      available: false,
      listing: null,
      saved_at: "2026-11-28T10:00:00.000Z",
    });
  });
});

describe("item 7: the favorite control of the page's reader", () => {
  it("a guest gets the sign-in link, a member who may write the button", () => {
    expect(favoriteModeOf(null)).toBe("guest");
    expect(favoriteModeOf(auth())).toBe("member");
  });

  it("a recovery session and a member the guard refuses get no control", () => {
    expect(favoriteModeOf(auth({}, true))).toBe("none");
    for (const state of [
      { restricted: true },
      { deletionRequestedAt: new Date() },
      { emailConfirmed: false },
      { termsAcknowledged: false },
    ]) {
      expect(favoriteModeOf(auth(state))).toBe("none");
    }
  });
});

describe("API048 to API050: the routes and the texts", () => {
  it("the contract's paths", () => {
    expect(routes.api.myFavorites).toBe("/api/me/favorites");
    expect(routes.api.favorite("a b")).toBe("/api/favorites/a%20b");
  });

  it("the button's accessible names carry the title, the visible state is text", () => {
    expect(t("favorites.button.saveName", { title: "كتاب" })).toContain("كتاب");
    expect(t("favorites.button.savedName", { title: "كتاب" })).toContain("كتاب");
    expect(t("favorites.button.guestName", { title: "كتاب" })).toContain("كتاب");
    expect(t("favorites.button.save")).not.toBe(t("favorites.button.saved"));
    expect(t("favorites.button.limitReached", { max: "500" })).toContain("500");
  });
});
