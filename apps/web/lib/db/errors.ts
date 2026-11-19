// Database errors to contract errors (task 3.1, item 11, as amended by DEC72).
//   SJ001 with a contract code       ApiError with the same code, field_errors from the detail
//   SJ001 RATE_LIMITED               429 with Retry-After from the detail (task 2.4)
//   SJ001 with an unknown code       500, logged: a function raised a code the contract lacks
//   23505 on a registered constraint the registered code; any other unique violation is a 500
//   40001, 40P01                     retried by withActor (DEC72), then 503
//   55P03, 57014, connection loss    503 with Retry-After: 1, never retried
//   anything else                    500
// Logs carry the SQLSTATE and the constraint name only, never the message, detail or row values.
import { log } from "@souq/log";
import pg from "pg";
import { ApiError, ERROR_STATUS, type ErrorCode, type FieldError } from "../http/errors.ts";

/** DEC72: the transaction was rolled back as a whole and may be run again from the start. */
export const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set(["40001", "40P01"]);

/** Temporary unavailability: answered with 503 and never retried by the server. */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set([
  "40001",
  "40P01",
  "55P03", // lock_not_available (lock_timeout)
  "57014", // query_canceled (statement_timeout)
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

/** Node and pg errors for a lost or refused connection, before or during a query. */
const CONNECTION_ERRNOS: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
]);
const CONNECTION_MESSAGES = [
  /^Connection terminated/,
  /^timeout exceeded when trying to connect/,
  /^Client has encountered a connection error/,
];

/**
 * Unique constraints that are a contract error rather than a defect, by constraint name. Each
 * slice registers its own here, with the spec rule in a comment, for example
 *   conversation_one_per_pair: "STATE_CONFLICT", // BR29
 * An unregistered unique violation is a 500: the code should have prevented it.
 */
export const UNIQUE_CONSTRAINT_ERRORS: Readonly<Record<string, ErrorCode>> = {};

export function sqlstateOf(error: unknown): string | undefined {
  return error instanceof pg.DatabaseError ? error.code : undefined;
}

export function isTransient(error: unknown): boolean {
  const state = sqlstateOf(error);
  return state !== undefined && TRANSIENT_SQLSTATES.has(state);
}

/** An error raised by the database or the connection, as opposed to a defect in our code. */
export function isDatabaseFailure(error: unknown): boolean {
  return error instanceof pg.DatabaseError || isConnectionError(error);
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const state = sqlstateOf(error);
  if (state?.startsWith("08") === true) return true;
  const errno = (error as { code?: unknown }).code;
  if (typeof errno === "string" && CONNECTION_ERRNOS.has(errno)) return true;
  return CONNECTION_MESSAGES.some((pattern) => pattern.test(error.message));
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_STATUS, value);
}

function parseDetail(detail: string | undefined): Record<string, unknown> | null {
  if (detail === undefined || detail === "") return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function contractError(error: pg.DatabaseError, traceId: string): ApiError {
  const code = error.message;
  if (!isErrorCode(code) || code === "INTERNAL_ERROR") {
    log.error("db.unknown_contract_error", { trace_id: traceId, sqlstate: error.code });
    return new ApiError("INTERNAL_ERROR");
  }
  const detail = parseDetail(error.detail);
  if (code === "RATE_LIMITED") {
    const seconds = detail?.retry_after;
    return new ApiError("RATE_LIMITED", {
      retryAfter: typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds) : 1,
    });
  }
  const fieldErrors: FieldError[] = [];
  if (typeof detail?.field === "string" && typeof detail.code === "string") {
    fieldErrors.push({ field: detail.field, code: detail.code });
  }
  return new ApiError(code, { fieldErrors });
}

/** The contract error for anything a database call threw. Already an ApiError: unchanged. */
export function apiErrorFromDb(
  error: unknown,
  traceId: string,
  uniqueConstraints: Readonly<Record<string, ErrorCode>> = UNIQUE_CONSTRAINT_ERRORS,
): ApiError {
  if (error instanceof ApiError) return error;
  const state = sqlstateOf(error);
  if (error instanceof pg.DatabaseError && state === "SJ001") return contractError(error, traceId);
  if (error instanceof pg.DatabaseError && state === "23505") {
    const constraint = error.constraint;
    const mapped = constraint === undefined ? undefined : uniqueConstraints[constraint];
    if (mapped !== undefined) return new ApiError(mapped);
    log.error("db.unmapped_unique_violation", { trace_id: traceId, constraint });
    return new ApiError("INTERNAL_ERROR");
  }
  if ((state !== undefined && UNAVAILABLE_SQLSTATES.has(state)) || isConnectionError(error)) {
    const errno = (error as { code?: unknown } | null)?.code;
    log.warn("db.unavailable", {
      trace_id: traceId,
      sqlstate: state,
      errno: state === undefined && typeof errno === "string" ? errno : undefined,
    });
    return new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 1 });
  }
  log.error("db.error", {
    trace_id: traceId,
    sqlstate: state,
    name: error instanceof Error ? error.name : typeof error,
  });
  return new ApiError("INTERNAL_ERROR");
}
