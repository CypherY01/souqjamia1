// API029 (task 3.8): the five optional email groups (FR68, BR38, SEC11, DEC49, DEC65). Security
// and administrative email has no field here, so it cannot be turned off: any other key is 400.
// The body is the contract's PreferencesPatch; a stale version is 409 STATE_CONFLICT, and a
// request that changes nothing keeps the version (as API016). Framework-free.
import { z } from "zod";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb } from "../db/app-client.ts";
import { readJson } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";

export const PreferencesBody = z.strictObject({
  email_groups: z.strictObject({
    offers: z.boolean().optional(),
    meetups: z.boolean().optional(),
    deals: z.boolean().optional(),
    reviews: z.boolean().optional(),
    reports: z.boolean().optional(),
  }),
  expected_version: z.int().min(1),
});

/** The contract's Preferences. */
export interface Preferences {
  email_groups: {
    offers: boolean;
    meetups: boolean;
    deals: boolean;
    reviews: boolean;
    reports: boolean;
  };
  version: number;
}

interface PreferencesRow {
  email_offers: boolean;
  email_meetups: boolean;
  email_deals: boolean;
  email_reports: boolean;
  email_reviews: boolean;
  preferences_version: number;
}

export async function updatePreferences(
  request: Request,
  ctx: GuardContext & { db: AppDb },
): Promise<Preferences> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const input = await readJson(request, PreferencesBody);
  // DEC72: the whole body may run again; it does everything through tx, with the same inputs.
  const row = await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    const result = await tx.query<PreferencesRow>(
      `select email_offers, email_meetups, email_deals, email_reports, email_reviews,
              preferences_version
         from app.update_notification_preferences($1, $2::jsonb)`,
      [input.expected_version, JSON.stringify(input.email_groups)],
    );
    return result.rows[0];
  });
  if (row === undefined) throw new ApiError("INTERNAL_ERROR");
  return {
    email_groups: {
      offers: row.email_offers,
      meetups: row.email_meetups,
      deals: row.email_deals,
      reviews: row.email_reviews,
      reports: row.email_reports,
    },
    version: row.preferences_version,
  };
}
