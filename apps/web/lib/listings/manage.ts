// Task 4.4: the seller manages their listings. API033 (FR23, FR24), API035 (FR23, DEC85, TC10,
// TC35) and API036 (FR24, BR27, DEC09, TC34, TC35).
//  - The guard is member (session, email, account state, current terms).
//  - API035's body is the contract's ListingPatch: any other field (seller_id, status, a badge)
//    is 400 BAD_REQUEST and changes nothing (TC65). The field rules of @souq/domain run on what
//    was sent, every problem at once (422 with field_errors); BR08 on the merged listing is left
//    to the database, which has the stored values.
//  - app.update_listing() and app.transition_listing() check everything again under the
//    listing's lock and decide: NOT_FOUND for another member's listing (TC10), FORBIDDEN when
//    hidden by moderation (item 4), STATE_CONFLICT for another state or version, DEADLINE_PASSED
//    and LIMIT_REACHED for a restore, RATE_LIMITED past DEC85.
//  - No Idempotency-Key: expected_version keeps the same request from applying twice.
// Framework-free, so integration tests run it as is.
import {
  enums,
  LISTING_ACTIONS,
  LISTING_IMAGES_MAX,
  LISTING_IMAGES_MIN,
  LISTING_PRICE_MAX_MINOR,
  parseListingDescription,
  parseListingTitle,
} from "@souq/domain";
import { z } from "zod";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb, Tx } from "../db/app-client.ts";
import { readJson } from "../http/body.ts";
import { ApiError, type FieldError } from "../http/errors.ts";
import {
  listOwnerListings,
  readOwnerListing,
  type MyListingsRequest,
  type OwnerListing,
  type OwnerListingPage,
} from "./owner.ts";

export const ListingPatchBody = z.strictObject({
  title: z.string().optional(),
  description: z.string().optional(),
  category_id: z.uuid().optional(),
  condition: z.enum(enums.Condition).optional(),
  location_id: z.uuid().nullable().optional(),
  price_minor: z.int().min(0).max(LISTING_PRICE_MAX_MINOR).optional(),
  is_negotiable: z.boolean().optional(),
  media_ids: z.array(z.uuid()).min(LISTING_IMAGES_MIN).max(LISTING_IMAGES_MAX).optional(),
  expected_version: z.int().min(1),
});
export type ListingPatchBody = z.infer<typeof ListingPatchBody>;

export const TransitionBody = z.strictObject({
  action: z.enum(LISTING_ACTIONS),
  expected_version: z.int().min(1),
});

/** The field rules past the structure, on the fields that were sent. */
export function listingPatchErrors(input: ListingPatchBody): FieldError[] {
  const errors: FieldError[] = [];
  if (input.title !== undefined) {
    const title = parseListingTitle(input.title);
    if (!title.ok) errors.push({ field: "title", code: title.error });
  }
  if (input.description !== undefined) {
    const description = parseListingDescription(input.description);
    if (!description.ok) errors.push({ field: "description", code: description.error });
  }
  if (input.price_minor === 0 && input.is_negotiable === true) {
    errors.push({ field: "is_negotiable", code: "not_allowed" });
  }
  if (input.media_ids !== undefined && new Set(input.media_ids).size !== input.media_ids.length) {
    errors.push({ field: "media_ids", code: "duplicate" });
  }
  return errors;
}

export interface ManageContext extends GuardContext {
  db: AppDb;
  /** NEXT_PUBLIC_SUPABASE_URL, for the public image URLs of the answer. */
  supabaseUrl: string;
}

export interface MyListingsContext extends ManageContext {
  appSecret: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function answer(tx: Tx, id: string, ctx: ManageContext): Promise<OwnerListing> {
  const listing = await readOwnerListing(tx, id, ctx.supabaseUrl);
  if (listing === null) throw new Error("the managed listing is not readable by its seller");
  return listing;
}

/** API035: the listing after the edit (OwnerListingOk). */
export async function updateListing(
  request: Request,
  id: string,
  ctx: ManageContext,
): Promise<OwnerListing> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const input = await readJson(request, ListingPatchBody);
  if (!UUID.test(id)) throw new ApiError("NOT_FOUND");
  const fieldErrors = listingPatchErrors(input);
  if (fieldErrors.length > 0) throw new ApiError("VALIDATION_FAILED", { fieldErrors });
  const { expected_version, ...patch } = input;

  // DEC72: the whole body may run again; it does everything through tx, with the same inputs.
  return ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.update_listing($1, $2, $3::jsonb)", [
      id,
      expected_version,
      JSON.stringify(patch),
    ]);
    return answer(tx, id, ctx);
  });
}

/** API036: the listing after mark_sold, archive or restore (OwnerListingOk). */
export async function transitionListing(
  request: Request,
  id: string,
  ctx: ManageContext,
): Promise<OwnerListing> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const input = await readJson(request, TransitionBody);
  if (!UUID.test(id)) throw new ApiError("NOT_FOUND");
  return ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.transition_listing($1, $2, $3)", [
      id,
      input.action,
      input.expected_version,
    ]);
    return answer(tx, id, ctx);
  });
}

/** API033: one page of the member's tab. */
export async function readMyListings(
  ctx: MyListingsContext,
  request: MyListingsRequest,
): Promise<OwnerListingPage> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  return ctx.db.withActor(identity.claims, ctx.traceId, (tx) =>
    listOwnerListings(tx, ctx.appSecret, ctx.supabaseUrl, request),
  );
}

/** The member's own listing for the edit page, or null (another member's or unknown). */
export async function readListingForOwner(
  ctx: ManageContext,
  id: string,
): Promise<OwnerListing | null> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  return ctx.db.withActor(identity.claims, ctx.traceId, (tx) =>
    readOwnerListing(tx, id, ctx.supabaseUrl),
  );
}
