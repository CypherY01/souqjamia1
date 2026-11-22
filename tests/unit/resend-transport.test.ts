// Task 3.8 (items 1 to 4): the two email transports against local fake servers, and email.send
// run twice on one job (DEC71). No request ever leaves this machine.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMailpitTransport, IDEMPOTENCY_HEADER } from "../../apps/worker/src/email/mailpit.ts";
import { createResendTransport } from "../../apps/worker/src/email/resend.ts";
import {
  EmailSendError,
  httpFailure,
  type OutgoingEmail,
} from "../../apps/worker/src/email/transport.ts";
import { PermanentJobError } from "../../apps/worker/src/job.ts";
import { createEmailSend, emailIdempotencyKey } from "../../apps/worker/src/jobs/email.send.ts";
import type { Queryable } from "../../apps/worker/src/db.ts";

interface Received {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
const received: Received[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { id: "re-1" } };

beforeAll(async () => {
  server = createServer((request, response) => {
    let data = "";
    request.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        headers: request.headers,
        body: JSON.parse(data) as Record<string, unknown>,
      });
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received.length = 0;
  reply = { status: 200, body: { id: "re-1" } };
});

// Built at run time: the repository never holds a secret-like string.
const apiKey = `re_${randomBytes(12).toString("hex")}`;
const to = "member@souqjamia1.test";

function email(key = "email/abc"): OutgoingEmail {
  return { to, subject: "موضوع", html: "<p>نص</p>", text: "نص", idempotencyKey: key };
}

const signal = new AbortController().signal;

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

describe("Resend (item 2)", () => {
  it("sends one email with the key, the API key and the documented body", async () => {
    const resend = createResendTransport({
      apiKey,
      from: "سوق الجامعة <no-reply@souqjamia1.test>",
      baseUrl,
    });
    expect(await resend.send(email(), signal)).toEqual({ id: "re-1" });
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request?.path).toBe("/emails");
    expect(request?.headers.authorization).toBe(`Bearer ${apiKey}`);
    expect(request?.headers["idempotency-key"]).toBe("email/abc");
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.body).toEqual({
      from: "سوق الجامعة <no-reply@souqjamia1.test>",
      to: [to],
      subject: "موضوع",
      html: "<p>نص</p>",
      text: "نص",
    });
  });

  it("item 3: temporary failures retry, others are permanent, and no error names the address", async () => {
    const resend = createResendTransport({ apiKey, from: "no-reply@souqjamia1.test", baseUrl });
    const cases: [number, unknown, "retry" | "dead", string][] = [
      [429, { name: "rate_limit_exceeded" }, "retry", "EMAIL_HTTP_429"],
      [500, {}, "retry", "EMAIL_HTTP_500"],
      [503, {}, "retry", "EMAIL_HTTP_503"],
      [401, { name: "missing_api_key" }, "retry", "EMAIL_HTTP_401"],
      [403, { name: "invalid_api_key" }, "retry", "EMAIL_HTTP_403"],
      [409, { name: "concurrent_idempotent_requests" }, "retry", "EMAIL_HTTP_409_CONCURRENT"],
      [409, { name: "invalid_idempotent_request" }, "dead", "EMAIL_HTTP_409"],
      [422, { name: "validation_error" }, "dead", "EMAIL_HTTP_422"],
      [400, { name: "invalid_idempotency_key" }, "dead", "EMAIL_HTTP_400"],
    ];
    for (const [status, body, kind, code] of cases) {
      reply = { status, body };
      const error = await failureOf(() => resend.send(email(), signal));
      expect(error, `${String(status)} ${JSON.stringify(body)}`).toBeInstanceOf(
        kind === "retry" ? EmailSendError : PermanentJobError,
      );
      expect((error as { code: string }).code).toBe(code);
      expect((error as Error).message).not.toContain(to);
    }
  });

  it("a network failure is temporary", async () => {
    const resend = createResendTransport({
      apiKey,
      from: "no-reply@souqjamia1.test",
      baseUrl: "http://127.0.0.1:1",
    });
    const error = await failureOf(() => resend.send(email(), signal));
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).code).toBe("EMAIL_NETWORK");
  });

  it("the job's own stop is not turned into a send failure", async () => {
    const controller = new AbortController();
    const stop = new Error("stopping");
    controller.abort(stop);
    const resend = createResendTransport({ apiKey, from: "no-reply@souqjamia1.test", baseUrl });
    expect(await failureOf(() => resend.send(email(), controller.signal))).toBe(stop);
  });

  it("httpFailure: the codes fit the job_error_code constraint", () => {
    for (const status of [400, 401, 409, 422, 429, 500, 599]) {
      expect((httpFailure(status, null) as EmailSendError | PermanentJobError).code).toMatch(
        /^[A-Za-z0-9_.:-]{1,64}$/,
      );
    }
  });
});

