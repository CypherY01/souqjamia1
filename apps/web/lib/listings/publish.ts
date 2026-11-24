// API034 (task 4.2): publish a listing from the wizard. FR16 to FR22, BR05 to BR08, DEC28,
// RL05, TC07, TC08, TC09, TC25, TC64, TC65.
//  - The guard (member: session, email, account state, current terms), then Idempotency-Key.
//  - The body is the contract's ListingInput: any other field (seller_id, status, a badge, a
//    rating) is 400 BAD_REQUEST and changes nothing (TC65). The seller is the session's member.
//  - The field rules of @souq/domain, every problem at once (422 with field_errors), so the
//    wizard goes back to the step of the first one (section 6.3).
//  - app.publish_listing() checks everything again and decides: the same key returns the same
//    listing (200, FR22), RL05, the 200 limit, the images (MEDIA_INVALID, MEDIA_NOT_READY).
// Framework-free, so integration tests run it as is.
import {
  enums,
  LISTING_IMAGES_MAX,
  LISTING_IMAGES_MIN,
  LISTING_PRICE_MAX_MINOR,
  listingFieldErrors,
} from "@souq/domain";
import { z } from "zod";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb } from "../db/app-client.ts";
import { readJson } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { idempotencyKey } from "../http/idempotency.ts";
import { readOwnerListing, type OwnerListing } from "./owner.ts";

export const ListingBody = z.strictObject({
  title: z.string(),
  description: z.string(),
  category_id: z.uuid(),
  condition: z.enum(enums.Condition),
  location_id: z.uuid().nullable().optional(),
  price_minor: z.int().min(0).max(LISTING_PRICE_MAX_MINOR),
  is_negotiable: z.boolean(),
  media_ids: z.array(z.uuid()).min(LISTING_IMAGES_MIN).max(LISTING_IMAGES_MAX),
});
export type ListingBody = z.infer<typeof ListingBody>;

export interface ListingContext extends GuardContext {
  db: AppDb;
  /** NEXT_PUBLIC_SUPABASE_URL, for the public image URLs of the answer. */
  supabaseUrl: string;
}

export interface Published {
  listing: OwnerListing;
  /** false for a logical retry (the same key): the route answers 200 instead of 201. */
  created: boolean;
}

interface PublishRow {
  listing_id: string;
  created: boolean;
}

export async function publishListing(request: Request, ctx: ListingContext): Promise<Published> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const key = idempotencyKey(request);
  const input = await readJson(request, ListingBody);
  const fieldErrors = listingFieldErrors(input);
  if (fieldErrors.length > 0) {
    throw new ApiError("VALIDATION_FAILED", { fieldErrors: [...fieldErrors] });
  }
  // The stored payload hash covers every field, so "no meeting point" is always null, never
  // absent: a retry of the same request hashes the same (FR22).
  const payload = { ...input, location_id: input.location_id ?? null };

  // DEC72: the whole body may run again; it does everything through tx, with the same inputs.
  return ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    const result = await tx.query<PublishRow>(
      "select listing_id, created from app.publish_listing($1, $2::jsonb)",
      [key, JSON.stringify(payload)],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("app.publish_listing returned no row");
    const listing = await readOwnerListing(tx, row.listing_id, ctx.supabaseUrl);
    if (listing === null) throw new Error("the published listing is not readable by its seller");
    return { listing, created: row.created };
  });
}
