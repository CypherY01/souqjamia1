// Page routes from plan/screens.md and API paths from contracts/openapi.yaml, in one place.
// Pages that are not built yet return 404 until their task.
export const routes = {
  home: "/",
  market: "/market",
  wanted: "/wanted",
  howItWorks: "/how-it-works",
  safety: "/how-it-works#safety",
  privacy: "/privacy",
  contact: "/privacy#contact",
  terms: "/terms",
  guidelines: "/guidelines",
  login: "/login",
  signup: "/signup",
  // Task 3.4: the recovery request page. Linked from the DEC64 message on the signup page.
  recover: "/recover",
  // Task 3.2: the email confirmation link page (API004), while confirmation is on.
  confirmEmail: "/auth/confirm",
  // FR78, task 3.1: the state of a restricted or deletion-pending account.
  restricted: "/restricted",
  sell: "/sell",
  messages: "/messages",
  notifications: "/notifications",
  account: {
    profile: "/account/profile",
    listings: "/account/listings",
    wanted: "/account/wanted",
    favorites: "/account/favorites",
  },
  api: {
    // API003. POST only: no state change on GET (SEC05). Wired in task 3.3.
    logout: "/api/auth/logout",
  },
} as const;
