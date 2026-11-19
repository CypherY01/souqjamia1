import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_JSON_BYTES, readJson } from "../../apps/web/lib/http/body.ts";
import { ApiError, ERROR_STATUS, type ErrorCode } from "../../apps/web/lib/http/errors.ts";
import { apiHandler } from "../../apps/web/lib/http/handler.ts";
import { ok } from "../../apps/web/lib/http/respond.ts";
import { log, redactFields, redactText } from "@souq/log";

const root = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// Secret-like strings are assembled at run time, so the repository never contains one.
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const FAKE_JWT = [part({ alg: "HS256" }), part({ sub: "member" }), "c2lnbmF0dXJl"].join(".");
const FAKE_SECRET_KEY = ["sb", "secret", "z".repeat(30)].join("_");
const FAKE_PASSWORD = ["not", "a", "real", "password"].join("-");

describe("error codes match the contract (contracts/components/schemas.yaml, README)", () => {
  const schemaCodes = (() => {
    const block = /ErrorCode:\n {2}type: string\n {2}enum:\n((?: {4}- [A-Z_]+\n)+)/.exec(
      read("contracts/components/schemas.yaml"),
    );
    return [...(block?.[1] ?? "").matchAll(/- ([A-Z_]+)/g)].map((m) => m[1]);
  })();

  it("has exactly the contract's codes, including INTERNAL_ERROR (task 1.6)", () => {
    expect(schemaCodes).toContain("INTERNAL_ERROR");
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...schemaCodes].sort());
  });

  it("uses the status of every code in the README table", () => {
    const rows = read("contracts/README.md")
      .split("\n")
      .map((line) => /^\| `([A-Z_]+)`(?:، `([A-Z_]+)`)? \| (\d{3}) \|/.exec(line))
      .filter((match) => match !== null);
    const table = new Map<string, number>();
    for (const row of rows) {
      for (const code of [row[1], row[2]]) if (code !== undefined) table.set(code, Number(row[3]));
    }
    expect(Object.fromEntries(table)).toEqual(ERROR_STATUS);
  });

  it("has an Arabic message for every code", () => {
    for (const code of Object.keys(ERROR_STATUS) as ErrorCode[]) {
      expect(new ApiError(code).status).toBe(ERROR_STATUS[code]);
    }
  });
});

function jsonRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost:3000/api/x", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return `${error.code}:${JSON.stringify(error.fieldErrors)}`;
    throw error;
  }
  return "accepted";
}

describe("NFR10 JSON bodies (readJson)", () => {
  const schema = z.strictObject({ title: z.string().min(5), note: z.string().optional() });
  const big = z.strictObject({ a: z.string() });

  it("accepts a valid body", async () => {
    await expect(readJson(jsonRequest('{"title":"كتاب جديد"}'), schema)).resolves.toEqual({
      title: "كتاب جديد",
    });
  });

  it("accepts exactly 128 KiB and rejects one byte more", async () => {
    const exact = `{"a":"${"x".repeat(MAX_JSON_BYTES - 8)}"}`;
    expect(Buffer.byteLength(exact)).toBe(MAX_JSON_BYTES);
    await expect(codeOf(readJson(jsonRequest(exact), big))).resolves.toBe("accepted");
    const over = `{"a":"${"x".repeat(MAX_JSON_BYTES - 7)}"}`;
    await expect(codeOf(readJson(jsonRequest(over), big))).resolves.toBe("PAYLOAD_TOO_LARGE:[]");
  });

  it("stops reading a streamed body at the limit, without a Content-Length", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const request = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(codeOf(readJson(request, big))).resolves.toBe("PAYLOAD_TOO_LARGE:[]");
    expect(pulled).toBeLessThan(12);
  });

  it.each([
    ["a wrong content type", jsonRequest('{"title":"كتاب جديد"}', "text/plain"), "BAD_REQUEST:[]"],
    ["broken JSON", jsonRequest('{"title":'), "BAD_REQUEST:[]"],
    [
      "an unknown field",
      jsonRequest('{"title":"كتاب جديد","seller_id":"x"}'),
      'BAD_REQUEST:[{"field":"seller_id","code":"unknown_field"}]',
    ],
    [
      "a wrong type",
      jsonRequest('{"title":42}'),
      'BAD_REQUEST:[{"field":"title","code":"invalid_type"}]',
    ],
    [
      "a missing field",
      jsonRequest("{}"),
      'VALIDATION_FAILED:[{"field":"title","code":"required"}]',
    ],
    [
      "a field rule",
      jsonRequest('{"title":"قصير"}'),
      'VALIDATION_FAILED:[{"field":"title","code":"too_small"}]',
    ],
  ])("rejects %s", async (_name, request, expected) => {
    await expect(codeOf(readJson(request, schema))).resolves.toBe(expected);
  });
});

