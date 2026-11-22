"use client";

// The password change (API022, task 3.6): FR59, TC27, DEC32, DEC36, RL01, SEC11. The current
// password and Turnstile in the same request are the reauthentication (item 4). The new password
// rules run here first with the function the server uses (checkPassword). After 204 this browser
// is on a new session, every other session is ended, and the CSRF token is fetched again (owner
// condition on task 1.6). The form starts empty again after a change.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { checkPassword } from "@souq/domain";
import { formatWait, t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../../../components/auth/messages";
import { Turnstile, type TurnstileHandle } from "../../../components/auth/Turnstile";
import { Alert } from "../../../components/ui/Alert";
import { SubmitButton } from "../../../components/ui/SubmitButton";
import { PasswordField } from "../../../components/ui/PasswordField";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./security.module.css";

const CURRENT_ID = "password-current";
const NEXT_ID = "password-new";

type Errors = Partial<Record<"current_password" | "new_password", string>>;

interface PasswordChangeFormProps {
  siteKey: string;
  blockedReason?: string;
}

export function PasswordChangeForm({ siteKey, blockedReason }: PasswordChangeFormProps) {
  const captcha = useRef<TurnstileHandle>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [changed, setChanged] = useState(false);
  const [captchaPending, setCaptchaPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // A new key empties the fields (and their hints) after a change.
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (changed || failure !== null) feedback.current?.focus();
  }, [changed, failure]);

  function show(next: Errors): void {
    setErrors(next);
    const first = next.current_password !== undefined ? CURRENT_ID : NEXT_ID;
    document.getElementById(first)?.focus();
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setChanged(false);
    setCaptchaPending(false);
    const form = new FormData(event.currentTarget);
    const current = form.get("current_password");
    const next = form.get("new_password");
    const currentPassword = typeof current === "string" ? current : "";
    const newPassword = typeof next === "string" ? next : "";
    const found: Errors = {};
    if (currentPassword === "")
      found.current_password = fieldMessage("current_password", "required");
    const rule = checkPassword(newPassword);
    if (rule !== null) found.new_password = fieldMessage("new_password", rule);
    else if (newPassword === currentPassword) {
      found.new_password = fieldMessage("new_password", "same_password");
    }
    if (Object.keys(found).length > 0) {
      show(found);
      return;
    }
    setErrors({});
    if (token === null) {
      setCaptchaPending(true);
      return;
    }
    setSubmitting(true);
    const result = await api.request(routes.api.passwordChange, {
      body: { current_password: currentPassword, new_password: newPassword, captcha_token: token },
    });
    setSubmitting(false);
    captcha.current?.reset();
    if (result.ok) {
      api.resetCsrfToken();
      // The new widget gives a new token; the spent one must not be sent again.
      setToken(null);
      setChanged(true);
      setRound((value) => value + 1);
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      const fieldErrors: Errors = {};
      for (const item of result.fieldErrors) {
        if (item.field === "current_password" || item.field === "new_password") {
          fieldErrors[item.field] = fieldMessage(item.field, item.code);
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        show(fieldErrors);
        return;
      }
    }
    setFailure(result);
  }

  return (
    <div className={styles.block}>
      {(changed || failure !== null) && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          {changed && (
            <Alert variant="success" title={t("account.security.password.changed.title")} live>
              {t("account.security.password.changed.body")}
            </Alert>
          )}
          {failure !== null &&
            (failure.code === "RATE_LIMITED" && failure.retryAfter !== null ? (
              <Alert variant="danger" title={t("account.security.password.formError")} live>
                {t("account.security.password.rateLimited", {
                  wait: formatWait(failure.retryAfter),
                })}
              </Alert>
            ) : (
              <FailureAlert title={t("account.security.password.formError")} failure={failure} />
            ))}
        </div>
      )}
      <form
        key={round}
        className={styles.form}
        method="post"
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <PasswordField
          id={CURRENT_ID}
          name="current_password"
          label={t("account.security.password.current")}
          autoComplete="current-password"
          showRules={false}
          error={errors.current_password}
        />
        <PasswordField
          id={NEXT_ID}
          name="new_password"
          label={t("account.security.password.next")}
          hint={t("auth.signup.password.hint")}
          autoComplete="new-password"
          error={errors.new_password}
        />
        <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />
        {captchaPending && (
          <p className={styles.status} role="status">
            {t("auth.captcha.pending")}
          </p>
        )}
        <SubmitButton
          loading={submitting}
          loadingLabel={t("account.security.password.submitting")}
          disabledReason={blockedReason}
        >
          {t("account.security.password.submit")}
        </SubmitButton>
      </form>
    </div>
  );
}
