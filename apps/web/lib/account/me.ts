// API015 (task 3.5): the private account fields of the session's member, the contract's Me.
// One read of app.me() (DEC77), which also checks the live session, so a route does not read
// app.session_context() first. Framework-free, so integration tests run it as is.
import type { enums } from "@souq/domain";
import type { AppDb, Tx } from "../db/app-client.ts";
import { ApiError } from "../http/errors.ts";
import { memberDenial, parseRoles, type SessionState } from "../auth/guards.ts";
import type { Identity } from "../auth/identity.ts";

export interface CatalogRef {
  id: string;
  key: string;
  label_ar: string;
  label_en: string | null;
}

/** The contract's Me (contracts/components/schemas.yaml). */
export interface Me {
  id: string;
  email: string;
  email_confirmed: boolean;
  /** Task 3.6 (BR23). */
  pending_email: string | null;
  display_name: string;
  college: CatalogRef | null;
  /** Task 4.7 (FR61, DEC54). */
  avatar: null;
  locale: enums.Locale;
  account_status: enums.AccountStatus;
  suspended_until: string | null;
  deletion_requested_at: string | null;
  roles: enums.Role[];
  mfa_enrolled: boolean;
  terms_acknowledged: boolean;
  /** Task 7.6 (DEC27, DEC45). */
  student_badge: { status: null; badge_expires_at: null };
  preferences: {
    email_groups: {
      offers: boolean;
      meetups: boolean;
      deals: boolean;
      reviews: boolean;
      reports: boolean;
    };
    version: number;
  };
  capabilities: { market_write: boolean; admin: boolean };
  version: number;
}

/** What the account page shows besides Me. */
export interface Account {
  me: Me;
  joinedAt: Date;
  /** The live state, for the page's notices (the same rules as the guards). */
  state: SessionState;
}

interface MeRow {
  user_id: string;
  email: string;
  email_confirmed: boolean;
  display_name: string;
  college_id: string | null;
  college_key: string | null;
  college_label_ar: string | null;
  college_label_en: string | null;
  locale: enums.Locale;
  joined_at: Date;
  account_status: enums.AccountStatus;
  suspended_until: Date | null;
  deletion_requested_at: Date | null;
  restricted: boolean;
  terms_acknowledged: boolean;
  roles: enums.Role[] | string;
  mfa_enrolled: boolean;
  email_offers: boolean;
  email_meetups: boolean;
  email_deals: boolean;
  email_reviews: boolean;
  email_reports: boolean;
  preferences_version: number;
  version: number;
}

// Named columns (DEC77): a column added to app.me() later reaches no response by accident.
const ME_QUERY = `select user_id, email, email_confirmed, display_name, college_id, college_key,
  college_label_ar, college_label_en, locale, joined_at, account_status, suspended_until,
  deletion_requested_at, restricted, terms_acknowledged, roles, mfa_enrolled, email_offers,
  email_meetups, email_deals, email_reviews, email_reports, preferences_version, version
  from app.me()`;

function toAccount(row: MeRow, identity: Identity): Account {
  const state: SessionState = {
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
  const college =
    row.college_id === null || row.college_key === null || row.college_label_ar === null
      ? null
      : {
          id: row.college_id,
          key: row.college_key,
          label_ar: row.college_label_ar,
          label_en: row.college_label_en,
        };
  const me: Me = {
    id: row.user_id,
    email: row.email,
    email_confirmed: row.email_confirmed,
    pending_email: null,
    display_name: row.display_name,
    college,
    avatar: null,
    locale: row.locale,
    account_status: row.account_status,
    suspended_until: row.suspended_until?.toISOString() ?? null,
    deletion_requested_at: row.deletion_requested_at?.toISOString() ?? null,
    roles: state.roles,
    mfa_enrolled: row.mfa_enrolled,
    terms_acknowledged: row.terms_acknowledged,
    student_badge: { status: null, badge_expires_at: null },
    preferences: {
      email_groups: {
        offers: row.email_offers,
        meetups: row.email_meetups,
        deals: row.email_deals,
        reviews: row.email_reviews,
        reports: row.email_reports,
      },
      version: row.preferences_version,
    },
    capabilities: {
      // DEC58: the member guard's answer. A limited session never reaches app.me().
      market_write: memberDenial(state) === null,
      // Item 6: a role and an MFA session. Task 7.1 adds the staff guard and its limits (DEC38).
      admin: state.roles.length > 0 && identity.aal === "aal2",
    },
    version: row.version,
  };
  return { me, joinedAt: row.joined_at, state };
}

/** Reads the account inside a transaction that already carries the member's claims. */
export async function readAccount(tx: Tx, identity: Identity): Promise<Account> {
  const row = (await tx.query<MeRow>(ME_QUERY)).rows[0];
  if (row === undefined) throw new ApiError("UNAUTHENTICATED");
  return toAccount(row, identity);
}

/** API015 and the account pages: the account of the identity's live session. */
export function loadAccount(db: AppDb, identity: Identity, traceId: string): Promise<Account> {
  return db.withActor(identity.claims, traceId, (tx) => readAccount(tx, identity));
}