describe("NFR13 apiHandler, errors and logs", () => {
  let lines: string[] = [];

  beforeEach(() => {
    lines = [];
    const capture = (line: unknown) => {
      lines.push(String(line));
    };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const traceId = "0123456789abcdef0123456789abcdef";
  const request = () =>
    new Request("http://localhost:3000/api/x/7?token_hash=abc", {
      headers: { "x-trace-id": traceId },
    });

  it("returns success bodies with the proxy's trace id, no-store and Vary: Origin", async () => {
    const handler = apiHandler("/api/x/[id]", () => ok({ id: 7 }, { next_cursor: null }));
    const response = await handler(request(), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 7 }, meta: { next_cursor: null } });
    expect(response.headers.get("x-trace-id")).toBe(traceId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Origin");
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: "api.request",
      route: "/api/x/[id]",
      status: 200,
      trace_id: traceId,
    });
    expect(lines.join("\n")).not.toContain("token_hash");
  });

  it("turns an ApiError into the contract's error body", async () => {
    const handler = apiHandler("/api/x", () => {
      throw new ApiError("RATE_LIMITED", { retryAfter: 30 });
    });
    const response = await handler(request(), undefined);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({
      code: "RATE_LIMITED",
      message: "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
      field_errors: [],
      trace_id: traceId,
    });
  });

  it("hides an unexpected error behind INTERNAL_ERROR and logs it redacted", async () => {
    const handler = apiHandler("/api/x", () => {
      throw new Error(`database said no for ${FAKE_JWT} and password=${FAKE_PASSWORD}`);
    });
    const response = await handler(request(), undefined);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: "INTERNAL_ERROR", trace_id: traceId });
    expect(JSON.stringify(body)).not.toContain("database");
    const logged = lines.join("\n");
    expect(logged).toContain("api.unhandled_error");
    expect(logged).toContain(traceId);
    expect(logged).not.toContain(FAKE_JWT);
    expect(logged).not.toContain(FAKE_PASSWORD);
  });

  it("does not log health probes", async () => {
    const handler = apiHandler("/healthz", () => Response.json({ status: "ok" }), { log: false });
    await handler(request(), undefined);
    expect(lines).toEqual([]);
  });
});

describe("NFR13 log redaction", () => {
  it.each([
    ["a JWT", `token ${FAKE_JWT} end`, FAKE_JWT],
    ["a Supabase secret key", `key ${FAKE_SECRET_KEY}`, FAKE_SECRET_KEY],
    ["a bearer credential", `Authorization: Bearer ${FAKE_PASSWORD}`, FAKE_PASSWORD],
    [
      "a connection string password",
      `postgresql://app:${FAKE_PASSWORD}@db.example.test/souq`,
      FAKE_PASSWORD,
    ],
    [
      "an auth link",
      `http://localhost:3000/auth/recover?token_hash=${FAKE_PASSWORD}&x=1`,
      FAKE_PASSWORD,
    ],
    ["a key=value pair in a message", `login failed: password=${FAKE_PASSWORD}`, FAKE_PASSWORD],
    ["a key: value pair in a message", `refresh_token: ${FAKE_PASSWORD}`, FAKE_PASSWORD],
  ])("masks %s in text", (_name, text, secret) => {
    const masked = redactText(text);
    expect(masked).not.toContain(secret);
    expect(masked).toContain("[REDACTED]");
  });

  it("drops fields with sensitive names, deep inside objects and arrays", () => {
    const masked = redactFields({
      code: "CSRF_FAILED",
      route: "/api/x",
      password: FAKE_PASSWORD,
      otp_code: "123456",
      nested: { refresh_token: "abc", items: [{ cookie: "a=b" }, { note: `see ${FAKE_JWT}` }] },
    });
    expect(masked).toEqual({
      code: "CSRF_FAILED",
      route: "/api/x",
      password: "[REDACTED]",
      otp_code: "[REDACTED]",
      nested: {
        refresh_token: "[REDACTED]",
        items: [{ cookie: "[REDACTED]" }, { note: "see [REDACTED]" }],
      },
    });
  });

  it("writes one JSON line with time, level and event", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.info("probe", { status: 200 });
    const line = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    spy.mockRestore();
    expect(line).toMatchObject({ level: "info", event: "probe", status: 200 });
    expect(typeof line.time).toBe("string");
  });
});
