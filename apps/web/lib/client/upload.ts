// Task 4.1 (FR17, FR61, FR80, SEC08): one image upload from the browser, as the screens of tasks
// 4.2, 4.7, 5.3 and 7.6 will run it.
//  1. checking: the browser's own reading of the file (type, size, pixels), so an image the
//     server would refuse is not sent at all. The server and the worker check again (SEC08).
//  2. API037 for a five-minute, create-only upload link, then a PUT of the file to it.
//  3. API038 with the file's SHA-256 and size, then API039 until the worker decides: ready (with a
//     60-second preview, none for a student card) or rejected with a safe reason.
// Every outcome is a distinct state (FR80): rejected (the image), failed (the network, the
// quota, the service), expired (the five minutes ran out), slow (no decision within a minute).
// Retrying is a new upload: the screen removes the old one with removeUpload (API040).
import { declaredImageProblem, enums } from "@souq/domain";
import { routes } from "../routes.ts";
import { api as defaultApi, type ApiClient, type ApiFailure } from "./api.ts";

export type UploadPhase =
  "checking" | "uploading" | "processing" | "ready" | "rejected" | "failed" | "expired";

export type UploadFailure = "network" | "slow" | "rateLimited" | "unavailable";

export interface UploadState {
  readonly phase: UploadPhase;
  readonly uploadId: string | null;
  readonly reason: enums.MediaRejectionReason | null;
  readonly failure: UploadFailure | null;
  /** Seconds to wait, for rateLimited. */
  readonly retryAfter: number | null;
  readonly previewUrl: string | null;
}

interface UploadAuthorization {
  upload_id: string;
  signed_url: string;
  token: string;
  expires_at: string;
}

interface Upload {
  id: string;
  status: enums.MediaStatus;
  rejection_reason: enums.MediaRejectionReason | null;
  preview: { url: string; expires_at: string } | null;
  expires_at: string | null;
}

export interface UploadDeps {
  readonly api: ApiClient;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The image's width and height as the browser decodes it, or null if it cannot. */
  readonly dimensions: (file: Blob) => Promise<{ width: number; height: number } | null>;
  readonly sha256: (file: Blob) => Promise<string>;
  readonly sleep: (ms: number) => Promise<void>;
}

/** API039 is asked every 1.5 seconds, for one minute at most. */
export const POLL_INTERVAL_MS = 1500;
export const POLL_LIMIT_MS = 60_000;

async function browserDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

