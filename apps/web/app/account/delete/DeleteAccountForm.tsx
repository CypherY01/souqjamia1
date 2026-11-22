"use client";

// The deletion request (API026, task 3.7): DEC38, DEC41, DEC81. The password first when the
// reauthentication window is closed (API009, the shared ReauthForm), then one box and a danger
// button. Success: every session has ended and the browser's cookies are gone, so the CSRF token
// is fetched again for the next request, and the page says how to recover. REAUTH_REQUIRED (the
// window closed meanwhile) asks for the password again; an account that is or became restricted
// or deletion-pending goes to /restricted.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { formatDateTime, t } from "@souq/i18n";
import { ReauthForm } from "../../../components/account/ReauthForm";
import { FailureAlert } from "../../../components/auth/messages";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Checkbox } from "../../../components/ui/Field";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./delete.module.css";

interface DeleteAccountFormProps {
  siteKey: string;
  /** The end of the reauthentication window, or null when it is closed. */
  reauthUntil: string | null;
  /** Why the request cannot be sent (an unconfirmed email). */
  blockedReason?: string;
}

export function DeleteAccountForm({ siteKey, reauthUntil, blockedReason }: DeleteAccountFormProps) {
  const [until, setUntil] = useState<string | null>(reauthUntil);
  const [expired, setExpired] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done || failure !== null) feedback.current?.focus();
  }, [done, failure]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!acknowledged) return;
    setFailure(null);
    setSubmitting(true);
    const result = await api.request(routes.api.deletion, { body: { acknowledge: true } });
    setSubmitting(false);
    if (result.ok) {
      // The session has ended: the token bound to it no longer works (task 1.6).
      api.resetCsrfToken();
      setDone(true);
      return;
    }
    if (result.code === "REAUTH_REQUIRED") {
      setUntil(null);
      setExpired(true);
      return;
    }
    if (result.code === "DELETION_PENDING" || result.code === "ACCOUNT_RESTRICTED") {
      window.location.assign(routes.restricted);
      return;
    }
    setFailure(result);
  }

  if (done) {
    return (
      <div ref={feedback} tabIndex={-1} className={styles.feedback}>
        <Alert variant="success" title={t("account.delete.done.title")} live>
          <p>{t("account.delete.done.body")}</p>
          <p>
            <a href={routes.home}>{t("account.delete.done.home")}</a>
          </p>
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.block}>
      {failure !== null && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          <FailureAlert title={t("account.delete.confirm.formError")} failure={failure} />
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
          <Checkbox
            id="delete-acknowledge"
            name="acknowledge"
            label={t("account.delete.confirm.acknowledge")}
            checked={acknowledged}
            onChange={(event) => {
              setAcknowledged(event.currentTarget.checked);
            }}
          />
          <div>
            <Button
              type="submit"
              variant="danger"
              loading={submitting}
              loadingLabel={t("account.delete.confirm.submitting")}
              disabledReason={
                blockedReason ??
                (acknowledged ? undefined : t("account.delete.confirm.acknowledgeFirst"))
              }
            >
              {t("account.delete.confirm.submit")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
