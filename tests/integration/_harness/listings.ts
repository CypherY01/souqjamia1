// Task 4.2: listings with the real server code (lib/listings/publish.ts), real images (uploaded
// through API037 to API039 and processed by the worker's real image.process) and the worker's
// real media.publish. The Supabase URL and secret key are the local stack's own.
import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import type { Identity } from "../../../apps/web/lib/auth/identity.ts";
import type { AppDb } from "../../../apps/web/lib/db/app-client.ts";
import {
  publishListing,
  type ListingContext,
  type Published,
} from "../../../apps/web/lib/listings/publish.ts";
import {
  readMyListings,
  transitionListing,
  updateListing,
  type MyListingsContext,
} from "../../../apps/web/lib/listings/manage.ts";
import { myListingsRequest, type OwnerListingPage } from "../../../apps/web/lib/listings/owner.ts";
import { createMediaPublish } from "../../../apps/worker/src/jobs/media.publish.ts";
import type { StorageFactory } from "../../../apps/worker/src/jobs/image.process.ts";
import { png } from "../../fixtures/images/index.ts";
import { jsonRequest, outcome, type Outcome } from "./auth-flow.ts";
import { dbPool, scalar } from "./db.ts";
import {
  assertRan,
  realStorage,
  runImageProcess,
  trace,
  uploadImage,
  type JobRun,
} from "./storage.ts";
import { TEST_APP_SECRET } from "./market.ts";
import { captureLogger, workerPool } from "./worker.ts";

/** One of the seven categories of the migration (BR03). */
export function categoryId(key = "books_study"): Promise<string> {
  return scalar<string>(dbPool(), "select id::text from public.category where key = $1", [key]);
}

/** One processed listing image of the member, ready to publish. */
export async function readyImage(db: AppDb, identity: Identity): Promise<string> {
  const bytes = await png(400, 300);
  const { id } = await uploadImage(db, identity, bytes, "image/png", { width: 400, height: 300 });
  assertRan(await runImageProcess(id));
  return id;
}

export async function readyImages(db: AppDb, identity: Identity, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) ids.push(await readyImage(db, identity));
  return ids;
}

/** A valid ListingInput with the given images; overrides replace fields (undefined removes). */
export async function listingInput(
  mediaIds: readonly string[],
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    title: "مكتب دراسة خشبي",
    description: "مكتب بحالة جيدة مع درج واحد.\nالمقاس 120 في 60.",
    category_id: await categoryId(),
    condition: "good",
    location_id: null,
    price_minor: 35_000,
    is_negotiable: true,
    media_ids: [...mediaIds],
  };
  return Object.fromEntries(
    Object.entries({ ...base, ...overrides }).filter(([, value]) => value !== undefined),
  );
}

export function listingContext(db: AppDb, identity: Identity | null): ListingContext {
  return {
    db,
    supabaseUrl: inject("stack").apiUrl,
    traceId: trace(),
    identity: () => Promise.resolve(identity),
  };
}

/** API034's request, with Idempotency-Key unless it is null. */
export function publishRequest(body: unknown, key: string | null = randomUUID()): Request {
  const request = jsonRequest("/api/listings", body);
  if (key !== null) request.headers.set("idempotency-key", key);
  return request;
}

export function publish(
  db: AppDb,
  identity: Identity | null,
  body: unknown,
  key: string | null = randomUUID(),
): Promise<Published> {
  return publishListing(publishRequest(body, key), listingContext(db, identity));
}

/** What API034 answers: 201 or 200 with the listing, or the contract error. */
export function publishOutcome(
  db: AppDb,
  identity: Identity | null,
  body: unknown,
  key: string | null = randomUUID(),
): Promise<Outcome> {
  return outcome(async () => {
    const published = await publish(db, identity, body, key);
    return Response.json({ data: published.listing }, { status: published.created ? 201 : 200 });
  });
}

