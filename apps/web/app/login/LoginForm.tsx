"use client";

// The login form (task 3.3, item 6, plan/screens.md): FR02, BR21, RL01, DEC36, DEC52.
// The email and an empty password are checked here first; the server stays the authority.
//   200  a new CSRF token on the next request, then a full load of `next`: the local path the
//        server returned (TC02), /restricted for a restricted account (FR78).
//   401  one general line for a wrong password and an unknown address (no enumeration).
//   429  the wait from Retry-After (RL01, or Supabase Auth's own limit).
//   403  CAPTCHA_FAILED resets the widget; EMAIL_NOT_CONFIRMED (confirmation on) offers the
//        resend form; FORBIDDEN means another tab signed in, so the page moves on.
//   422  field errors under their fields. 503 and the network: try again.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { parseEmail } from "@souq/domain";
import { formatWait, t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../../components/auth/messages";
import { ResendForm } from "../../components/auth/ResendForm";
import { Turnstile, type TurnstileHandle } from "../../components/auth/Turnstile";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { PasswordField } from "../../components/ui/PasswordField";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import styles from "./login.module.css";

interface LoginFormProps {
  siteKey: string;
  /** A local path checked by the page (safeLocalPath), or null for the home page. */
  next: string | null;
}

interface LoginResult {
  state: "signed_in" | "restricted" | "deletion_pending";
  next: string;
}

type FieldErrors = Partial<Record<"email" | "password", string>>;

const FIELD_IDS = { email: "login-email", password: "login-password" } as const;

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function localErrors(form: FormData): FieldErrors {
  const errors: FieldErrors = {};
  const email = parseEmail(formText(form, "email"));
  if (!email.ok) errors.email = fieldMessage("email", email.error);
  if (formText(form, "password") === "") errors.password = fieldMessage("password", "required");
  return errors;
}

function focusFirst(errors: FieldErrors): void {
  const first =
    errors.email !== undefined ? "email" : errors.password !== undefined ? "password" : null;
  if (first !== null) document.getElementById(FIELD_IDS[first])?.focus();
}

export function LoginForm({ siteKey, next }: LoginFormProps) {
  const captcha = useRef<TurnstileHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [captchaPending, setCaptchaPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const feedback = useRef<HTMLDivElement>(null);

  // Item 6: a failed request moves focus to its message, so keyboard and screen-reader users
  // land on it (field errors move focus to the field instead).
  useEffect(() => {
    if (failure !== null || unconfirmed !== null) feedback.current?.focus();
  }, [failure, unconfirmed]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFailure(null);
    setUnconfirmed(null);
    setCaptchaPending(false);
    const found = localErrors(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    if (token === null) {
      setCaptchaPending(true);
      return;
    }

    setSubmitting(true);
    const email = formText(form, "email").trim();
    const result = await api.request<LoginResult>(routes.api.login, {
      body: {
        email,
        password: formText(form, "password"),
        ...(next === null ? {} : { next }),
        captcha_token: token,
      },
    });

    if (result.ok) {
      // The CSRF binding changed (task 1.6), and a full load draws the header for the member.
      api.resetCsrfToken();
      window.location.assign(result.data.next);
      return;
    }
    if (result.code === "FORBIDDEN") {
      // A session from another tab: this visitor is signed in already.
      window.location.assign(next ?? routes.home);
      return;
    }
    setSubmitting(false);
    // A token is spent by every call that reached Supabase Auth.
    captcha.current?.reset();
    if (result.code === "VALIDATION_FAILED" && result.fieldErrors.length > 0) {
      const fields: FieldErrors = {};
      for (const { field, code } of result.fieldErrors) {
        if (field === "email" || field === "password") fields[field] ??= fieldMessage(field, code);
      }
      setErrors(fields);
      focusFirst(fields);
      if (Object.keys(fields).length > 0) return;
    }
    if (result.code === "EMAIL_NOT_CONFIRMED") {
      setUnconfirmed(email);
      return;
    }
    setFailure(result);
  }

  return (
    <>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        {(failure !== null || unconfirmed !== null) && (
          <div ref={feedback} tabIndex={-1} className={styles.feedback}>
            {failure !== null && <LoginFailure failure={failure} />}
            {unconfirmed !== null && (
              <Alert variant="warning" title={t("auth.login.notConfirmed.title")} live>
                {t("auth.login.notConfirmed.body")}
              </Alert>
            )}
          </div>
        )}

        <TextField
          id={FIELD_IDS.email}
          name="email"
          type="email"
          dir="ltr"
          label={t("auth.login.email.label")}
          error={errors.email}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
        />
        <PasswordField
          id={FIELD_IDS.password}
          name="password"
          label={t("auth.login.password.label")}
          error={errors.password}
          autoComplete="current-password"
          showRules={false}
        />
        <p className={styles.forgot}>
          <a href={routes.recover}>{t("auth.login.forgot")}</a>
        </p>

        <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />
        {captchaPending && (
          <p className={styles.pending} role="status">
            {t("auth.captcha.pending")}
          </p>
        )}

        <Button
          type="submit"
          fullWidth
          loading={submitting}
          loadingLabel={t("auth.login.submitting")}
        >
          {t("auth.login.submit")}
        </Button>
      </form>
      {unconfirmed !== null && <ResendForm siteKey={siteKey} email={unconfirmed} />}
    </>
  );
}

/** The general line for wrong credentials, the wait for a limit, otherwise the shared alert. */
function LoginFailure({ failure }: { failure: ApiFailure }) {
  const title = t("auth.login.formError");
  if (failure.code === "UNAUTHENTICATED") {
    return (
      <Alert variant="danger" title={title} live>
        {t("auth.login.errors.invalid")}
      </Alert>
    );
  }
  if (failure.code === "RATE_LIMITED" && failure.retryAfter !== null) {
    return (
      <Alert variant="danger" title={title} live>
        {t("auth.login.errors.rateLimited", { wait: formatWait(failure.retryAfter) })}
      </Alert>
    );
  }
  return <FailureAlert title={title} failure={failure} />;
}
