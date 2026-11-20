// Task 3.3: the return path after login (BR21, TC02, TC65) and the RL01 limits, without the
// database. The flows themselves are in tests/integration/login.test.ts and logout.test.ts.
import { describe, expect, it } from "vitest";
import { LOCAL_PATH_MAX, safeLocalPath } from "@souq/domain";
import { loginLimits, RL01_EMAIL, RL01_IP } from "../../apps/web/lib/auth/limits.ts";
import { fingerprint } from "../../apps/web/lib/http/rate-limit.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const BACKSLASH = String.fromCharCode(92);

describe("TC02: safeLocalPath", () => {
  it.each([
    "/",
    "/market?q=كتاب",
    "/listings/123#photos",
    "/account/listings?status=active&sort=new",
    "/%2F%2Fevil.example",
    `/${"a".repeat(LOCAL_PATH_MAX - 1)}`,
  ])("keeps the local path %s as it is", (path) => {
    expect(safeLocalPath(path)).toBe(path);
  });

  it.each([
    ["another host, protocol-relative", "//evil.example"],
    ["another host behind a backslash", `/${BACKSLASH}evil.example`],
    ["a backslash later on", `/a${BACKSLASH}b`],
    ["an absolute URL", "https://evil.example"],
    ["a script URL", "javascript:alert(1)"],
    ["a tab that browsers drop", `/${cp(9)}/evil.example`],
    ["a newline that browsers drop", `/${cp(10)}/evil.example`],
    ["a leading space", " /market"],
    ["a space inside", "/market place"],
    ["a no-break space", `/market${cp(0xa0)}x`],
    ["a bidi control", `/market${cp(0x202e)}x`],
    ["empty", ""],
    ["a relative path", "market"],
    ["an API route", "/api/auth/logout"],
    ["the API root", "/api"],
    ["the login page (a loop)", "/login?next=/"],
    ["the signup page (a loop)", "/signup"],
    ["the login page through a dot segment", "/./login"],
    ["too long", `/${"a".repeat(LOCAL_PATH_MAX)}`],
  ])("refuses %s", (_name, path) => {
    expect(safeLocalPath(path)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(safeLocalPath(undefined)).toBeNull();
    expect(safeLocalPath(null)).toBeNull();
    expect(safeLocalPath(["/"])).toBeNull();
  });
});

describe("RL01", () => {
  const env = { APP_SECRET: "s".repeat(43), TRUSTED_PROXY_HOPS: 1 };

  it("5 failures per email and 200 per address, in 15-minute windows", () => {
    expect(RL01_EMAIL).toEqual({ scope: "RL01:email", limit: 5, window: "15 minutes" });
    expect(RL01_IP).toEqual({ scope: "RL01:ip", limit: 200, window: "15 minutes" });
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    const limits = loginLimits(env, headers, "member@example.test");
    expect(limits.map((entry) => entry.limit.scope)).toEqual(["RL01:email", "RL01:ip"]);
    expect(limits[1]?.key.equals(fingerprint(env.APP_SECRET, "ip", "198.51.100.7"))).toBe(true);
  });

  it("the same email key whatever its case and surrounding spaces, registered or not", () => {
    const headers = new Headers();
    const [typed] = loginLimits(env, headers, "  Member@Example.TEST ");
    const [plain] = loginLimits(env, headers, "member@example.test");
    expect(typed?.key.equals(plain?.key ?? Buffer.alloc(0))).toBe(true);
  });

  it("without a trusted proxy the address is unknown, so only the email limit applies", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    const limits = loginLimits({ ...env, TRUSTED_PROXY_HOPS: 0 }, headers, "member@example.test");
    expect(limits.map((entry) => entry.limit.scope)).toEqual(["RL01:email"]);
  });
});
