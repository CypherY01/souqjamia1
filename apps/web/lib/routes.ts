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
