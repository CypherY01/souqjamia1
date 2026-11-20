// Messages for the auth forms (task 3.2): a field error code from the contract to its Arabic text,
// and the alert for a failed request. Field codes come from the server (and the same rules run
// in the browser first); an unknown code falls back to a general line, never the code itself.
import { messages, t, type MessageKey } from "@souq/i18n";
import { Alert } from "../ui/Alert";
import type { ApiFailure } from "../../lib/client/api";

/** The contract's field name to its group in auth.fields. */
const FIELD_GROUP: Readonly<Record<string, string>> = {
  name: "name",
  email: "email",
  password: "password",
  // Task 3.4: API008's field, with the same rules (DEC32) and same_password.
  new_password: "password",
  college_id: "college",
  accept_terms: "terms",
  acknowledge_privacy: "privacy",
};

export function fieldMessage(field: string, code: string): string {
  const group = FIELD_GROUP[field];
  const groups = messages.auth.fields as unknown as Record<string, Record<string, string>>;
  const text = group === undefined ? undefined : groups[group]?.[code];
  return text ?? t("auth.fields.fallback");
}

/** The text of a failed request: the wait for 429, the network, else the contract message. */
export function failureText(failure: ApiFailure): string {
  if (failure.code === "NETWORK") return t("auth.errors.network");
  if (failure.code === "RATE_LIMITED" && failure.retryAfter !== null) {
    return t("auth.errors.rateLimited", { seconds: failure.retryAfter });
  }
  const key = `errors.api.${failure.code}` as MessageKey;
  try {
    return t(key);
  } catch {
    return t("errors.api.INTERNAL_ERROR");
  }
}

/** A failed request as an alert, with the trace id for an unexpected error (task 1.6). */
export function FailureAlert({ title, failure }: { title: string; failure: ApiFailure }) {
  return (
    <Alert variant="danger" title={title} live>
      <p>{failureText(failure)}</p>
      {failure.code === "INTERNAL_ERROR" && failure.traceId !== null && (
        <p>
          {t("auth.errors.traceId")} <bdi dir="ltr">{failure.traceId}</bdi>
        </p>
      )}
    </Alert>
  );
}
