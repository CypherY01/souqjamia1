// API119 (DEC69): the session's member acknowledges the current terms and privacy versions
// (task 3.2, item 4). Session access level: any account state, never a limited session. The
// page that asks for it when the versions change comes with task 7.8.
import { z } from "zod";
import { requireSession } from "../../../../lib/auth/guards";
import { acknowledgePolicies } from "../../../../lib/auth/policies";
import { appDb } from "../../../../lib/db/app-client";
import { readJson } from "../../../../lib/http/body";
import { apiHandler } from "../../../../lib/http/handler";
import { noContent } from "../../../../lib/http/respond";

export const dynamic = "force-dynamic";

const PolicyAcknowledgmentBody = z.strictObject({
  terms_version: z.string().min(1),
  privacy_version: z.string().min(1),
  accept_terms: z.literal(true),
  acknowledge_privacy: z.literal(true),
});

export const POST = apiHandler("/api/me/policy-acknowledgments", async (request, _context, api) => {
  const { identity } = await requireSession(api);
  const input = await readJson(request, PolicyAcknowledgmentBody);
  await acknowledgePolicies(appDb(), identity.claims, api.traceId, input);
  return noContent();
});
