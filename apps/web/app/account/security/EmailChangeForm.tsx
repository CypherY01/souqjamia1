"use client";

// The email change (API020, task 3.6): FR59, BR23, DEC38, DEC79, RL03. Behind the 5-minute
// reauthentication window (member_reauth): while it is closed the page shows the password form
// (API009) first. When the server answers REAUTH_REQUIRED (the window closed meanwhile), the
// password form comes back. After 202 both links are on their way, and the old address stays the
// login until both are opened (the pending state).
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { parseEmail } from "@souq/domain";
import { formatDateTime, formatWait, t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../../../components/auth/messages";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/Field";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import { ReauthForm } from "../../../components/account/ReauthForm";
import styles from "./security.module.css";

const EMAIL_ID = "new-email";

interface EmailChangeFormProps {
  siteKey: string;
  /** The end of the reauthentication window when the page was rendered, or null if closed. */
  reauthUntil: string | null;
  pendingEmail: string | null;
  blockedReason?: string;
}

export function EmailChangeForm({
  siteKey,
  reauthUntil,
  pendingEmail,
  blockedReason,
}: EmailChangeFormProps) {
  const [until, setUntil] = useState<string | null>(reauthUntil);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState<string | null>(pendingEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sent || failure !== null) feedback.current?.focus();
  }, [sent, failure]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setSent(false);
    const field = new FormData(event.currentTarget).get("new_email");
    const email = parseEmail(typeof field === "string" ? field : "");
    if (!email.ok) {
      setError(fieldMessage("new_email", email.error));
      document.getElementById(EMAIL_ID)?.focus();
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const result = await api.request(routes.api.emailChange, { body: { new_email: email.value } });
    setSubmitting(false);
    if (result.ok) {
      setPending(email.value);
      setSent(true);
      return;
    }
    if (result.code === "REAUTH_REQUIRED") {
      setUntil(null);
      setExpired(true);
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      const code = result.fieldErrors.find((item) => item.field === "new_email")?.code;
      setError(fieldMessage("new_email", code ?? "invalid_format"));
      document.getElementById(EMAIL_ID)?.focus();
      return;
    }
    setFailure(result);
  }

  return (
    <div className={styles.block}>
      {pending !== null && (
        <Alert variant="info" title={t("account.security.email.pending.title")}>
          <p>{t("account.security.email.pending.body")}</p>
          <p>
            {t("account.security.email.pending.address")}{" "}
            <bdi dir="ltr" className={styles.address}>
              {pending}
            </bdi>
          </p>
        </Alert>
      )}
      {(sent || failure !== null) && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          {sent && (
            <Alert variant="success" title={t("account.security.email.sent.title")} live>
              {t("account.security.email.sent.body")}
            </Alert>
          )}
          {failure !== null && <EmailFailure failure={failure} />}
        </div>
      )}
      {until === null ? (
        <ReauthForm
          siteKey={siteKey}
          expired={expired}
          blockedReason={blockedReason}
          onDone={(value) => {
            setExpired(false);
            setUntil(value);
          }}
        />
      ) : (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <p className={styles.note} role="status">
            {t("account.security.reauth.until", { time: formatDateTime(until) })}
          </p>
          <TextField
            id={EMAIL_ID}
            name="new_email"
            type="email"
            dir="ltr"
            label={t("account.security.email.label")}
            hint={t("account.security.email.hint")}
            error={error}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
          />
          <Button
            type="submit"
            loading={submitting}
            loadingLabel={t("account.security.email.submitting")}
            disabledReason={blockedReason}
          >
            {t("account.security.email.submit")}
          </Button>
        </form>
      )}
    </div>
  );
}

function EmailFailure({ failure }: { failure: ApiFailure }) {
  const title = t("account.security.email.formError");
  if (failure.code === "RATE_LIMITED" && failure.retryAfter !== null) {
    return (
      <Alert variant="danger" title={title} live>
        {t("account.security.email.rateLimited", { wait: formatWait(failure.retryAfter) })}
      </Alert>
    );
  }
  return <FailureAlert title={title} failure={failure} />;
}
