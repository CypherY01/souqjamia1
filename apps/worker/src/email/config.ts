// Task 3.8: the transport and the email settings, from the validated worker configuration.
import { loadWorkerEnv, parseFromAddress, type WorkerEnv } from "../env.ts";
import { createMailpitTransport } from "./mailpit.ts";
import { createResendTransport } from "./resend.ts";
import type { EmailTransport } from "./transport.ts";

export interface EmailSettings {
  readonly transport: EmailTransport;
  readonly origin: string;
  readonly contactEmail: string;
}

export function emailSettingsFrom(env: WorkerEnv): EmailSettings {
  const from = parseFromAddress(env.EMAIL_FROM);
  if (from === null) throw new Error("EMAIL_FROM is invalid");
  let transport: EmailTransport;
  if (env.EMAIL_TRANSPORT === "mailpit") {
    if (env.MAILPIT_URL === undefined) throw new Error("MAILPIT_URL is required");
    transport = createMailpitTransport({ url: env.MAILPIT_URL, from });
  } else {
    if (env.RESEND_API_KEY === undefined) throw new Error("RESEND_API_KEY is required");
    transport = createResendTransport({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  return { transport, origin: env.APP_ORIGIN, contactEmail: env.CONTACT_EMAIL };
}

let cached: EmailSettings | undefined;

/** Read once per process; main.ts validated the same variables at start-up (OPS05). */
export function emailSettings(): EmailSettings {
  cached ??= emailSettingsFrom(loadWorkerEnv());
  return cached;
}
