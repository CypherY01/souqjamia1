// Server guards for the x-access levels of contracts/README.md (task 3.1, item 8): FR04, BR01,
// FR78, DEC73.
//   guest    nothing
//   session  a verified identity, a live session (app.session_context), not a limited session
//   member   session, then the order of app.assert_active_member(): DELETION_PENDING,
//            ACCOUNT_RESTRICTED, EMAIL_NOT_CONFIRMED, TERMS_NOT_ACKNOWLEDGED
//   recovery a live limited session (DEC73, a recovery link) within its 5 minutes (DEC38), for
//            API008 only (task 3.4). Any account state (FR78: a narrow, verified flow).
// Later levels join with their tasks: member_reauth (3.6), role_holder, staff and
// platform_owner (7.1). Writes pass the guard here and again app.assert_active_member() inside
// the entry point: the database is the authority, the guard rejects early.
import type { enums } from "@souq/domain";
import { appDb, type AppDb } from "../db/app-client.ts";
import { ApiError, type ErrorCode } from "../http/errors.ts";
import { routes } from "../routes.ts";
import { limitedSessionExpired, type Identity } from "./identity.ts";

type AccountStatus = enums.AccountStatus;
type Role = enums.Role;

/** One row of app.session_context(). */
export interface SessionState {
  userId: string;
  /** For the site header (task 1.5). */
  displayName: string;
  accountStatus: AccountStatus;
  suspendedUntil: Date | null;
  deletionRequestedAt: Date | null;
  /** Banned, or suspended until a time still ahead (database clock). */
  restricted: boolean;
  emailConfirmed: boolean;
  termsAcknowledged: boolean;
  roles: Role[];
}

export interface SessionAuth {
  identity: Identity;
  state: SessionState;
}

export interface GuardContext {
  traceId: string;
  identity(): Promise<Identity | null>;
}

interface SessionContextRow {
  user_id: string;
  display_name: string;
  account_status: AccountStatus;
  suspended_until: Date | null;
  deletion_requested_at: Date | null;
  restricted: boolean;
  email_confirmed: boolean;
  terms_acknowledged: boolean;
  roles: Role[] | string;
}

/** pg returns an array of an enum type as its text form, {owner,moderator}. */
function parseRoles(value: Role[] | string): Role[] {
  if (Array.isArray(value)) return value;
  const inner = value.replace(/^\{|\}$/g, "");
  return inner === "" ? [] : (inner.split(",") as Role[]);
}

/** The live session and account state, or UNAUTHENTICATED (FR04). */
export async function loadSessionState(
  identity: Identity,
  traceId: string,
  db: AppDb = appDb(),
): Promise<SessionState> {
  const row = await db.withActor(identity.claims, traceId, async (tx) => {
    const result = await tx.query<SessionContextRow>("select * from app.session_context()");
    return result.rows[0];
  });
  if (row === undefined) throw new ApiError("UNAUTHENTICATED");
  return {
    userId: row.user_id,
    displayName: row.display_name,
    accountStatus: row.account_status,
    suspendedUntil: row.suspended_until,
    deletionRequestedAt: row.deletion_requested_at,
    restricted: row.restricted,
    emailConfirmed: row.email_confirmed,
    termsAcknowledged: row.terms_acknowledged,
    roles: parseRoles(row.roles),
  };
}

/** Why a session may not use member access, in the order of app.assert_active_member(). */
export function memberDenial(state: SessionState): ErrorCode | null {
  if (state.deletionRequestedAt !== null) return "DELETION_PENDING";
  if (state.restricted) return "ACCOUNT_RESTRICTED";
  if (!state.emailConfirmed) return "EMAIL_NOT_CONFIRMED";
  if (!state.termsAcknowledged) return "TERMS_NOT_ACKNOWLEDGED";
  return null;
}

/** FR72: an account awaiting deletion can be recovered for 30 days after the request. */
export const DELETION_RECOVERY_DAYS = 30;

/** What /restricted shows (FR78, DEC41), or null for an account that is not restricted. */
export type Restriction =
  | { kind: "deletion_pending"; deadline: Date }
  | { kind: "banned" }
  | { kind: "suspended"; until: Date };

