// The error codes of contracts/components/schemas.yaml (ErrorCode) and their HTTP statuses from
// contracts/README.md. tests/unit/http-errors.test.ts keeps the three in step.
import { t } from "@souq/i18n";

export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  INVALID_CURSOR: 400,
  PAYLOAD_TOO_LARGE: 400,
  UNAUTHENTICATED: 401,
  CSRF_FAILED: 403,
  ORIGIN_REJECTED: 403,
  CAPTCHA_FAILED: 403,
  FORBIDDEN: 403,
  EMAIL_NOT_CONFIRMED: 403,
  TERMS_NOT_ACKNOWLEDGED: 403,
  ACCOUNT_RESTRICTED: 403,
  DELETION_PENDING: 403,
  MFA_REQUIRED: 403,
  REAUTH_REQUIRED: 403,
  RECOVERY_SESSION_ONLY: 403,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VALIDATION_FAILED: 422,
  CONTEXT_CLOSED: 422,
  BLOCKED: 422,
  SELF_ACTION: 422,
  NOT_ALLOWED_FOR_CONTEXT: 422,
  LIMIT_REACHED: 422,
  DEADLINE_PASSED: 422,
  MEDIA_NOT_READY: 422,
  MEDIA_INVALID: 422,
  LINK_INVALID_OR_EXPIRED: 422,
  RATE_LIMITED: 429,
  // Owner decision on task 1.6, item 2: a defect in our code. General message and trace id only.
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface FieldError {
  /** The field name as sent, with dots for nested fields. */
  field: string;
  code: string;
}

interface ApiErrorOptions {
  fieldErrors?: FieldError[];
  /** Seconds, for 429 and 503 (Retry-After). */
  retryAfter?: number;
}

/** Thrown by route code; apiHandler turns it into the contract's error body. */
export class ApiError extends Error {
  override name = "ApiError";
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: FieldError[];
  readonly retryAfter: number | undefined;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(code);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors ?? [];
    this.retryAfter = options.retryAfter;
  }
}

/** The contract's Error object (chapter 09): no SQL, stack or private-resource details. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  field_errors: FieldError[];
  trace_id: string;
}

export function errorBody(error: ApiError, traceId: string): ErrorBody {
  return {
    code: error.code,
    message: t(`errors.api.${error.code}`),
    field_errors: error.fieldErrors,
    trace_id: traceId,
  };
}
