// OPS05: refuse to start when the configuration is missing or invalid, and (task 4.0, DEC82) when
// Supabase Auth does not verify Turnstile tokens outside APP_ENV=test.
// Next.js calls register() once when a server process starts, and compiles this file for every
// runtime, Edge included. The check needs Node.js APIs (process.exit), so it lives in a module of
// its own, imported only in the Node.js runtime: Next.js replaces NEXT_RUNTIME at build time and
// drops the import from the Edge build, so neither `next dev` nor `next build` warns about it
// (owner condition 2 on task 3.2).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { exitOnInvalidServerEnv, exitUnlessCaptchaVerified } = await import("./lib/env-startup");
    await exitUnlessCaptchaVerified(exitOnInvalidServerEnv());
  }
}
