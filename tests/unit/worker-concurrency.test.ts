// Task 4.1 (SEC08, item 7): a kind with its own concurrency (image.process, two at a time) is
// claimed on its own, for its free slots only, and the other kinds share the loop's other slots.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ClaimedJob, JobStore } from "../../apps/worker/src/db.ts";
import { defineJob } from "../../apps/worker/src/job.ts";
import { IMAGE_CONCURRENCY, imageProcess } from "../../apps/worker/src/jobs/image.process.ts";
import { startJobLoop } from "../../apps/worker/src/loop.ts";
import { createRegistry, registry } from "../../apps/worker/src/registry.ts";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("item 7: per-kind concurrency in the job loop", () => {
  it("image.process runs two at a time (SEC08)", () => {
    expect(IMAGE_CONCURRENCY).toBe(2);
    expect(imageProcess.concurrency).toBe(2);
    expect(registry.get("image.process")?.concurrency).toBe(2);
    expect(registry.get("email.send")?.concurrency).toBeUndefined();
  });

  it("refuses a concurrency that is not a positive integer", () => {
    for (const concurrency of [0, -1, 1.5]) {
      expect(() =>
        defineJob({
          kind: "test.bad",
          payload: z.strictObject({}),
          concurrency,
          run: () => Promise.resolve(undefined),
        }),
      ).toThrow("concurrency must be a positive integer");
    }
  });

  it("claims the limited kind for its free slots only, and the others with the rest", async () => {
    const release = deferred();
    const limited = defineJob({
      kind: "test.limited",
      payload: z.strictObject({}),
      concurrency: 2,
      run: async () => {
        await release.promise;
        return undefined;
      },
    });
    const shared = defineJob({
      kind: "test.shared",
      payload: z.strictObject({}),
      run: async () => {
        await release.promise;
        return undefined;
      },
    });
    const claims: { kinds: string[]; limit: number }[] = [];
    let next = 0;
    const store: JobStore = {
      claim: (kinds, limit) => {
        claims.push({ kinds: [...kinds], limit });
        // Always more queued than asked for.
        const jobs: ClaimedJob[] = Array.from({ length: limit }, () => ({
          id: String((next += 1)),
          kind: kinds[0] ?? "",
          payload: {},
          attempt: 1,
          maxAttempts: 10,
        }));
        return Promise.resolve(jobs);
      },
      complete: () => Promise.resolve(true),
      fail: () => Promise.resolve(null),
      reapExpired: () => Promise.resolve([]),
      schedule: () => Promise.resolve(""),
    };
    const loop = startJobLoop({
      store,
      registry: createRegistry([limited, shared]),
      db: { query: () => Promise.reject(new Error("unused")) },
      logger: silent,
      concurrency: 4,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loop.active).toBe(4);
    expect(claims[0]).toEqual({ kinds: ["test.limited"], limit: 2 });
    expect(claims[1]).toEqual({ kinds: ["test.shared"], limit: 2 });
    release.resolve();
    await loop.stop(1000);
  });
});
