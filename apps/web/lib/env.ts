// OPS05: configuration is validated when the server starts, and the server refuses to run if a
// required variable is missing or invalid. FR71: each environment has its own values.
// Every variable is added here together with the code that reads it, and listed in .env.example.
// Error messages name the variables only, never their values.
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const origin = z.url().refine((value) => new URL(value).origin === value, {
  message: "must be an origin only: scheme, host and optional port, without a path",
});

/** Inlined into the browser bundle at build time, so they must be public values. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  // The new publishable key format, not the legacy anon JWT.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
});

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
