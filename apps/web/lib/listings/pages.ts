// The public listing reads of server pages (task 4.3): the home page, /market and
// /listing/{id}; and the seller's own reads (task 4.4). The page's session (pageSession) decides
// the reader and the RL04 key; the page shows each outcome as its own state (FR07: «لا نتائج» is
// not «فشل الطلب»), so a failure here never becomes the generic error page.
import { headers } from "next/headers";
import { log } from "@souq/log";
import type { MarketFilters } from "@souq/domain";
import type { SessionAuth } from "../auth/guards.ts";
import { pageSession } from "../auth/page.ts";
import { appDb } from "../db/app-client.ts";
import { serverEnv } from "../env.ts";
import { ApiError } from "../http/errors.ts";
import { traceIdOf } from "../http/trace.ts";
import { countSearch, searchLimits } from "./limits.ts";
import { readListingForOwner, readMyListings } from "./manage.ts";
import { myListingsRequest, type OwnerListing, type OwnerListingPage } from "./owner.ts";
import {
  readPublicListing,
  searchListings,
  type ListingDetail,
  type ListingPage,
  type PublicReadContext,
} from "./public.ts";

export type ListingsPageResult =
  | { kind: "ok"; page: ListingPage }
  | { kind: "invalid" }
  | { kind: "limited"; retryAfter: number }
  | { kind: "failed" };

/** The server's time for a page's relative dates (a component may not read the clock). */
export function pageNow(): Date {
  return new Date();
}

async function reader(): Promise<{
  ctx: PublicReadContext;
  memberId: string | null;
  requestHeaders: Headers;
}> {
  // The request's headers, Cookie included (RL04's guest key) and the forwarded address.
  const requestHeaders = new Headers(await headers());
  const env = serverEnv();
  const auth = await pageSession();
  return {
    ctx: {
      db: appDb(),
      traceId: traceIdOf(requestHeaders),
      appSecret: env.APP_SECRET,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      claims: auth?.identity.claims ?? null,
    },
    memberId: auth?.identity.userId ?? null,
    requestHeaders,
  };
}

/** RL04, then one page of cards; each outcome a state of the page. */
export async function loadListingsPage(
  filters: MarketFilters,
  cursor: string | null,
  limit: number,
): Promise<ListingsPageResult> {
  const { ctx, memberId, requestHeaders } = await reader();
  try {
    await countSearch(ctx.db, ctx.traceId, searchLimits(serverEnv(), requestHeaders, memberId));
    return { kind: "ok", page: await searchListings(ctx, filters, cursor, limit) };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "RATE_LIMITED") {
        return { kind: "limited", retryAfter: error.retryAfter ?? 60 };
      }
      if (error.code === "INVALID_CURSOR" || error.code === "BAD_REQUEST") {
        return { kind: "invalid" };
      }
    }
    log.error("listings.page_read_failed", {
      trace_id: ctx.traceId,
      error: error instanceof ApiError ? error.code : "unexpected",
    });
    return { kind: "failed" };
  }
}

/** API032 for /listing/{id}: the public listing or null (the generic «غير متاح»). */
export async function loadPublicListing(id: string): Promise<ListingDetail | null> {
  const { ctx } = await reader();
  return readPublicListing(ctx, id);
}

// Task 4.4: the seller's own reads for /account/listings and /account/listings/{id}/edit, with
// the page's verified session (requireMemberPage ran first).

export type MyListingsPageResult =
  { kind: "ok"; page: OwnerListingPage } | { kind: "invalid" } | { kind: "failed" };

function ownerContext(auth: SessionAuth, traceId: string) {
  const env = serverEnv();
  return {
    db: appDb(),
    traceId,
    appSecret: env.APP_SECRET,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    identity: () => Promise.resolve(auth.identity),
  };
}

/** API033 for /account/listings: one page of the tab, or the page's state. */
export async function loadMyListingsPage(
  auth: SessionAuth,
  params: URLSearchParams,
): Promise<MyListingsPageResult> {
  const traceId = traceIdOf(await headers());
  try {
    return {
      kind: "ok",
      page: await readMyListings(ownerContext(auth, traceId), myListingsRequest(params)),
    };
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === "INVALID_CURSOR" || error.code === "BAD_REQUEST")
    ) {
      return { kind: "invalid" };
    }
    log.error("listings.owner_page_read_failed", {
      trace_id: traceId,
      error: error instanceof ApiError ? error.code : "unexpected",
    });
    return { kind: "failed" };
  }
}

/** The member's own listing for the edit page, or null (another member's or unknown). */
export async function loadOwnerListing(
  auth: SessionAuth,
  id: string,
): Promise<OwnerListing | null> {
  return readListingForOwner(ownerContext(auth, traceIdOf(await headers())), id);
}
