// Task 4.5, item 7: what the favorite control is for the page's reader. The server page decides
// and passes the mode to the client components.
//  - member: the save button (a member who may write: x-access member).
//  - guest: a link to the login page that comes back to the same page (UC05).
//  - none: a recovery session, or an account the member guard refuses (restricted, awaiting
//    deletion, unconfirmed email, terms not acknowledged): no control, as for the contact button.
import { memberDenial, type SessionAuth } from "../auth/guards.ts";

export type FavoriteMode = "member" | "guest" | "none";

export function favoriteModeOf(auth: SessionAuth | null): FavoriteMode {
  if (auth === null) return "guest";
  if (auth.identity.limited) return "none";
  return memberDenial(auth.state) === null ? "member" : "none";
}
