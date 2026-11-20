"use client";

// The new password (API008, task 3.4): DEC32, DEC75. The rules are checked here first with the
// same function the server uses; the server stays the authority.
//   204  every session of the account was revoked, this one too: a new CSRF token on the next
//        request, then /login?reset=1 to sign in with the new password (owner decision on item 3).
//   401  the recovery session is over (its 5 minutes, or revoked): the expired state.
//   403  FORBIDDEN: another tab signed in with a password, so the page moves on.
//   422  the field error under the field (same_password among them). 503 and the network: retry.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { checkPassword } from "@souq/domain";
import { t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../../../components/auth/messages";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { PasswordField } from "../../../components/ui/PasswordField";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./reset.module.css";

const FIELD_ID = "reset-password";

/** The login page with its notice: a full load, so the header and the CSRF token start over. */
function afterReset(): URL {
  const url = new URL(routes.login, window.location.origin);
  url.searchParams.set("reset", "1");
  return url;
}

export function ResetForm() {
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure !== null || expired) feedback.current?.focus();
  }, [failure, expired]);

  function showFieldError(code: string): void {
    setError(fieldMessage("new_password", code));
    document.getElementById(FIELD_ID)?.focus();
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    const value = new FormData(event.currentTarget).get("new_password");
    const password = typeof value === "string" ? value : "";
    const rule = password === "" ? "required" : checkPassword(password);
    if (rule !== null) {
      showFieldError(rule);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const result = await api.request(routes.api.reset, { body: { new_password: password } });
    if (result.ok) {
      api.resetCsrfToken();
      window.location.assign(afterReset());
      return;
    }
    if (result.code === "FORBIDDEN") {
      window.location.assign(routes.home);
      return;
    }
    setSubmitting(false);
    if (result.code === "UNAUTHENTICATED") {
      setExpired(true);
      return;
    }
    const field = result.fieldErrors.find((item) => item.field === "new_password");
    if (result.code === "VALIDATION_FAILED" && field !== undefined) {
      showFieldError(field.code);
      return;
    }
    setFailure(result);
  }

  if (expired) {
    return (
      <div ref={feedback} tabIndex={-1} className={styles.closed}>
        <Alert variant="warning" title={t("auth.reset.expired.title")} live>
          {t("auth.reset.expired.body")}
        </Alert>
        <p>
          <a href={routes.recover}>{t("auth.reset.requestLink")}</a>
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <p className={styles.intro}>{t("auth.reset.intro")}</p>
      {failure !== null && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          <FailureAlert title={t("auth.reset.formError")} failure={failure} />
        </div>
      )}
      <PasswordField
        id={FIELD_ID}
        name="new_password"
        label={t("auth.reset.password.label")}
        error={error}
        autoComplete="new-password"
      />
      <p className={styles.after}>{t("auth.reset.after")}</p>
      <Button
        type="submit"
        fullWidth
        loading={submitting}
        loadingLabel={t("auth.reset.submitting")}
      >
        {t("auth.reset.submit")}
      </Button>
    </form>
  );
}
