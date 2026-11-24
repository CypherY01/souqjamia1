// Task 4.1 (SEC08): the worker's access to Supabase Storage, with the secret key (server-only,
// never in a browser bundle). Every call stops at the job's signal or after 10 seconds, so a job
// never hangs on Storage. A file that is not there is no error for download (null) or remove
// (DEC71: a repeated cleanup removes nothing more).
import { createClient } from "@supabase/supabase-js";
import { loadWorkerEnv } from "../env.ts";

export const STORAGE_TIMEOUT_MS = 10_000;

export interface MediaStorage {
  /** The object's bytes, or null when there is no such object. */
  download(bucket: string, key: string): Promise<Buffer | null>;
  /** Writes the object, replacing a file a previous attempt of the same job wrote (DEC71). */
  upload(bucket: string, key: string, data: Buffer, contentType: string): Promise<void>;
  /** Removes the objects; missing ones are not an error. */
  remove(bucket: string, keys: readonly string[]): Promise<void>;
  /**
   * Task 4.2 (SEC08): copies an object to another bucket inside Storage, with its metadata
   * (type and Cache-Control). A destination already there is a copy a previous attempt made from
   * the same fixed key (DEC71), not an error.
   */
  copy(fromBucket: string, key: string, toBucket: string, toKey: string): Promise<void>;
}

export interface StorageSettings {
  readonly url: string;
  readonly secretKey: string;
}

export class StorageError extends Error {
  override name = "StorageError";
  readonly code = "STORAGE_FAILED";
}

/** Storage answers an existing destination with statusCode "409" ("The resource already exists"). */
function isAlreadyThere(error: Error): boolean {
  const { status, statusCode } = error as { status?: number; statusCode?: string };
  return status === 409 || statusCode === "409" || /already exists|duplicate/i.test(error.message);
}

/** Storage answers a missing object with 400 and statusCode "404" ("Object not found"). */
function isNotFound(error: Error): boolean {
  const { status, statusCode } = error as { status?: number; statusCode?: string };
  return status === 404 || statusCode === "404" || /not found/i.test(error.message);
}

export function createMediaStorage(settings: StorageSettings, signal: AbortSignal): MediaStorage {
  const timedFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signals = [signal, AbortSignal.timeout(STORAGE_TIMEOUT_MS)];
    if (init?.signal) signals.push(init.signal);
    return fetch(input, { ...init, signal: AbortSignal.any(signals) });
  };
  const client = createClient(settings.url, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
  return {
    async download(bucket, key) {
      const { data, error } = await client.storage.from(bucket).download(key);
      if (error !== null) {
        if (isNotFound(error)) return null;
        throw new StorageError("download failed");
      }
      return Buffer.from(await data.arrayBuffer());
    },
    async upload(bucket, key, data, contentType) {
      const { error } = await client.storage
        .from(bucket)
        .upload(key, data, { contentType, upsert: true, cacheControl: "3600" });
      if (error !== null) throw new StorageError("upload failed");
    },
    async remove(bucket, keys) {
      if (keys.length === 0) return;
      const { error } = await client.storage.from(bucket).remove([...keys]);
      if (error !== null) throw new StorageError("remove failed");
    },
    async copy(fromBucket, key, toBucket, toKey) {
      const { error } = await client.storage
        .from(fromBucket)
        .copy(key, toKey, { destinationBucket: toBucket });
      if (error !== null && !isAlreadyThere(error)) throw new StorageError("copy failed");
    },
  };
}

let cached: StorageSettings | undefined;

/** Read once per process; main.ts validated the same variables at start-up (OPS05). */
export function storageSettings(): StorageSettings {
  if (cached === undefined) {
    const env = loadWorkerEnv();
    cached = { url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY };
  }
  return cached;
}
