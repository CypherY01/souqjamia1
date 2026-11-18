// API106: readiness of the required dependencies, for the hosting platform's probe only.
// Without the right X-Probe-Token the answer is 401 with no details.
import { serverEnv } from "../../lib/env";
import { ApiError } from "../../lib/http/errors";
import { apiHandler } from "../../lib/http/handler";
import { checkReadiness, PROBE_HEADER, probeTokenMatches } from "../../lib/http/readiness";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  "/readyz",
  async (request) => {
    const env = serverEnv();
    if (!probeTokenMatches(request.headers.get(PROBE_HEADER), env.PROBE_TOKEN)) {
      throw new ApiError("UNAUTHENTICATED");
    }
    const readiness = await checkReadiness(env);
    return Response.json(readiness, {
      status: readiness.status === "ready" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  },
  { log: false },
);
