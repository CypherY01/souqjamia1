"use client";

// The optional email groups (API029, task 3.8): FR68, DEC49, DEC65. Every group is off until
// the member turns it on. The five values are sent together with the version.
//   200  saved: the new values and version, a notice that takes the focus.
//   409  STATE_CONFLICT: the preferences changed elsewhere since the page opened; show the
//        current ones (a reload) before editing again.
//   Anything else: the failure alert.
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { EMAIL_GROUPS, type EmailGroup } from "@souq/domain";
import { t } from "@souq/i18n";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import { FailureAlert } from "../auth/messages";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Field";
import styles from "./preferences.module.css";

export type PreferencesBlocked = "EMAIL_NOT_CONFIRMED" | "TERMS_NOT_ACKNOWLEDGED";

type Groups = Record<EmailGroup, boolean>;

interface PreferencesValues {
  groups: Groups;
  version: number;
}

interface PreferencesFormProps {
  initial: PreferencesValues;
  blocked: PreferencesBlocked | null;
  /** The /dev/ui preview sends nothing. */
  preview?: boolean;
  idPrefix?: string;
}

interface PreferencesData {
  email_groups: Groups;
  version: number;
}

type Notice = "saved" | "unchanged" | "conflict" | null;

export function PreferencesForm({
  initial,
  blocked,
  preview = false,
  idPrefix = "email-group",
}: PreferencesFormProps) {
  const [saved, setSaved] = useState<PreferencesValues>(initial);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure !== null || notice !== null) feedback.current?.focus();
  }, [failure, notice]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const groups = Object.fromEntries(
      EMAIL_GROUPS.map((group) => [group, form.get(group) === "on"]),
    ) as Groups;
    if (EMAIL_GROUPS.every((group) => groups[group] === saved.groups[group])) {
      setNotice("unchanged");
      return;
    }
    if (preview) {
      setSaved({ groups, version: saved.version + 1 });
      setNotice("saved");
      return;
    }

    setSubmitting(true);
    const result = await api.request<PreferencesData>(routes.api.preferences, {
      method: "PATCH",
      body: { email_groups: groups, expected_version: saved.version },
    });
    setSubmitting(false);
    if (result.ok) {
      setSaved({ groups: result.data.email_groups, version: result.data.version });
      setNotice("saved");
      return;
    }
    if (result.code === "STATE_CONFLICT") {
      setNotice("conflict");
      return;
    }
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
      {(notice !== null || failure !== null) && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          {notice === "saved" && (
            <Alert variant="success" title={t("notifications.preferences.saved")} live />
          )}
          {notice === "unchanged" && (
            <Alert variant="info" title={t("notifications.preferences.unchanged")} live />
          )}
          {notice === "conflict" && (
            <Alert variant="warning" title={t("notifications.preferences.conflict.title")} live>
              <p>{t("notifications.preferences.conflict.body")}</p>
              <p>
                <a href={routes.account.notifications}>
                  {t("notifications.preferences.conflict.reload")}
                </a>
              </p>
            </Alert>
          )}
          {failure !== null && (
            <FailureAlert title={t("notifications.preferences.formError")} failure={failure} />
          )}
        </div>
      )}
      <fieldset className={styles.groups}>
        <legend className={styles.legend}>{t("notifications.preferences.optional.legend")}</legend>
        {EMAIL_GROUPS.map((group) => (
          <Checkbox
            key={group}
            id={`${idPrefix}-${group}`}
            name={group}
            label={t(`notifications.preferences.groups.${group}.label`)}
            extra={t(`notifications.preferences.groups.${group}.hint`)}
            defaultChecked={initial.groups[group]}
          />
        ))}
      </fieldset>
      <div>
        <Button
          type="submit"
          disabledReason={
            blocked === null ? undefined : t(`notifications.preferences.blocked.${blocked}`)
          }
          loading={submitting}
          loadingLabel={t("notifications.preferences.submitting")}
        >
          {t("notifications.preferences.submit")}
        </Button>
      </div>
    </form>
  );
}
