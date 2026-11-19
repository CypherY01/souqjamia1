// OPS05: configuration is validated when the server starts, and the server refuses to run if a
// required variable is missing or invalid. FR71: each environment has its own values.
// Every variable is added here together with the code that reads it, and listed in .env.example.
// Error messages name the variables only, never their values.
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const origin = z.url().refine((value) => new URL(value).origin === value, {
  message: "must be an origin only: scheme, host and optional port, without a path",
});

/** A postgres:// or postgresql:// connection string with a host, as for the worker (task 2.5). */
function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Inlined into the browser bundle at build time, so they must be public values. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  // The new publishable key format, not the legacy anon JWT.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
  // Task 3.2, DEC36, DEC52: the Cloudflare Turnstile site key (public by design). Locally and in
  // CI the official test key that always passes; the real site from cost stage 1.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().regex(/^[0-9]x[A-Za-z0-9_-]{8,64}$/),
});

/** DEC74: RL02 signups per client address and hour, when SIGNUP_IP_LIMIT_PER_HOUR is not set. */
export const DEFAULT_SIGNUP_IP_LIMIT_PER_HOUR = 300;

export const serverEnvSchema = publicEnvSchema.extend({
  APP_ENV: z.enum(["development", "staging", "production"]),
  // The trusted origin of the site: the Origin check (SEC05) compares requests with it exactly.
  APP_ORIGIN: origin,
  // DEC63: email_confirmation_required. Must match enable_confirmations in config.toml.
  EMAIL_CONFIRMATION_REQUIRED: booleanString,
  // Task 1.6: the server secret. The CSRF and cursor keys are derived from it with HKDF, one
  // purpose name each. Changing it invalidates both (ops/runbooks/secrets.md).
  APP_SECRET: z.string().min(32),
  // API106: shared with the hosting platform's readiness probe (X-Probe-Token).
  PROBE_TOKEN: z.string().min(32),
  // SEC07: how many trusted proxies in front of the app append to X-Forwarded-For (0 locally).
  TRUSTED_PROXY_HOPS: z
    .string()
    .regex(/^[0-9]$/)
    .transform(Number),
  // Task 3.1, DEC36: direct Postgres connection for the souq_web role. lib/db/app-client.ts
  // refuses any other role.
  DATABASE_URL: z.string().refine(isPostgresUrl),
  // Task 3.1, FR78: the contact address shown to restricted accounts for objections (section 3
  // of the addendum). The real address comes with G05; locally a fixture.
  CONTACT_EMAIL: z.email(),
  // DEC74: RL02 signups per client address and hour (a shared campus network counts as one
  // address). Optional: unset or empty means 300. Reviewed after the load test (task 8.4).
  SIGNUP_IP_LIMIT_PER_HOUR: z
    .string()
    .regex(/^([1-9][0-9]{0,5})?$/)
    .optional()
    .transform((value) =>
      value === undefined || value === "" ? DEFAULT_SIGNUP_IP_LIMIT_PER_HOUR : Number(value),
    ),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

type Source = Readonly<Record<string, string | undefined>>;

export function parseEnv<T>(schema: z.ZodType<T>, source: Source): T {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "")))]
    .filter((name) => name !== "")
    .sort();
  throw new EnvError(
    `Invalid or missing environment variables: ${names.join(", ")}. See .env.example.`,
  );
}

export function loadPublicEnv(source: Source = process.env): PublicEnv {
  return parseEnv(publicEnvSchema, source);
}

export function loadServerEnv(source: Source = process.env): ServerEnv {
  return parseEnv(serverEnvSchema, source);
}

let cached: ServerEnv | undefined;

/** The validated server configuration, parsed once per process (it never changes at run time). */
export function serverEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}
