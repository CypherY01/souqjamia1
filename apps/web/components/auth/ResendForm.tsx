"use client";

// Resend the confirmation link (API005, task 3.2 items 5 and 6): DEC37, RL03. Shown after a
// signup while confirmation is on, and on the link page when the link is spent or too old. The
// answer is the same for any address (no enumeration); after it the button waits 60 seconds,
// as RL03 does on the server, and a 429 shows the server's wait.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { parseEmail } from "@souq/domain";
import { t } from "@souq/i18n";
import { api, type ApiFailure } from "../../lib/client/api";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { FailureAlert, fieldMessage } from "./messages";
import { Turnstile, type TurnstileHandle } from "./Turnstile";
import styles from "./ResendForm.module.css";

const COOLDOWN_SECONDS = 60;

interface ResendFormProps {
  siteKey: string;
  /** The address just used for signup; otherwise the visitor types it. */
  email?: string;
}

export function ResendForm({ siteKey, email: knownEmail }: ResendFormProps) {
  const captcha = useRef<TurnstileHandle>(null);
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

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setCaptchaPending(false);
    const field = new FormData(event.currentTarget).get("email");
    const typed = knownEmail ?? (typeof field === "string" ? field : "");
    const email = parseEmail(typed);
    if (!email.ok) {
      setError(fieldMessage("email", email.error));
      document.getElementById("resend-email")?.focus();
      return;
    }
    setError(undefined);
    if (token === null) {
      setCaptchaPending(true);
      return;
    }
    setSubmitting(true);
    const result = await api.request("/api/auth/resend", {
      body: { email: email.value, purpose: "signup", captcha_token: token },
    });
    setSubmitting(false);
    captcha.current?.reset();
    if (result.ok) {
      setSent(true);
      setWait(COOLDOWN_SECONDS);
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      const code = result.fieldErrors.find((item) => item.field === "email")?.code;
      setError(fieldMessage("email", code ?? "invalid_format"));
      return;
    }
    if (result.code === "RATE_LIMITED" && result.retryAfter !== null) setWait(result.retryAfter);
    setFailure(result);
  }

  return (
    <section className={styles.resend} aria-labelledby="resend-title">
      <h2 id="resend-title" className={styles.title}>
        {t("auth.resend.title")}
      </h2>
      <p>{t("auth.resend.body")}</p>
      <form
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        {sent && (
          <Alert variant="success" title={t("ui.alert.success")} live>
            {t("auth.resend.sent")}
          </Alert>
        )}
        {failure !== null && <FailureAlert title={t("ui.alert.danger")} failure={failure} />}
        {knownEmail === undefined && (
          <TextField
            id="resend-email"
            name="email"
            type="email"
            dir="ltr"
            label={t("auth.signup.email.label")}
            error={error}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
        <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />
        {captchaPending && (
          <p className={styles.status} role="status">
            {t("auth.captcha.pending")}
          </p>
        )}
        <Button
          type="submit"
          variant="secondary"
          loading={submitting}
          loadingLabel={t("auth.resend.submitting")}
          disabledReason={wait > 0 ? t("auth.resend.wait", { seconds: wait }) : undefined}
        >
          {t("auth.resend.submit")}
        </Button>
      </form>
    </section>
  );
}
