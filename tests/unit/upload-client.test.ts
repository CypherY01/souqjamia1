// Task 4.1 (FR80): the browser's upload flow (apps/web/lib/client/upload.ts) with fake services:
// every outcome is its own state, and an image the server would refuse is never sent.
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiResult } from "../../apps/web/lib/client/api.ts";
import {
  POLL_INTERVAL_MS,
  POLL_LIMIT_MS,
  uploadImage,
  type UploadDeps,
  type UploadState,
} from "../../apps/web/lib/client/upload.ts";

type Answer = ApiResult<unknown>;

function success(data: unknown, status = 200): Answer {
  return { ok: true, status, data, location: null };
}

function failure(status: number, code: string, extra: Partial<Answer> = {}): Answer {
  return {
    ok: false,
    status,
    code: code as never,
    fieldErrors: [],
    retryAfter: null,
    traceId: null,
    ...extra,
  } as Answer;
}

const authorization = {
  upload_id: "11111111-1111-4111-8111-111111111111",
  signed_url: "http://127.0.0.1:54321/storage/v1/object/upload/sign/quarantine/x?token=t",
  token: "t",
  expires_at: "2026-11-23T10:05:00.000Z",
};

function upload(status: string, extra: Record<string, unknown> = {}) {
  return { id: authorization.upload_id, status, rejection_reason: null, preview: null, ...extra };
}

interface Fake {
  deps: UploadDeps;
  calls: string[];
  put: ReturnType<typeof vi.fn>;
}

function fake(
  answers: Record<string, Answer[]>,
  put: () => Promise<Response> = () => Promise.resolve(new Response("{}")),
): Fake {
  const calls: string[] = [];
  const api: ApiClient = {
    request: (path: string, init?: { method?: string }) => {
      const key = `${init?.method ?? "POST"} ${path}`;
      calls.push(key);
      const queue = answers[key] ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve((next ?? failure(500, "INTERNAL_ERROR")) as never);
    },
    resetCsrfToken: () => undefined,
  };
  const putFn = vi.fn(put);
  return {
    calls,
    put: putFn,
    deps: {
      api,
      fetch: putFn,
      dimensions: () => Promise.resolve({ width: 40, height: 30 }),
      sha256: () => Promise.resolve("a".repeat(64)),
      sleep: () => Promise.resolve(),
    },
  };
}

const AUTHORIZE = "POST /api/uploads/authorize";
const COMPLETE = `POST /api/uploads/${authorization.upload_id}/complete`;
const STATUS = `GET /api/uploads/${authorization.upload_id}`;

function file(type = "image/jpeg", size = 1000): File {
  return new File([new Uint8Array(size)], "صورة.jpg", { type });
}

async function run(f: Fake, input = file()) {
  const states: UploadState[] = [];
  const last = await uploadImage(input, "listing", (state) => states.push(state), f.deps);
  return { last, phases: states.map((state) => state.phase) };
}

describe("FR80: the upload states", () => {
  it("checking, uploading, processing, then ready with the preview", async () => {
    const f = fake({
      [AUTHORIZE]: [success(authorization, 201)],
      [COMPLETE]: [success(upload("uploaded"), 202)],
      [STATUS]: [
        success(upload("processing")),
        success(upload("ready", { preview: { url: "http://x/p", expires_at: "z" } })),
      ],
    });
    const { last, phases } = await run(f);
    expect(last).toMatchObject({
      phase: "ready",
      previewUrl: "http://x/p",
      uploadId: authorization.upload_id,
    });
    expect([...new Set(phases)]).toEqual(["checking", "uploading", "processing", "ready"]);
    const [, init] = f.put.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ "content-type": "image/jpeg", "x-upsert": "false" });
    expect(init.credentials).toBe("omit");
  });

  it("an image the server would refuse is never sent", async () => {
    for (const [input, reason] of [
      [file("image/gif"), "unsupported_type"],
      [file("image/jpeg", 5_242_881), "too_large"],
    ] as const) {
      const f = fake({});
      const { last } = await run(f, input);
      expect(last).toMatchObject({ phase: "rejected", reason });
      expect(f.calls).toEqual([]);
      expect(f.put).not.toHaveBeenCalled();
    }
    const f = fake({});
    f.deps = { ...f.deps, dimensions: () => Promise.resolve({ width: 6000, height: 4001 }) };
    expect((await run(f)).last).toMatchObject({ phase: "rejected", reason: "too_many_pixels" });
    const unreadable = fake({});
    unreadable.deps = { ...unreadable.deps, dimensions: () => Promise.resolve(null) };
    expect((await run(unreadable)).last).toMatchObject({ phase: "rejected", reason: "corrupt" });
  });

  it("the worker's rejection comes back with its safe reason", async () => {
    const f = fake({
      [AUTHORIZE]: [success(authorization, 201)],
      [COMPLETE]: [success(upload("uploaded"), 202)],
      [STATUS]: [success(upload("rejected", { rejection_reason: "animated" }))],
    });
    expect((await run(f)).last).toMatchObject({ phase: "rejected", reason: "animated" });
  });

  it("RL09: a quota refusal is a failure with the wait, not a rejected image", async () => {
    const f = fake({ [AUTHORIZE]: [failure(429, "RATE_LIMITED", { retryAfter: 600 })] });
    expect((await run(f)).last).toMatchObject({
      phase: "failed",
      failure: "rateLimited",
      retryAfter: 600,
    });
    const down = fake({ [AUTHORIZE]: [failure(503, "SERVICE_UNAVAILABLE")] });
    expect((await run(down)).last).toMatchObject({ phase: "failed", failure: "unavailable" });
  });

  it("a declared value the server refuses becomes the matching reason", async () => {
    const f = fake({
      [AUTHORIZE]: [
        failure(422, "VALIDATION_FAILED", {
          fieldErrors: [{ field: "width", code: "too_many_pixels" }],
        }),
      ],
    });
    expect((await run(f)).last).toMatchObject({ phase: "rejected", reason: "too_many_pixels" });
  });

  it("Storage's own refusals and a lost connection are told apart", async () => {
    const big = fake({ [AUTHORIZE]: [success(authorization, 201)] }, () =>
      Promise.resolve(new Response('{"statusCode":"413"}', { status: 400 })),
    );
    expect((await run(big)).last).toMatchObject({ phase: "rejected", reason: "too_large" });
    const lost = fake({ [AUTHORIZE]: [success(authorization, 201)] }, () =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect((await run(lost)).last).toMatchObject({ phase: "failed", failure: "network" });
  });

  it("DEC83 an announcement after the five minutes is expired", async () => {
    const f = fake({
      [AUTHORIZE]: [success(authorization, 201)],
      [COMPLETE]: [failure(422, "DEADLINE_PASSED")],
    });
    expect((await run(f)).last).toMatchObject({ phase: "expired" });
  });

  it("no decision within a minute is slow, after polling every 1.5 seconds", async () => {
    const f = fake({
      [AUTHORIZE]: [success(authorization, 201)],
      [COMPLETE]: [success(upload("uploaded"), 202)],
      [STATUS]: [success(upload("processing"))],
    });
    const { last } = await run(f);
    expect(last).toMatchObject({ phase: "failed", failure: "slow" });
    expect(f.calls.filter((call) => call === STATUS)).toHaveLength(
      POLL_LIMIT_MS / POLL_INTERVAL_MS,
    );
  });
});
