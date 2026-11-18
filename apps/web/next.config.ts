import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@souq/i18n"],
};

export default nextConfig;
