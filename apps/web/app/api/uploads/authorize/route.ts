// API037 (task 4.1, FR17, FR61, SEC08, RL09): a five-minute, create-only upload to the quarantine
// bucket. The logic is in lib/media/uploads.ts.
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";
import { created } from "../../../../lib/http/respond";
import { mediaSigner } from "../../../../lib/media/storage";
import { authorizeUpload } from "../../../../lib/media/uploads";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/uploads/authorize", async (request, _context, api) => {
  const authorization = await authorizeUpload(request, {
    db: appDb(),
    signer: mediaSigner(serverEnv()),
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return created(authorization);
});
