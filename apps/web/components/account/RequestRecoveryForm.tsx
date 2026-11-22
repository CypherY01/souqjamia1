"use client";

// Ask for the deletion recovery link (API027, task 3.7): DEC37, DEC41, DEC52, RL03. On
// /restricted, for a signed-in account awaiting deletion whose period is still running: the
// address is the account's own, shown and not editable. The server answers the same for any
// address; after a sent link the button waits 60 seconds, as RL03 does, and a 429 shows the wait.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { formatWait, t } from "@souq/i18n";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import { FailureAlert } from "../auth/messages";
import { Turnstile, type TurnstileHandle } from "../auth/Turnstile";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import styles from "./RequestRecoveryForm.module.css";

const COOLDOWN_SECONDS = 60;

interface RequestRecoveryFormProps {
  email: string;
  siteKey: string;
  /** The /dev/ui gallery shows the form without a widget or a request. */
  preview?: boolean;
}

export function RequestRecoveryForm({ email, siteKey, preview = false }: RequestRecoveryFormProps) {
  const captcha = useRef<TurnstileHandle>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
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

  useEffect(() => {
    if (sent || failure !== null) feedback.current?.focus();
  }, [sent, failure]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (preview) return;
    setFailure(null);
    setSent(false);
    setCaptchaPending(false);
    if (token === null) {
      setCaptchaPending(true);
      return;
    }
    setSubmitting(true);
    const result = await api.request(routes.api.deletionRecoveryRequest, {
      body: { email, captcha_token: token },
    });
    setSubmitting(false);
    captcha.current?.reset();
    if (result.ok) {
      setSent(true);
      setWait(COOLDOWN_SECONDS);
      return;
    }
    if (result.code === "RATE_LIMITED" && result.retryAfter !== null) setWait(result.retryAfter);
    setFailure(result);
  }

  return (
    <section className={styles.section} aria-labelledby="recovery-title">
      <h2 id="recovery-title" className={styles.title}>
        {t("account.restricted.recovery.title")}
      </h2>
      <p className={styles.note}>{t("account.restricted.recovery.body")}</p>
      <p className={styles.address}>
        {t("account.restricted.recovery.address")}{" "}
        <bdi dir="ltr" className={styles.email}>
          {email}
        </bdi>
      </p>
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
              <Alert variant="success" title={t("account.restricted.recovery.sentTitle")} live>
                {t("account.restricted.recovery.sentBody")}
              </Alert>
            )}
            {failure !== null && <RecoveryFailure failure={failure} />}
          </div>
        )}
        {!preview && <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />}
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
          loadingLabel={t("account.restricted.recovery.submitting")}
          disabledReason={
            wait > 0 ? t("account.restricted.recovery.wait", { seconds: wait }) : undefined
          }
        >
          {t(sent ? "account.restricted.recovery.again" : "account.restricted.recovery.submit")}
        </Button>
      </form>
    </section>
  );
}

function RecoveryFailure({ failure }: { failure: ApiFailure }) {
  const title = t("account.restricted.recovery.formError");
  if (failure.code === "RATE_LIMITED" && failure.retryAfter !== null) {
    return (
      <Alert variant="danger" title={title} live>
        {t("account.restricted.recovery.rateLimited", { wait: formatWait(failure.retryAfter) })}
      </Alert>
    );
  }
  return <FailureAlert title={title} failure={failure} />;
}
