"use client";

// Reauthentication (API009, task 3.6): DEC36, DEC38, RL01. On the security page and, from task
// 3.7, before the deletion request (account_reauth). The current password and Turnstile;
// the server signs in again and the new session replaces this one, so the CSRF token is fetched
// again afterwards (owner condition on task 1.6). A wrong password is a field error under the
// field; RL01's wait is shown in words (formatWait).
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { formatWait, t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../auth/messages";
import { Turnstile, type TurnstileHandle } from "../auth/Turnstile";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { PasswordField } from "../ui/PasswordField";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import styles from "./ReauthForm.module.css";

const PASSWORD_ID = "reauth-password";

interface ReauthFormProps {
  siteKey: string;
  /** The window had closed when the server was asked (REAUTH_REQUIRED). */
  expired: boolean;
  /** Why the form cannot be sent (an unconfirmed email, terms to acknowledge). */
  blockedReason?: string;
  onDone: (until: string) => void;
}

export function ReauthForm({ siteKey, expired, blockedReason, onDone }: ReauthFormProps) {
  const captcha = useRef<TurnstileHandle>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [captchaPending, setCaptchaPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (failure !== null) feedback.current?.focus();
  }, [failure]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setCaptchaPending(false);
    const field = new FormData(event.currentTarget).get("current_password");
    const password = typeof field === "string" ? field : "";
    if (password === "") {
      setError(fieldMessage("current_password", "required"));
      document.getElementById(PASSWORD_ID)?.focus();
      return;
    }
    setError(undefined);
    if (token === null) {
      setCaptchaPending(true);
      return;
    }
    setSubmitting(true);
    const result = await api.request<{ reauthenticated_until: string }>(routes.api.reauth, {
      body: { current_password: password, captcha_token: token },
    });
    setSubmitting(false);
    captcha.current?.reset();
    if (result.ok) {
      // A new session: the CSRF token bound to the old one no longer works.
      api.resetCsrfToken();
      onDone(result.data.reauthenticated_until);
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      const code = result.fieldErrors.find((item) => item.field === "current_password")?.code;
      setError(fieldMessage("current_password", code ?? "wrong"));
      document.getElementById(PASSWORD_ID)?.focus();
      return;
    }
    setFailure(result);
  }

  return (
    <form
      className={styles.form}
      noValidate
      aria-labelledby="reauth-title"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <h3 id="reauth-title" className={styles.formTitle}>
        {t("account.security.reauth.title")}
      </h3>
      <p className={styles.note}>
        {t(expired ? "account.security.reauth.expired" : "account.security.reauth.body")}
      </p>
      {failure !== null && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          {failure.code === "RATE_LIMITED" && failure.retryAfter !== null ? (
            <Alert variant="danger" title={t("account.security.reauth.formError")} live>
              {t("account.security.reauth.rateLimited", { wait: formatWait(failure.retryAfter) })}
            </Alert>
          ) : (
            <FailureAlert title={t("account.security.reauth.formError")} failure={failure} />
          )}
        </div>
      )}
      <PasswordField
        id={PASSWORD_ID}
        name="current_password"
        label={t("account.security.reauth.label")}
        autoComplete="current-password"
        showRules={false}
        error={error}
      />
      <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />
      {captchaPending && (
        <p className={styles.status} role="status">
          {t("auth.captcha.pending")}
        </p>
      )}
      <Button
        type="submit"
        loading={submitting}
        loadingLabel={t("account.security.reauth.submitting")}
        disabledReason={blockedReason}
      >
        {t("account.security.reauth.submit")}
      </Button>
    </form>
  );
}
