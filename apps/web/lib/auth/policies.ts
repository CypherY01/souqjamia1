// Policy versions and colleges for the signup page and the server (task 3.2, item 4): API114,
// API119 (DEC69) and the college pick list. Reads go through app entry points for souq_web,
// like app.session_context() in task 3.1. Framework-free, so integration tests run it as is.
import type { AppDb } from "../db/app-client.ts";
import { ApiError } from "../http/errors.ts";

export interface PolicyVersion {
  version: string;
  effective_at: string;
  path: string;
}

/** API114: the version in force of each policy type (the contract's PolicyVersions). */
export interface CurrentPolicies {
  terms: PolicyVersion;
  privacy: PolicyVersion;
}

export interface College {
  id: string;
  key: string;
  label_ar: string;
  label_en: string | null;
}

interface PolicyRow {
  policy_type: string;
  version: string;
  effective_at: Date;
  path: string;
}

function toVersion(row: PolicyRow | undefined): PolicyVersion | null {
  if (row === undefined) return null;
  return { version: row.version, effective_at: row.effective_at.toISOString(), path: row.path };
}

/** The versions in force. 503 while a policy type has no published version (no signup then). */
export async function currentPolicies(db: AppDb, traceId: string): Promise<CurrentPolicies> {
  const rows = await db.withActor(null, traceId, async (tx) => {
    const result = await tx.query<PolicyRow>("select * from app.current_policies()");
    return result.rows;
  });
  const terms = toVersion(rows.find((row) => row.policy_type === "terms"));
  const privacy = toVersion(rows.find((row) => row.policy_type === "privacy"));
  if (terms === null || privacy === null) {
    throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 60 });
  }
  return { terms, privacy };
}

/** Active colleges in display order, for the signup page. */
export function activeColleges(db: AppDb, traceId: string): Promise<College[]> {
  return db.withActor(null, traceId, async (tx) => {
    const result = await tx.query<College>("select * from app.active_colleges()");
    return result.rows;
  });
}

/** API119: the session's member acknowledges the current versions. STATE_CONFLICT otherwise. */
export async function acknowledgePolicies(
  db: AppDb,
  claims: Readonly<Record<string, unknown>>,
  traceId: string,
  versions: { terms_version: string; privacy_version: string },
): Promise<void> {
  await db.withActor(claims, traceId, (tx) =>
    tx.query("select app.acknowledge_policies($1, $2)", [
      versions.terms_version,
      versions.privacy_version,
    ]),
  );
}
