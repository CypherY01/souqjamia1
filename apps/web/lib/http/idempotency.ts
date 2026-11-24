// BR32, NFR09 (task 4.2): the Idempotency-Key header of a creation (contracts/README.md). A UUID
// the browser makes once per logical request and sends again with every retry, so the database
// returns the first result instead of creating twice (app.idempotency_claim). Absent or
// malformed: 400 BAD_REQUEST, with the header's name as the field.
import { ApiError } from "./errors.ts";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const FIELD = "Idempotency-Key";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request's key, lower case. */
export function idempotencyKey(request: Request): string {
  const value = request.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (value === "") {
    throw new ApiError("BAD_REQUEST", { fieldErrors: [{ field: FIELD, code: "required" }] });
  }
  if (!UUID.test(value)) {
    throw new ApiError("BAD_REQUEST", { fieldErrors: [{ field: FIELD, code: "invalid_format" }] });
  }
  return value.toLowerCase();
}