/** Deletion first: during the recovery window the account sees only that state (DEC41). */
export function restrictionOf(state: SessionState): Restriction | null {
  if (state.deletionRequestedAt !== null) {
    const deadline = new Date(state.deletionRequestedAt.getTime() + DELETION_RECOVERY_DAYS * 864e5);
    return { kind: "deletion_pending", deadline };
  }
  if (!state.restricted) return null;
  if (state.accountStatus === "suspended" && state.suspendedUntil !== null) {
    return { kind: "suspended", until: state.suspendedUntil };
  }
  return { kind: "banned" };
}

/** DEC73 and DEC38: a limited session is refused here, and once older than 5 minutes it is over. */
export function limitedSessionDenial(identity: Identity, nowSeconds: number): ErrorCode | null {
  if (!identity.limited) return null;
  return limitedSessionExpired(identity, nowSeconds) ? "UNAUTHENTICATED" : "RECOVERY_SESSION_ONLY";
}

export interface GuardOptions {
  db?: AppDb;
  /** Unix seconds; tests pass a fixed clock. */
  nowSeconds?: number;
}

/** x-access: session. Any account state, so restricted accounts can see their state (DEC58). */
export async function requireSession(
  ctx: GuardContext,
  options: GuardOptions = {},
): Promise<SessionAuth> {
  const identity = await ctx.identity();
  if (identity === null) throw new ApiError("UNAUTHENTICATED");
  const limited = limitedSessionDenial(identity, options.nowSeconds ?? Date.now() / 1000);
  if (limited !== null) throw new ApiError(limited);
  const state = await loadSessionState(identity, ctx.traceId, options.db);
  return { identity, state };
}

/**
 * x-access: recovery, without the database (task 3.4): a guest or a limited session past its
 * 5 minutes is UNAUTHENTICATED, an ordinary session FORBIDDEN (it changes its password from the
 * account page, task 3.6), and a limited session within its 5 minutes passes (null).
 */
export function recoveryDenial(identity: Identity | null, nowSeconds: number): ErrorCode | null {
  if (identity === null) return "UNAUTHENTICATED";
  if (!identity.limited) return "FORBIDDEN";
  return limitedSessionExpired(identity, nowSeconds) ? "UNAUTHENTICATED" : null;
}

/** x-access: recovery (DEC38, DEC73), with the live-session check of app.session_context(). */
export async function requireRecovery(
  ctx: GuardContext,
  options: GuardOptions = {},
): Promise<SessionAuth> {
  const identity = await ctx.identity();
  const denial = recoveryDenial(identity, options.nowSeconds ?? Date.now() / 1000);
  if (denial !== null || identity === null) throw new ApiError(denial ?? "UNAUTHENTICATED");
  const state = await loadSessionState(identity, ctx.traceId, options.db);
  return { identity, state };
}

/**
 * Item 8, server pages: where a member page sends this visitor, or null to render it. A guest
 * or an ended session goes to the login page with the path to come back to (a local path only,
 * TC02 in task 3.3), a limited session to the new-password page within its 5 minutes and to the
 * login page after them (task 3.4), and a restricted account or one awaiting deletion to
 * /restricted (FR78, DEC41). Email and terms are not redirects: the page shows what is missing,
 * and every write is refused.
 */
export function memberPageRedirect(
  auth: SessionAuth | null,
  path: string,
  nowSeconds = Date.now() / 1000,
): string | null {
  if (auth === null) return `${routes.login}?next=${encodeURIComponent(path)}`;
  if (auth.identity.limited) return limitedSessionPage(auth.identity, nowSeconds);
  const denial = memberDenial(auth.state);
  if (denial === "DELETION_PENDING" || denial === "ACCOUNT_RESTRICTED") return routes.restricted;
  return null;
}

/** Task 3.4: a limited session belongs on the new-password page, until its 5 minutes are over. */
export function limitedSessionPage(identity: Identity, nowSeconds: number): string {
  return limitedSessionExpired(identity, nowSeconds) ? routes.login : routes.account.reset;
}

/** x-access: member (BR01, DEC36, DEC63). */
export async function requireMember(
  ctx: GuardContext,
  options: GuardOptions = {},
): Promise<SessionAuth> {
  const auth = await requireSession(ctx, options);
  const denial = memberDenial(auth.state);
  if (denial !== null) throw new ApiError(denial);
  return auth;
}