describe("Mailpit (item 1)", () => {
  it("sends through the HTTP API with the key as a header", async () => {
    reply = { status: 200, body: { ID: "mp-1" } };
    const mailpit = createMailpitTransport({
      url: baseUrl,
      from: { name: "سوق الجامعة", email: "no-reply@souqjamia1.test" },
    });
    expect(await mailpit.send(email("email/xyz"), signal)).toEqual({ id: "mp-1" });
    expect(received[0]?.path).toBe("/api/v1/send");
    expect(received[0]?.body).toEqual({
      From: { Email: "no-reply@souqjamia1.test", Name: "سوق الجامعة" },
      To: [{ Email: to }],
      Subject: "موضوع",
      HTML: "<p>نص</p>",
      Text: "نص",
      Headers: { [IDEMPOTENCY_HEADER]: "email/xyz" },
    });
  });
});

describe("DEC71: email.send is idempotent", () => {
  const notificationId = randomUUID();
  const row = {
    notification_id: notificationId,
    event_type: "account.deletion_recovered",
    email_channel: "required",
    recipient_email: to,
    created_at: new Date("2026-11-22T10:00:00Z"),
    deletion_deadline: null,
  };

  function fakeDb(rows: unknown[]): Queryable {
    return { query: () => Promise.resolve({ rows } as never) };
  }

  function context(db: Queryable) {
    return { jobId: "7", attempt: 1, idempotencyKey: "job:7", signal, db };
  }

  it("DEC71 email.send run twice on one job sends one idempotency key", async () => {
    const resend = createResendTransport({ apiKey, from: "no-reply@souqjamia1.test", baseUrl });
    const job = createEmailSend(
      () => ({
        transport: resend,
        origin: "https://souqjamia1.test",
        contactEmail: "c@souqjamia1.test",
      }),
      { info: () => undefined, warn: () => undefined, error: () => undefined },
    );
    const db = fakeDb([row]);
    expect(await job.run({ notification_id: notificationId }, context(db))).toEqual({ sent: 1 });
    expect(
      await job.run({ notification_id: notificationId }, { ...context(db), attempt: 2 }),
    ).toEqual({
      sent: 1,
    });
    expect(received).toHaveLength(2);
    // The same key and the same body: Resend answers the repeat without a second email.
    expect(received.map((request) => request.headers["idempotency-key"])).toEqual([
      emailIdempotencyKey(notificationId),
      emailIdempotencyKey(notificationId),
    ]);
    expect(received[1]?.body).toEqual(received[0]?.body);
  });

  it("an unknown channel or a required event without an email is dead at once", async () => {
    const resend = createResendTransport({ apiKey, from: "no-reply@souqjamia1.test", baseUrl });
    const job = createEmailSend(() => ({
      transport: resend,
      origin: "https://souqjamia1.test",
      contactEmail: "c@souqjamia1.test",
    }));
    for (const [changes, code] of [
      [{ email_channel: "sms" }, "EMAIL_CHANNEL_INVALID"],
      [{ email_channel: "none" }, "EMAIL_CHANNEL_INVALID"],
      [{ event_type: "account.unknown" }, "EMAIL_UNKNOWN_EVENT"],
    ] as const) {
      const error = await failureOf(() =>
        job.run({ notification_id: notificationId }, context(fakeDb([{ ...row, ...changes }]))),
      );
      expect(error).toBeInstanceOf(PermanentJobError);
      expect((error as PermanentJobError).code).toBe(code);
    }
    expect(received).toHaveLength(0);
  });

  it("the payload is the notification id only", () => {
    const job = createEmailSend(() => {
      throw new Error("not used");
    });
    expect(job.payload.safeParse({ notification_id: notificationId }).success).toBe(true);
    expect(job.payload.safeParse({ notification_id: notificationId, to }).success).toBe(false);
    expect(job.payload.safeParse({ notification_id: "x" }).success).toBe(false);
  });
});
