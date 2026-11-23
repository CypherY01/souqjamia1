// Task 4.1 (plan/task-4.1.md, item 4): SEC08, BR26. No bucket is reachable directly, by a guest
// or a member's own session: only the signed links the server issues after its own checks.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { privateObjectKey } from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { png } from "../fixtures/images/index.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { assertRan, assetRow, runImageProcess, uploadImage } from "./_harness/storage.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();
let member: TestMember;
let identity: Identity;
let mediaId: string;
let rawKey: string;

beforeAll(async () => {
  member = await signUpMember();
  identity = (await memberIdentity(member)).identity;
  const { id } = await uploadImage(db, identity, await png(), "image/png", {
    width: 40,
    height: 30,
  });
  const run = await runImageProcess(id);
  assertRan(run);
  mediaId = id;
  rawKey = String((await assetRow(id))?.quarantine_key);
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

/** A Storage request as the browser could send it: the publishable key, and a session or not. */
function storage(
  path: string,
  init: { method?: string; token?: string; body?: BodyInit; type?: string } = {},
) {
  const stack = inject("stack");
  return fetch(`${stack.apiUrl}/storage/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: stack.publishableKey,
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
      ...(init.type === undefined ? {} : { "content-type": init.type }),
    },
    body: init.body,
  });
}

async function listed(bucket: string, token?: string): Promise<unknown[]> {
  const response = await storage(`/object/list/${bucket}`, {
    method: "POST",
    token,
    type: "application/json",
    body: JSON.stringify({ prefix: "", limit: 100 }),
  });
  if (!response.ok) return [];
  return (await response.json()) as unknown[];
}

describe("SEC08: no direct access to any bucket", () => {
  it("SEC08 no policy on Storage's tables opens a bucket", async () => {
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from pg_policies where schemaname = 'storage'",
      ),
    ).toBe("0");
    expect(
      await scalar<boolean>(
        dbPool(),
        "select relrowsecurity from pg_class where oid = 'storage.objects'::regclass",
      ),
    ).toBe(true);
  });

  for (const who of ["guest", "member"] as const) {
    it(`SEC08 a ${who} lists, reads, writes and deletes nothing in any bucket`, async () => {
      const token = who === "member" ? member.accessToken : undefined;
      for (const bucket of ["quarantine", "media-private", "media-public"]) {
        expect(await listed(bucket, token)).toEqual([]);
      }
      const raw = await storage(`/object/quarantine/${rawKey}`, { token });
      expect(raw.ok).toBe(false);
      const master = await storage(`/object/media-private/${privateObjectKey(mediaId, "master")}`, {
        token,
      });
      expect(master.ok).toBe(false);
      const authenticatedRaw = await storage(`/object/authenticated/quarantine/${rawKey}`, {
        token,
      });
      expect(authenticatedRaw.ok).toBe(false);
      const publicRaw = await storage(`/object/public/quarantine/${rawKey}`, { token });
      expect(publicRaw.ok).toBe(false);
      for (const bucket of ["quarantine", "media-private", "media-public"]) {
        const write = await storage(`/object/${bucket}/${who}-probe.webp`, {
          method: "POST",
          token,
          type: "image/webp",
          body: new Uint8Array([1, 2, 3]),
        });
        expect(write.ok).toBe(false);
      }
      const remove = await storage(`/object/quarantine/${rawKey}`, { method: "DELETE", token });
      expect(remove.ok).toBe(false);
      expect(
        await scalar<boolean>(
          dbPool(),
          "select exists (select 1 from storage.objects where bucket_id = 'quarantine' and name = $1)",
          [rawKey],
        ),
      ).toBe(true);
    });
  }

  it("SEC08 the raw upload is never public, and nothing is public in task 4.1", async () => {
    const publicCopy = await storage(`/object/public/media-public/${rawKey}`);
    expect(publicCopy.ok).toBe(false);
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from public.media_derivative where media_id = $1 and visibility = 'public'",
        [mediaId],
      ),
    ).toBe("0");
  });
});
