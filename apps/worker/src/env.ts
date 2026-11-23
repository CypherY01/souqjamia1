// OPS05: the worker validates its configuration before doing anything, and refuses to run if a
// required variable is missing or invalid. Variables are added with the jobs that read them and
// listed in .env.example. Errors name the variables, never their values.
import { z } from "zod";

/** A postgres:// or postgresql:// connection string with a host (task 2.5, item 11). */
function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && url.hostname !== "";
  } catch {
    return false;
  }
}

const origin = z.url().refine((value) => new URL(value).origin === value, {
  message: "must be an origin only: scheme, host and optional port, without a path",
});

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Task 4.0 (DEC82): APP_ENV=test runs on this machine only, never on a hosted server. */
function isLocalOrigin(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** "Name <address>" or a bare address, as EMAIL_FROM is written. */
export interface FromAddress {
  readonly name: string | null;
  readonly email: string;
}

const emailAddress = z.email();

export function parseFromAddress(value: string): FromAddress | null {
  const named = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(value);
  const name = named?.[1] ?? null;
  const email = named?.[2] ?? value.trim();
  if (!emailAddress.safeParse(email).success) return null;
  return { name: name === null || name === "" ? null : name, email };
}

export const workerEnvSchema = z
  .object({
    // Task 4.0 (DEC82): "test" is for tests on this machine only (refined below).
    APP_ENV: z.enum(["development", "test", "staging", "production"]),
    // Connection for the souq_worker role (SEC02). main.ts refuses any other role.
    DATABASE_URL: z.string().refine(isPostgresUrl),
    // Task 3.8 (item 1 and 2): how email.send delivers. mailpit locally and in CI (DEC62), Resend
    // from cost stage 1. Both over HTTP with fetch, no library.
    EMAIL_TRANSPORT: z.enum(["mailpit", "resend"]),
    // The sender, "Name <address>". On souqjamia1.com once the domain is verified (G01).
    EMAIL_FROM: z.string().refine((value) => parseFromAddress(value) !== null),
    // mailpit only: the local Mailpit web address, whose HTTP API sends (http://127.0.0.1:54324).
    MAILPIT_URL: z.url().optional(),
    // resend only: the Resend API key (secret, ops/runbooks/secrets.md).
    RESEND_API_KEY: z
      .string()
      .regex(/^re_[A-Za-z0-9_-]{8,}$/)
      .optional(),
    // Links in email go to fixed paths on the site (the same value as the web app).
    APP_ORIGIN: origin,
    // FR78: the contact address in the deletion email (the same value as the web app).
    CONTACT_EMAIL: z.email(),
    // Task 4.0 (DEC82, owner condition 1): main.ts asks Supabase Auth at start-up whether it
    // verifies Turnstile tokens, and refuses to run if not. The same public values as the web
    // app's NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
    // Task 4.1 (SEC08): Storage with the secret key (sb_..., server-only), to read the raw upload,
    // write the private derivatives and remove files (image.process, media.cleanup).
    // ops/runbooks/secrets.md: a separate key for the worker once hosted.
    SUPABASE_SECRET_KEY: z.string().regex(/^sb_secret_[A-Za-z0-9_-]{16,}$/),
  })
  .refine((env) => env.EMAIL_TRANSPORT !== "mailpit" || env.MAILPIT_URL !== undefined, {
    path: ["MAILPIT_URL"],
    message: "MAILPIT_URL is required with EMAIL_TRANSPORT=mailpit",
  })
  .refine((env) => !(env.EMAIL_TRANSPORT === "mailpit" && env.APP_ENV === "production"), {
    path: ["EMAIL_TRANSPORT"],
    message: "EMAIL_TRANSPORT=mailpit is for local development and CI, never production",
  })
  .refine((env) => env.EMAIL_TRANSPORT !== "resend" || env.RESEND_API_KEY !== undefined, {
    path: ["RESEND_API_KEY"],
    message: "RESEND_API_KEY is required with EMAIL_TRANSPORT=resend",
  })
  .refine((env) => env.APP_ENV !== "test" || isLocalOrigin(env.APP_ORIGIN), {
    path: ["APP_ENV"],
    message: "APP_ENV=test is for tests on this machine, with a localhost APP_ORIGIN",
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

export function loadWorkerEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "")))]
    .filter((name) => name !== "")
    .sort();
  throw new EnvError(
    `Invalid or missing environment variables: ${names.join(", ")}. See .env.example.`,
  );
}
