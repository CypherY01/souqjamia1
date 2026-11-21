// API015 (task 3.5, DEC58): the private account fields of any live ordinary session, including
// an unconfirmed or restricted account, so it can show its state. A limited session is refused
// (DEC73). app.me() checks the live session itself, so the guard here does not read the database.
import { loadAccount } from "../../../lib/account/me";
import { requireIdentity } from "../../../lib/auth/guards";
import { appDb } from "../../../lib/db/app-client";
import { apiHandler } from "../../../lib/http/handler";
import { ok } from "../../../lib/http/respond";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/me", async (_request, _context, api) => {
  const identity = await requireIdentity(api);
  const { me } = await loadAccount(appDb(), identity, api.traceId);
  return ok(me);
});
