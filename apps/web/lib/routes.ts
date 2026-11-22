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
  // Task 3.4: the recovery request page (API006). Linked from the login page and the DEC64
  // message on the signup page.
  recover: "/recover",
  // Task 3.2: the email confirmation link page (API004), while confirmation is on.
  confirmEmail: "/auth/confirm",
  // Task 3.4: the recovery link page (API007), in both confirmation modes.
  recoverLink: "/auth/recover",
  // Task 3.6: an email change link (API021), and where it leads (?state=waiting or changed).
  emailChangeLink: "/auth/email-change",
  emailChangeDone: "/auth/email-change/done",
  // Task 3.7: the deletion recovery link (API028), and where it leads.
  accountRecoveryLink: "/auth/account-recovery",
  accountRecoveryDone: "/auth/account-recovery/done",
  // FR78, task 3.1: the state of a restricted or deletion-pending account.
  restricted: "/restricted",
  sell: "/sell",
  messages: "/messages",
  notifications: "/notifications",
  account: {
    // Task 3.5: the account page (API015) and the profile edit (API016).
    home: "/account",
    profile: "/account/profile",
    listings: "/account/listings",
    wanted: "/account/wanted",
    favorites: "/account/favorites",
    // Task 3.4: the new password, for the recovery session only (API008, DEC38).
    reset: "/account/reset",
    // Task 3.6: reauthentication, email and password change (API009, API020, API022).
    security: "/account/security",
    // Task 3.7: the deletion request (API026, DEC81).
    delete: "/account/delete",
    // Task 3.8: the optional email groups (API029).
    notifications: "/account/notifications",
  },
  api: {
    // API002 and API003 (task 3.3). POST only: no state change on GET (SEC05).
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    // API006, API007 and API008 (task 3.4).
    recovery: "/api/auth/recovery",
    recoveryVerify: "/api/auth/recovery/verify",
    reset: "/api/auth/reset",
    // API009, API020, API021 and API022 (task 3.6).
    reauth: "/api/auth/reauth",
    emailChange: "/api/profile/email-change",
    emailChangeConfirm: "/api/profile/email-change/confirm",
    passwordChange: "/api/profile/password-change",
    // API026, API027 and API028 (task 3.7).
    deletion: "/api/profile/deletion",
    deletionRecoveryRequest: "/api/profile/deletion-recovery/request",
    deletionRecoveryConfirm: "/api/profile/deletion-recovery/confirm",
    // API015, API016 (task 3.5) and API119 (DEC69, its first form in task 3.5).
    me: "/api/me",
    profile: "/api/profile/me",
    policyAcknowledgments: "/api/me/policy-acknowledgments",
    currentPolicies: "/api/policies/current",
    // API078, API079, API115 and API029 (task 3.8).
    notifications: "/api/notifications",
    unreadCount: "/api/notifications/unread-count",
    preferences: "/api/me/preferences",
  },
} as const;
