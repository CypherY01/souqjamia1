// Task 3.8, item 1: local development and CI send through Mailpit's HTTP API
// (POST /api/v1/send on the web port 54324 that local Supabase already exposes), so config.toml
// and the SMTP port stay as they are. Checked against Mailpit v1.31.3 of the local stack.
// Mailpit has no idempotency: an attempt that sent and then stopped before the job was marked
// done sends again locally only. The key is kept as a header, so tests can read it.
import type { FromAddress } from "../env.ts";
import { errorNameOf, httpFailure, postJson, type EmailTransport } from "./transport.ts";

export const IDEMPOTENCY_HEADER = "X-Souq-Idempotency-Key";

export function createMailpitTransport(options: {
  url: string;
  from: FromAddress;
  fetchImpl?: typeof fetch;
}): EmailTransport {
  const endpoint = new URL("/api/v1/send", options.url).toString();
  return {
    name: "mailpit",
    async send(email, signal) {
      const response = await postJson(
        endpoint,
        {},
        {
          From: { Email: options.from.email, Name: options.from.name ?? "" },
          To: [{ Email: email.to }],
          Subject: email.subject,
          HTML: email.html,
          Text: email.text,
          Headers: { [IDEMPOTENCY_HEADER]: email.idempotencyKey },
        },
        signal,
        options.fetchImpl,
      );
      if (!response.ok) throw httpFailure(response.status, await errorNameOf(response));
      const body = (await response.json().catch(() => ({}))) as { ID?: unknown };
      return { id: typeof body.ID === "string" ? body.ID : null };
    },
  };
}
