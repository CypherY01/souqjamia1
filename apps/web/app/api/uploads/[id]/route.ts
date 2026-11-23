// API039 and API040 (task 4.1, FR61, FR73, FR80): the owner's upload state, and removing an
// unattached upload. The logic is in lib/media/uploads.ts.
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";
import { noContent, ok } from "../../../../lib/http/respond";
import { mediaSigner } from "../../../../lib/media/storage";
import { deleteUpload, getUpload } from "../../../../lib/media/uploads";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>("/api/uploads/[id]", async (_request, context, api) => {
  const { id } = await context.params;
  const upload = await getUpload(id, {
    db: appDb(),
    signer: mediaSigner(serverEnv()),
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return ok(upload);
});

export const DELETE = apiHandler<Context>("/api/uploads/[id]", async (_request, context, api) => {
  const { id } = await context.params;
  await deleteUpload(id, {
    db: appDb(),
    signer: mediaSigner(serverEnv()),
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return noContent();
});
