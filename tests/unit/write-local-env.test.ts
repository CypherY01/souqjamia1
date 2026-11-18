import { describe, expect, it } from "vitest";
import { loadServerEnv } from "../../apps/web/lib/env.ts";
import { loadWorkerEnv } from "../../apps/worker/src/env.ts";
import { GENERATED_HEADER, webEnv, workerEnv } from "../../scripts/write-local-env.ts";

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) out[match[1]] = match[2] ?? "";
  }
  return out;
}

const stack = {
  apiUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_localdevelopmentkey",
};

describe("pnpm env:local", () => {
  it("writes a web env that passes the app's own validation", () => {
    const text = webEnv(stack, false);
    expect(text.startsWith(GENERATED_HEADER)).toBe(true);
    const env = loadServerEnv(parseDotenv(text));
    expect(env).toMatchObject({
      APP_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
      EMAIL_CONFIRMATION_REQUIRED: false,
    });
  });

  it("copies the DEC63 flag it is given", () => {
    expect(parseDotenv(webEnv(stack, true)).EMAIL_CONFIRMATION_REQUIRED).toBe("true");
  });

  it("writes a worker env that passes the worker's validation", () => {
    expect(loadWorkerEnv(parseDotenv(workerEnv()))).toEqual({ APP_ENV: "development" });
  });
});
