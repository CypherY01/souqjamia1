// Task 4.0 (DEC82): E2E runs against a local Supabase whose Auth does not verify Turnstile
// tokens at Cloudflare. That check made logins wait on the internet (0.4 to 24 seconds on a
// network that loses packets, plan/task-4.0.md item A), and no E2E test depends on it: DEC52 is
// tested against the real check in the integration tests and in the owner's review.
// This setup refuses a stack that still verifies, so the two modes never mix.
import { probeAuthCaptcha } from "@souq/domain";
import { localWebEnv } from "./local-env.ts";

export default async function globalSetup(): Promise<void> {
  const local = localWebEnv();
  const check = await probeAuthCaptcha({
    supabaseUrl: local.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    fetch,
  });
  if (check === "off") return;
  throw new Error(
    check === "on"
      ? "E2E needs local Supabase without the Turnstile check (DEC82). Run pnpm db:e2e first, and pnpm db:restart afterwards."
      : "Could not reach local Supabase Auth. Run pnpm db:e2e, then pnpm env:local.",
  );
}
