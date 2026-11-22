// Task 3.8 (items 1, 2 and 4): how email.send hands one email to a provider. Two transports over
// HTTP with fetch: Mailpit locally and in CI, Resend from cost stage 1 (DEC62). No library.
// Never put an address, a subject or a body in an error or a log line.
import { PermanentJobError } from "../job.ts";

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** DEC71, item 4: the same for every attempt of the job. */
  readonly idempotencyKey: string;
}

export interface SentEmail {
  /** The provider's message id, for the log. */
  readonly id: string | null;
}

export interface EmailTransport {
  readonly name: "mailpit" | "resend";
  send(email: OutgoingEmail, signal: AbortSignal): Promise<SentEmail>;
}

/** One request to a provider gives up after this long; the job retries (item 3 of the plan). */
export const SEND_TIMEOUT_MS = 10_000;

/** A failure a later attempt may fix: the job is retried after 1, 5, 15, then 60 minutes. */
export class EmailSendError extends Error {
  override name = "EmailSendError";
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/**
 * Item 3: 429, 5xx, a wrong key (401, 403) and a concurrent request with the same idempotency
 * key are temporary; any other 4xx, the reuse of a key with another body (409) included, is
 * permanent and the job is dead at once (job.dead).
 */
export function httpFailure(status: number, errorName: string | null): Error {
  const code = `EMAIL_HTTP_${String(status)}`;
  if (status === 409 && errorName === "concurrent_idempotent_requests") {
    return new EmailSendError("EMAIL_HTTP_409_CONCURRENT");
  }
  if (status === 429 || status >= 500 || status === 401 || status === 403) {
    return new EmailSendError(code);
  }
  return new PermanentJobError(code);
}

/** POST a JSON body within SEND_TIMEOUT_MS. A stop or timeout of the job itself is rethrown. */
export async function postJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout]),
      redirect: "error",
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    if (timeout.aborted) throw new EmailSendError("EMAIL_TIMEOUT");
    throw new EmailSendError("EMAIL_NETWORK");
  }
}

/** The provider's error name from a JSON error body, if any (never logged with the body). */
export async function errorNameOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { name?: unknown };
    return typeof body.name === "string" ? body.name : null;
  } catch {
    return null;
  }
}
