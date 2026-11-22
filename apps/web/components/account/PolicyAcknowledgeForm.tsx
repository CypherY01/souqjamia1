"use client";

// API119 (DEC69, task 3.5, item 8): the member acknowledges the terms and privacy versions in
// force, published after signup. The first form for it: the account page shows it while
// TERMS_NOT_ACKNOWLEDGED blocks every market write (DEC36).
//   204  done: the page reloads, and the notice is gone.
//   409  STATE_CONFLICT: a newer version came out meanwhile; reload to read it.
//   else the failure alert, with a retry.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { t } from "@souq/i18n";
import { FailureAlert } from "../auth/messages";
import { Alert } from "../ui/Alert";
import { SubmitButton } from "../ui/SubmitButton";
import { Checkbox } from "../ui/Field";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import styles from "./PolicyAcknowledgeForm.module.css";

export interface PolicyLink {
  version: string;
  path: string;
}

interface PolicyAcknowledgeFormProps {
  terms: PolicyLink;
  privacy: PolicyLink;
}

type Errors = Partial<Record<"accept_terms" | "acknowledge_privacy", string>>;

export function PolicyAcknowledgeForm({ terms, privacy }: PolicyAcknowledgeFormProps) {
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure !== null || conflict) feedback.current?.focus();
  }, [failure, conflict]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    const form = new FormData(event.currentTarget);
    const next: Errors = {};
    if (form.get("accept_terms") !== "on")
      next.accept_terms = t("account.home.terms.termsRequired");
    if (form.get("acknowledge_privacy") !== "on") {
      next.acknowledge_privacy = t("account.home.terms.privacyRequired");
    }
    setErrors(next);
    if (next.accept_terms !== undefined) {
      document.getElementById("ack-terms")?.focus();
      return;
    }
    if (next.acknowledge_privacy !== undefined) {
      document.getElementById("ack-privacy")?.focus();
      return;
    }
    setSubmitting(true);
    const result = await api.request(routes.api.policyAcknowledgments, {
      body: {
        terms_version: terms.version,
        privacy_version: privacy.version,
        accept_terms: true,
        acknowledge_privacy: true,
      },
    });
    if (result.ok) {
      window.location.reload();
      return;
    }
    setSubmitting(false);
    if (result.code === "STATE_CONFLICT") {
      setConflict(true);
      return;
    }
    setFailure(result);
  }

  if (conflict) {
    return (
      <div ref={feedback} tabIndex={-1} className={styles.feedback}>
        <Alert variant="warning" title={t("account.home.terms.conflict.title")} live>
          <p>{t("account.home.terms.conflict.body")}</p>
          <p>
            <a href={routes.account.home}>{t("account.home.terms.reload")}</a>
          </p>
        </Alert>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      method="post"
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      {failure !== null && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          <FailureAlert title={t("account.home.terms.formError")} failure={failure} />
        </div>
      )}
      <Checkbox
        id="ack-terms"
        name="accept_terms"
        label={t("account.home.terms.acceptTerms")}
        error={errors.accept_terms}
        extra={
          <a href={terms.path} target="_blank" rel="noopener">
            {t("account.home.terms.termsLink")}
            <span className="visually-hidden"> {t("ui.newTab")}</span>
          </a>
        }
      />
      <Checkbox
        id="ack-privacy"
        name="acknowledge_privacy"
        label={t("account.home.terms.acknowledgePrivacy")}
        error={errors.acknowledge_privacy}
        extra={
          <a href={privacy.path} target="_blank" rel="noopener">
            {t("account.home.terms.privacyLink")}
            <span className="visually-hidden"> {t("ui.newTab")}</span>
          </a>
        }
      />
      <div>
        <SubmitButton loading={submitting} loadingLabel={t("account.home.terms.submitting")}>
          {t("account.home.terms.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}
