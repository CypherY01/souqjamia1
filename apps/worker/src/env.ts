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

export const workerEnvSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]),
  // Connection for the souq_worker role (SEC02). main.ts refuses any other role.
  DATABASE_URL: z.string().refine(isPostgresUrl),
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