async function browserSha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const browserUploadDeps: UploadDeps = {
  api: defaultApi,
  fetch: (input, init) => fetch(input, init),
  dimensions: browserDimensions,
  sha256: browserSha256,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const initial: UploadState = {
  phase: "checking",
  uploadId: null,
  reason: null,
  failure: null,
  retryAfter: null,
  previewUrl: null,
};

/** A refusal of API037 that names the image, as the worker would. */
function reasonOf(failure: ApiFailure): enums.MediaRejectionReason | null {
  if (failure.code !== "VALIDATION_FAILED") return null;
  for (const { field, code } of failure.fieldErrors) {
    if (field === "mime") return "unsupported_type";
    if (field === "bytes" && code === "too_big") return "too_large";
    if (code === "too_many_pixels" || code === "too_big") return "too_many_pixels";
  }
  return null;
}

function failureOf(failure: ApiFailure): Pick<UploadState, "failure" | "retryAfter"> {
  if (failure.code === "RATE_LIMITED") {
    return { failure: "rateLimited", retryAfter: failure.retryAfter };
  }
  if (failure.code === "SERVICE_UNAVAILABLE") return { failure: "unavailable", retryAfter: null };
  return { failure: "network", retryAfter: null };
}

export async function uploadImage(
  file: File,
  purpose: enums.MediaPurpose,
  onState: (state: UploadState) => void,
  deps: UploadDeps = browserUploadDeps,
): Promise<UploadState> {
  let state = initial;
  const set = (next: Partial<UploadState>): UploadState => {
    state = { ...state, ...next };
    onState(state);
    return state;
  };
  set({});

  // The type and the size first: no need to decode a file that is refused anyway.
  const early = declaredImageProblem({ bytes: file.size, mime: file.type, width: 1, height: 1 });
  if (early !== null) return set({ phase: "rejected", reason: early });
  const size = await deps.dimensions(file);
  if (size === null) return set({ phase: "rejected", reason: "corrupt" });
  const problem = declaredImageProblem({ bytes: file.size, mime: file.type, ...size });
  if (problem !== null) return set({ phase: "rejected", reason: problem });
  const checksum = await deps.sha256(file);

  set({ phase: "uploading" });
  const authorized = await deps.api.request<UploadAuthorization>(routes.api.uploadsAuthorize, {
    body: { purpose, bytes: file.size, mime: file.type, ...size },
  });
  if (!authorized.ok) {
    const reason = reasonOf(authorized);
    if (reason !== null) return set({ phase: "rejected", reason });
    return set({ phase: "failed", ...failureOf(authorized) });
  }
  const uploadId = authorized.data.upload_id;
  set({ uploadId });

  let put: Response;
  try {
    put = await deps.fetch(authorized.data.signed_url, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type, "x-upsert": "false" },
      credentials: "omit",
    });
  } catch {
    return set({ phase: "failed", failure: "network" });
  }
  if (!put.ok) {
    // Storage answers its own limits with 400 and the status in the body (413, 415).
    const text = await put.text().catch(() => "");
    if (/"statusCode"\s*:\s*"413"/.test(text))
      return set({ phase: "rejected", reason: "too_large" });
    if (/"statusCode"\s*:\s*"415"/.test(text)) {
      return set({ phase: "rejected", reason: "unsupported_type" });
    }
    return set({ phase: "failed", failure: "network" });
  }

  const completed = await deps.api.request<Upload>(routes.api.uploadComplete(uploadId), {
    body: { checksum_sha256: checksum, expected_size: file.size },
  });
  if (!completed.ok) {
    if (completed.code === "DEADLINE_PASSED") return set({ phase: "expired" });
    return set({ phase: "failed", ...failureOf(completed) });
  }

  set({ phase: "processing" });
  let upload = completed.data;
  for (let waited = 0; ; waited += POLL_INTERVAL_MS) {
    if (upload.status === "ready") {
      return set({ phase: "ready", previewUrl: upload.preview?.url ?? null });
    }
    if (upload.status === "rejected") {
      return set({ phase: "rejected", reason: upload.rejection_reason ?? "processing_failed" });
    }
    if (upload.status === "deleted") return set({ phase: "expired" });
    if (waited >= POLL_LIMIT_MS) return set({ phase: "failed", failure: "slow" });
    await deps.sleep(POLL_INTERVAL_MS);
    const polled = await deps.api.request<Upload>(routes.api.upload(uploadId), { method: "GET" });
    if (!polled.ok) return set({ phase: "failed", ...failureOf(polled) });
    upload = polled.data;
  }
}

/** API040: removes an unattached upload (before a retry, or when the member removes it). */
export async function removeUpload(
  uploadId: string,
  deps: Pick<UploadDeps, "api"> = browserUploadDeps,
): Promise<boolean> {
  const result = await deps.api.request(routes.api.upload(uploadId), { method: "DELETE" });
  return result.ok;
}

/**
 * Task 4.2 (FR21, FR60, TC33): the state of an upload this page did not start, such as one kept
 * in the tab's draft before a reload, or a ready one whose 60-second preview needs a new link.
 * API039 until the worker decides. An upload that is gone (deleted after its 24 hours, RET01),
 * past its expiry, or never sent before the reload (still pending) is expired: the member picks
 * the file again, and the text stays.
 */
export async function followUpload(
  uploadId: string,
  onState: (state: UploadState) => void,
  deps: Pick<UploadDeps, "api" | "sleep"> = browserUploadDeps,
  nowMs: () => number = Date.now,
): Promise<UploadState> {
  let state: UploadState = { ...initial, phase: "processing", uploadId };
  const set = (next: Partial<UploadState>): UploadState => {
    state = { ...state, ...next };
    onState(state);
    return state;
  };
  for (let waited = 0; ; waited += POLL_INTERVAL_MS) {
    const polled = await deps.api.request<Upload>(routes.api.upload(uploadId), { method: "GET" });
    if (!polled.ok) {
      if (polled.code === "NOT_FOUND") return set({ phase: "expired" });
      return set({ phase: "failed", ...failureOf(polled) });
    }
    const upload = polled.data;
    const expired = upload.expires_at !== null && Date.parse(upload.expires_at) <= nowMs();
    if (upload.status === "deleted" || upload.status === "pending" || expired) {
      return set({ phase: "expired" });
    }
    if (upload.status === "ready") {
      return set({ phase: "ready", previewUrl: upload.preview?.url ?? null });
    }
    if (upload.status === "rejected") {
      return set({ phase: "rejected", reason: upload.rejection_reason ?? "processing_failed" });
    }
    if (waited >= POLL_LIMIT_MS) return set({ phase: "failed", failure: "slow" });
    if (waited === 0) set({ phase: "processing" });
    await deps.sleep(POLL_INTERVAL_MS);
  }
}
