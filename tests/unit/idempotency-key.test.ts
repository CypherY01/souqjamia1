// Task 4.2 (BR32, NFR09): the Idempotency-Key header of a creation (apps/web/lib/http/idempotency.ts)
// and the browser client that sends it (lib/client/api.ts).
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../apps/web/lib/client/api.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import { idempotencyKey } from "../../apps/web/lib/http/idempotency.ts";

function request(key?: string): Request {
  return new Request("http://localhost:3000/api/listings", {
    method: "POST",
    headers: key === undefined ? {} : { "idempotency-key": key },
  });
}

function refusal(key?: string): unknown {
  try {
    idempotencyKey(request(key));
    return null;
  } catch (error) {
    return error instanceof ApiError
      ? { code: error.code, status: error.status, fieldErrors: error.fieldErrors }
      : error;
  }
}

describe("BR32: Idempotency-Key", () => {
  it("a UUID is the key, in lower case", () => {
    expect(idempotencyKey(request("ABCDEF00-1111-4111-8111-111111111111"))).toBe(
      "abcdef00-1111-4111-8111-111111111111",
    );
  });

  it("absent or malformed is 400 BAD_REQUEST with the header as the field", () => {
    expect(refusal()).toEqual({
      code: "BAD_REQUEST",
      status: 400,
      fieldErrors: [{ field: "Idempotency-Key", code: "required" }],
    });
    expect(refusal("12345")).toEqual({
      code: "BAD_REQUEST",
      status: 400,
      fieldErrors: [{ field: "Idempotency-Key", code: "invalid_format" }],
    });
  });

  it("the browser client sends the key it was given, with the CSRF token", async () => {
    const sent: Headers[] = [];
    const client = createApiClient((input, init) => {
      if (input === "/api/csrf") return Promise.resolve(Response.json({ data: { token: "t" } }));
      sent.push(new Headers(init?.headers));
      return Promise.resolve(Response.json({ data: { id: "l1" } }, { status: 201 }));
    });
    const result = await client.request("/api/listings", {
      body: { title: "x" },
      idempotencyKey: "abcdef00-1111-4111-8111-111111111111",
    });
    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(sent[0]?.get("idempotency-key")).toBe("abcdef00-1111-4111-8111-111111111111");
    expect(sent[0]?.get("x-csrf-token")).toBe("t");
  });
});
