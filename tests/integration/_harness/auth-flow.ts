// The auth flows of task 3.2 (signup, the confirmation link, resend) run as the route handlers run
// them: the real server code against the local stack, with a request built here, a guest cookie,
// and the configuration given by the test (confirmation off or on, trusted proxies, limits).
import { randomBytes, randomUUID } from "node:crypto";
import { inject } from "vitest";
import type { AuthFlowContext, AuthFlowEnv } from "../../../apps/web/lib/auth/signup.ts";
import type { Identity } from "../../../apps/web/lib/auth/identity.ts";
import type { AppDb } from "../../../apps/web/lib/db/app-client.ts";
import { GUEST_COOKIE } from "../../../apps/web/lib/http/csrf.ts";
import { ApiError, type FieldError } from "../../../apps/web/lib/http/errors.ts";
import { TEST_PASSWORD } from "./users.ts";
import { signupData } from "./users.ts";

export function flowEnv(overrides: Partial<AuthFlowEnv> = {}): AuthFlowEnv {
  const stack = inject("stack");
  return {
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    // Built at run time: the repository never holds a secret-like string.
    APP_SECRET: randomBytes(32).toString("base64url"),
    EMAIL_CONFIRMATION_REQUIRED: false,
    TRUSTED_PROXY_HOPS: 0,
    SIGNUP_IP_LIMIT_PER_HOUR: 300,
    ...overrides,
  };
}

export function flowContext(
  env: AuthFlowEnv,
  db: AppDb,
  identity: Identity | null = null,
): AuthFlowContext {
  return {
    env,
    db,
    traceId: randomBytes(16).toString("hex"),
    identity: () => Promise.resolve(identity),
  };
}

/** A new guest cookie value, as API013 issues it. */
export function guestId(): string {
  return randomBytes(32).toString("base64url");
}

export interface RequestOptions {
  guest?: string;
  forwardedFor?: string;
  cookies?: readonly { name: string; value: string }[];
}

export function jsonRequest(path: string, body: unknown, options: RequestOptions = {}): Request {
  const cookies = [
    ...(options.guest === undefined ? [] : [`${GUEST_COOKIE}=${options.guest}`]),
    ...(options.cookies ?? []).map(({ name, value }) => `${name}=${value}`),
  ];
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookies.length === 0 ? {} : { cookie: cookies.join("; ") }),
      ...(options.forwardedFor === undefined ? {} : { "x-forwarded-for": options.forwardedFor }),
    },
    body: JSON.stringify(body),
  });
}

export interface Outcome {
  status: number;
  code?: string;
  fieldErrors?: FieldError[];
  retryAfter?: number;
  body?: unknown;
  setCookies: string[];
  location: string | null;
}

/** What the client receives, from a returned response or a thrown contract error. */
export async function outcome(run: () => Promise<Response>): Promise<Outcome> {
  try {
    const response = await run();
    const text = await response.text();
    return {
      status: response.status,
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
      setCookies: response.headers.getSetCookie(),
      location: response.headers.get("location"),
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      status: error.status,
      code: error.code,
      fieldErrors: error.fieldErrors,
      ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      setCookies: [],
      location: null,
    };
  }
}

/** The SignupInput of the contract for a new address, with the versions in force. */
export async function signupBody(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const data = await signupData("عضو تجريبي");
  return {
    name: "عضو تجريبي",
    email: `su-${randomUUID()}@example.test`,
    password: TEST_PASSWORD,
    college_id: null,
    terms_version: data.terms_version,
    privacy_version: data.privacy_version,
    accept_terms: true,
    acknowledge_privacy: true,
    // Cloudflare's dummy token, accepted by the public test secret in config.toml.
    captcha_token: "XXXX.DUMMY.TOKEN.XXXX",
    ...overrides,
  };
}

export interface GeneratedLink {
  userId: string;
  hashedToken: string;
}

/**
 * An unconfirmed account and its confirmation link, through the Auth admin API (local secret key
 * only). It creates the account even while confirmation is off, so confirmation mode is tested
 * without restarting Supabase (plan/task-3.2.md).
 */
export async function generateSignupLink(email: string): Promise<GeneratedLink> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: stack.secretKey,
      authorization: `Bearer ${stack.secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "signup",
      email,
      password: TEST_PASSWORD,
      data: await signupData("عضو تجريبي"),
    }),
  });
  if (res.status !== 200) throw new Error(`generate_link failed with ${String(res.status)}`);
  const body = (await res.json()) as { id: string; hashed_token: string };
  return { userId: body.id, hashedToken: body.hashed_token };
}
