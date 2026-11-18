// API105: process liveness only, without secrets or dependency details (FR76).
// Dependency readiness is API106 (/readyz) in task 1.6.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
