// API114: the policy versions in force (task 3.2, item 4). Public; 503 while a policy type has
// no published version.
import { currentPolicies } from "../../../../lib/auth/policies";
import { appDb } from "../../../../lib/db/app-client";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/policies/current", async (_request, _context, api) =>
  ok(await currentPolicies(appDb(), api.traceId)),
);
