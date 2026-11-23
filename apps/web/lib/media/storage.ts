// Task 4.1 (SEC08, BR26): the server's signed links to Supabase Storage, with the secret key
// (SUPABASE_SECRET_KEY, server-only: never NEXT_PUBLIC_, and pnpm check:bundle fails if it
// reaches a browser file). The database decides who may upload or see what; this module only
// signs, after that decision.
//  - An upload link: create-only (no upsert) to one quarantine path. Storage's token lives two
//    hours whatever we ask (DEC83); our five minutes are enforced by API038.
//  - A preview link: 60 seconds at most (BR26).
// A call that does not answer within 10 seconds fails (SERVICE_UNAVAILABLE for the route).
import { createClient } from "@supabase/supabase-js";
import { MEDIA_BUCKETS, PRIVATE_LINK_SECONDS } from "@souq/domain";

export const STORAGE_TIMEOUT_MS = 10_000;

export interface SignedUpload {
  readonly signedUrl: string;
  readonly token: string;
}

export interface SignedLink {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface MediaSigner {
  signUpload(objectName: string): Promise<SignedUpload>;
  signPrivate(objectKey: string, nowMs?: number): Promise<SignedLink>;
}

export interface StorageConfig {
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly SUPABASE_SECRET_KEY: string;
}

export class StorageUnavailableError extends Error {
  override name = "StorageUnavailableError";
}

function timedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
  const own = init?.signal ?? null;
  return fetch(input, {
    ...init,
    signal: own === null ? timeout : AbortSignal.any([own, timeout]),
  });
}

export function createMediaSigner(config: StorageConfig): MediaSigner {
  const client = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
  return {
    async signUpload(objectName) {
      const { data, error } = await client.storage
        .from(MEDIA_BUCKETS.quarantine)
        .createSignedUploadUrl(objectName, { upsert: false });
      if (error !== null) throw new StorageUnavailableError("upload link failed");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async signPrivate(objectKey, nowMs = Date.now()) {
      const expiresAt = new Date(nowMs + PRIVATE_LINK_SECONDS * 1000);
      const { data, error } = await client.storage
        .from(MEDIA_BUCKETS.private)
        .createSignedUrl(objectKey, PRIVATE_LINK_SECONDS);
      if (error !== null) throw new StorageUnavailableError("private link failed");
      return { url: data.signedUrl, expiresAt };
    },
  };
}

let cached: MediaSigner | undefined;

/** One client per process. */
export function mediaSigner(config: StorageConfig): MediaSigner {
  cached ??= createMediaSigner(config);
  return cached;
}
