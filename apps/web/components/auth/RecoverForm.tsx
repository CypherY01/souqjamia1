"use client";

// Ask for a recovery link (API006, task 3.4): FR03, DEC37, DEC52, RL03. On /recover, and on the
// link page after a spent or old link. The answer is the same for any address (no enumeration);
// after it the button waits 60 seconds, as RL03 does on the server, and a 429 shows the wait.
// The address never goes into the page address (privacy).
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { parseEmail } from "@souq/domain";
import { formatWait, t } from "@souq/i18n";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { FailureAlert, fieldMessage } from "./messages";
import { Turnstile, type TurnstileHandle } from "./Turnstile";
import styles from "./RecoverForm.module.css";

const COOLDOWN_SECONDS = 60;
const EMAIL_ID = "recover-email";

export function RecoverForm({ siteKey }: { siteKey: string }) {
  const captcha = useRef<TurnstileHandle>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [sent, setSent] = useState(false);
  const [captchaPending, setCaptchaPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      setWait((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  // A result moves focus to its message (task 3.3, item 6).
  useEffect(() => {
    if (sent || failure !== null) feedback.current?.focus();
  }, [sent, failure]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setSent(false);
    setCaptchaPending(false);
    const field = new FormData(event.currentTarget).get("email");
    const email = parseEmail(typeof field === "string" ? field : "");
    if (!email.ok) {
      setError(fieldMessage("email", email.error));
      document.getElementById(EMAIL_ID)?.focus();
      return;
    }
    setError(undefined);
    if (token === null) {
      setCaptchaPending(true);
      return;
    }
    setSubmitting(true);
    const result = await api.request(routes.api.recovery, {
      body: { email: email.value, captcha_token: token },
    });
    setSubmitting(false);
    // A token is spent by every call that reached Supabase Auth.
    captcha.current?.reset();
    if (result.ok) {
      setSent(true);
      setWait(COOLDOWN_SECONDS);
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      const code = result.fieldErrors.find((item) => item.field === "email")?.code;
      setError(fieldMessage("email", code ?? "invalid_format"));
      document.getElementById(EMAIL_ID)?.focus();
      return;
    }
    if (result.code === "RATE_LIMITED" && result.retryAfter !== null) setWait(result.retryAfter);
    setFailure(result);
  }

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      {(sent || failure !== null) && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          {sent && (
            <Alert variant="success" title={t("auth.recover.sent.title")} live>
              {t("auth.recover.sent.body")}
            </Alert>
          )}
          {failure !== null && <RecoverFailure failure={failure} />}
        </div>
      )}
      <TextField
        id={EMAIL_ID}
        name="email"
        type="email"
        dir="ltr"
        label={t("auth.recover.email.label")}
        error={error}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
      />
      <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />
      {captchaPending && (
        <p className={styles.status} role="status">
          {t("auth.captcha.pending")}
        </p>
      )}
      <Button
        type="submit"
        fullWidth
        variant={sent ? "secondary" : "primary"}
        loading={submitting}
        loadingLabel={t("auth.recover.submitting")}
        disabledReason={wait > 0 ? t("auth.recover.wait", { seconds: wait }) : undefined}
      >
        {t(sent ? "auth.recover.again" : "auth.recover.submit")}
      </Button>
    </form>
  );
}

/** The wait for a limit in words (formatWait), otherwise the shared alert. */
function RecoverFailure({ failure }: { failure: ApiFailure }) {
  const title = t("auth.recover.formError");
  if (failure.code === "RATE_LIMITED" && failure.retryAfter !== null) {
    return (
      <Alert variant="danger" title={title} live>
        {t("auth.recover.rateLimited", { wait: formatWait(failure.retryAfter) })}
      </Alert>
    );
  }
  return <FailureAlert title={title} failure={failure} />;
}
