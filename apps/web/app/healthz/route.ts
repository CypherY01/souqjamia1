// API105: process liveness only, without secrets or dependency details (FR76).
// Dependency readiness is API106 (/readyz). Probes run often, so this is not logged.
import { apiHandler } from "../../lib/http/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  "/healthz",
  () => Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } }),
  { log: false },
);
