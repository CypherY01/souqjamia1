// API038 (task 4.1, FR61, SEC08, DEC83): the owner announces the uploaded bytes; the worker then
// checks them. The logic is in lib/media/uploads.ts.
import { appDb } from "../../../../../lib/db/app-client";
import { serverEnv } from "../../../../../lib/env";
import { apiHandler } from "../../../../../lib/http/handler";
import { accepted } from "../../../../../lib/http/respond";
import { mediaSigner } from "../../../../../lib/media/storage";
import { completeUpload } from "../../../../../lib/media/uploads";

export const dynamic = "force-dynamic";

export const POST = apiHandler<{ params: Promise<{ id: string }> }>(
  "/api/uploads/[id]/complete",
  async (request, context, api) => {
    const { id } = await context.params;
    const upload = await completeUpload(request, id, {
      db: appDb(),
      signer: mediaSigner(serverEnv()),
      traceId: api.traceId,
      identity: () => api.identity(),
    });
    return accepted(upload);
  },
);