/** Runs one media.publish job with the worker's role (task 4.4: with the detached images). */
export async function runMediaPublish(
  listingId: string,
  storage: StorageFactory = realStorage,
  detachedMediaIds?: readonly string[],
): Promise<JobRun> {
  const logs = captureLogger();
  const pool = workerPool();
  const job = createMediaPublish(storage);
  try {
    const result = await job.run(
      job.payload.parse({
        listing_id: listingId,
        ...(detachedMediaIds === undefined ? {} : { detached_media_ids: [...detachedMediaIds] }),
      }),
      {
        jobId: "0",
        attempt: 1,
        idempotencyKey: `job:test-publish-${listingId}`,
        signal: new AbortController().signal,
        db: pool,
      },
    );
    return { result: result ?? {}, lines: logs.lines };
  } catch (error) {
    return { error, lines: logs.lines };
  } finally {
    await pool.end();
  }
}

/** The public URL of a variant, as lib/media/public.ts builds it. */
export function publicUrl(mediaId: string, variant: "w150" | "w600" | "w1200"): string {
  return `${inject("stack").apiUrl}/storage/v1/object/public/media-public/${mediaId}/${variant}.webp`;
}

/** The member's listings, as postgres sees them. */
export function listingCount(sellerId: string): Promise<string> {
  return scalar<string>(
    dbPool(),
    "select count(*)::text from public.listing where seller_id = $1",
    [sellerId],
  );
}

/** Lets a member publish again within the hour (RL05 counts every success). */
export async function resetRl05(memberId: string): Promise<void> {
  await dbPool().query(
    `delete from app.rate_limit_bucket
      where scope in ('RL05:hour', 'RL05:day') and key_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [memberId],
  );
}

/** Task 4.4: the contexts and outcomes of API033, API035 and API036 with the real server code. */
export function manageContext(db: AppDb, identity: Identity | null): MyListingsContext {
  return { ...listingContext(db, identity), appSecret: TEST_APP_SECRET };
}

function patchRequest(id: string, body: unknown): Request {
  const request = jsonRequest(`/api/listings/${id}`, body);
  return new Request(request, { method: "PATCH" });
}

/** API035: 200 with the listing, or the contract error. */
export function editOutcome(
  db: AppDb,
  identity: Identity | null,
  id: string,
  body: unknown,
): Promise<Outcome> {
  return outcome(async () =>
    Response.json({
      data: await updateListing(patchRequest(id, body), id, manageContext(db, identity)),
    }),
  );
}

/** API036: 200 with the listing, or the contract error. */
export function transitionOutcome(
  db: AppDb,
  identity: Identity | null,
  id: string,
  body: unknown,
): Promise<Outcome> {
  return outcome(async () =>
    Response.json({
      data: await transitionListing(
        jsonRequest(`/api/listings/${id}/transition`, body),
        id,
        manageContext(db, identity),
      ),
    }),
  );
}

/** API033 as the route reads its query. */
export function myListings(
  db: AppDb,
  identity: Identity | null,
  query: Record<string, string> = {},
): Promise<OwnerListingPage> {
  return readMyListings(manageContext(db, identity), myListingsRequest(new URLSearchParams(query)));
}

/** The listing as postgres sees it: the lifecycle columns and the version. */
export async function listingRow(id: string): Promise<Record<string, unknown>> {
  const result = await dbPool().query<Record<string, unknown>>(
    `select status::text as status, previous_status::text as previous_status,
            archive_reason::text as archive_reason, sold_at, archived_at, version,
            title, price_minor, created_at, updated_at
       from public.listing where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no listing ${id}`);
  return row;
}

/** The media.publish jobs queued for a listing, by dedupe key. */
export async function publishJobs(listingId: string): Promise<{ key: string; payload: unknown }[]> {
  const result = await dbPool().query<{ key: string; payload: unknown }>(
    `select dedupe_key as key, payload from app.job
      where kind = 'media.publish' and payload ->> 'listing_id' = $1 order by id`,
    [listingId],
  );
  return result.rows;
}

/** Lets a member edit again within the hour (DEC85 counts every successful edit). */
export async function resetDec85(memberId: string): Promise<void> {
  await dbPool().query(
    `delete from app.rate_limit_bucket
      where scope = 'DEC85:hour' and key_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [memberId],
  );
}
