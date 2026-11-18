// SEC07: rate limits use the client address from the trusted proxy chain, never the first
// X-Forwarded-For entry, which the client can write. Each trusted proxy appends the address it
// received the connection from, so with N trusted proxies the client is the Nth entry from the
// right. TRUSTED_PROXY_HOPS is 0 locally (no proxy, so no address) and is measured on Railway at
// cost stage 1.
import { isIP } from "node:net";

export function clientIp(forwardedFor: string | null, trustedHops: number): string | null {
  if (trustedHops <= 0 || forwardedFor === null) return null;
  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const candidate = entries[entries.length - trustedHops];
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : null;
}
