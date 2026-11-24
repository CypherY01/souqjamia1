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

/** Runs one media.publish job with the worker's role. */
export async function runMediaPublish(
  listingId: string,
  storage: StorageFactory = realStorage,
): Promise<JobRun> {
  const logs = captureLogger();
  const pool = workerPool();
  const job = createMediaPublish(storage);
  try {
    const result = await job.run(job.payload.parse({ listing_id: listingId }), {
      jobId: "0",
      attempt: 1,
      idempotencyKey: `job:test-publish-${listingId}`,
      signal: new AbortController().signal,
      db: pool,
    });
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
