import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { loadPublicEnv } from "./lib/env";
import { STATIC_SECURITY_HEADERS } from "./lib/http/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@souq/domain", "@souq/i18n"],
  // SEC06: static files skip proxy.ts, so they get the fixed security headers here. Every other
  // response gets them, with the CSP nonce, from proxy.ts.
  headers() {
    const headers = STATIC_SECURITY_HEADERS.map(([key, value]) => ({ key, value }));
    return Promise.resolve([
      { source: "/_next/static/:path*", headers },
      { source: "/_next/image", headers },
      { source: "/favicon.ico", headers },
    ]);
  },
};

export default function config(phase: string): NextConfig {
  // NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so a build without
  // them would ship a broken bundle (OPS05). Server-only variables are checked at start-up in
  // instrumentation.ts. `next typegen` (pnpm typecheck) loads this file in the same phase, so the
  // check runs only for the `build` script, which is how every build is run (pnpm build).
  if (phase === PHASE_PRODUCTION_BUILD && process.env.npm_lifecycle_event === "build") {
    loadPublicEnv();
  }
  return nextConfig;
}
