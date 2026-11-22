// Task 3.8, items 2 and 4: Resend from cost stage 1 (POST https://api.resend.com/emails).
// DEC71: every request carries Idempotency-Key, the same for every attempt of the job. Resend
// keeps a key 24 hours and answers a repeat with the same body without sending again; the ten
// attempts of a job end within about 7.5 hours. Not called for real before cost stage 1
// (plan/cost-plan.md); tests/unit/resend-transport.test.ts runs it against a local fake.
import { errorNameOf, httpFailure, postJson, type EmailTransport } from "./transport.ts";

export const RESEND_API_URL = "https://api.resend.com";

export function createResendTransport(options: {
  apiKey: string;
  /** EMAIL_FROM as written: "Name <address>". */
  from: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): EmailTransport {
  const endpoint = new URL("/emails", options.baseUrl ?? RESEND_API_URL).toString();
  return {
    name: "resend",
    async send(email, signal) {
      const response = await postJson(
        endpoint,
        {
          authorization: `Bearer ${options.apiKey}`,
          "idempotency-key": email.idempotencyKey,
          "user-agent": "souq-worker",
        },
        {
          from: options.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        },
        signal,
        options.fetchImpl,
      );
      if (!response.ok) throw httpFailure(response.status, await errorNameOf(response));
      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      return { id: typeof body.id === "string" ? body.id : null };
    },
  };
}
