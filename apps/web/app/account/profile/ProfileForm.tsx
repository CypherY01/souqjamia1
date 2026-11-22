"use client";

// The profile edit (API016, task 3.5): FR49, TC21, DEC78. The name rules run here first with
// the function the server uses (parseDisplayName); the server stays the authority.
//   200  saved: the new version and values, a notice that takes the focus, and a refresh so the
//        site header shows the new name.
//   409  STATE_CONFLICT: the profile changed elsewhere since the page opened; show the current
//        values (a reload) before editing again.
//   422  the field error under its field. 429: the DEC78 wait. Anything else: the failure alert.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { parseDisplayName } from "@souq/domain";
import { formatWait, t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../../../components/auth/messages";
import { Alert } from "../../../components/ui/Alert";
import { SubmitButton } from "../../../components/ui/SubmitButton";
import { Select, TextField } from "../../../components/ui/Field";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./profile.module.css";

export type Blocked = "EMAIL_NOT_CONFIRMED" | "TERMS_NOT_ACKNOWLEDGED";

interface ProfileValues {
  displayName: string;
  /** "" for no college. */
  collegeId: string;
  version: number;
}

interface ProfileFormProps {
  initial: ProfileValues;
  colleges: { value: string; label: string }[];
  blocked: Blocked | null;
}

interface MeData {
  display_name: string;
  college: { id: string } | null;
  version: number;
}

type Errors = Partial<Record<"display_name" | "college_id", string>>;

type Notice = "saved" | "unchanged" | "conflict" | null;

const NAME_ID = "profile-name";
const COLLEGE_ID = "profile-college";

export function ProfileForm({ initial, colleges, blocked }: ProfileFormProps) {
  const router = useRouter();
  const [saved, setSaved] = useState<ProfileValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure !== null || notice !== null) feedback.current?.focus();
  }, [failure, notice]);

  function showFieldErrors(next: Errors): void {
    setErrors(next);
    if (next.display_name !== undefined) document.getElementById(NAME_ID)?.focus();
    else if (next.college_id !== undefined) document.getElementById(COLLEGE_ID)?.focus();
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const nameValue = form.get("display_name");
    const collegeValue = form.get("college_id");
    const name = parseDisplayName(typeof nameValue === "string" ? nameValue : "");
    if (!name.ok) {
      showFieldErrors({ display_name: fieldMessage("display_name", name.error) });
      return;
    }
    setErrors({});
    const collegeId = typeof collegeValue === "string" ? collegeValue : "";
    if (name.value === saved.displayName && collegeId === saved.collegeId) {
      setNotice("unchanged");
      return;
    }

    setSubmitting(true);
    const result = await api.request<MeData>(routes.api.profile, {
      method: "PATCH",
      body: {
        display_name: name.value,
        college_id: collegeId === "" ? null : collegeId,
        expected_version: saved.version,
      },
    });
    setSubmitting(false);
    if (result.ok) {
      setSaved({
        displayName: result.data.display_name,
        collegeId: result.data.college?.id ?? "",
        version: result.data.version,
      });
      setNotice("saved");
      router.refresh();
      return;
    }
    if (result.code === "STATE_CONFLICT") {
      setNotice("conflict");
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      const next: Errors = {};
      for (const item of result.fieldErrors) {
        if (item.field === "display_name" || item.field === "college_id") {
          next[item.field] = fieldMessage(item.field, item.code);
        }
      }
      if (Object.keys(next).length > 0) {
        showFieldErrors(next);
        return;
      }
    }
    setFailure(result);
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
      {(notice !== null || failure !== null) && (
        <div ref={feedback} tabIndex={-1} className={styles.feedback}>
          {notice === "saved" && (
            <Alert variant="success" title={t("account.profile.saved")} live />
          )}
          {notice === "unchanged" && (
            <Alert variant="info" title={t("account.profile.unchanged")} live />
          )}
          {notice === "conflict" && (
            <Alert variant="warning" title={t("account.profile.conflict.title")} live>
              <p>{t("account.profile.conflict.body")}</p>
              <p>
                <a href={routes.account.profile}>{t("account.profile.conflict.reload")}</a>
              </p>
            </Alert>
          )}
          {failure !== null &&
            (failure.code === "RATE_LIMITED" && failure.retryAfter !== null ? (
              <Alert variant="danger" title={t("account.profile.formError")} live>
                <p>{t("account.profile.rateLimited", { wait: formatWait(failure.retryAfter) })}</p>
              </Alert>
            ) : (
              <FailureAlert title={t("account.profile.formError")} failure={failure} />
            ))}
        </div>
      )}
      <TextField
        id={NAME_ID}
        name="display_name"
        label={t("account.profile.name.label")}
        hint={t("account.profile.name.hint")}
        error={errors.display_name}
        defaultValue={initial.displayName}
        autoComplete="name"
      />
      <Select
        id={COLLEGE_ID}
        name="college_id"
        label={t("account.profile.college.label")}
        hint={t("account.profile.college.hint")}
        error={errors.college_id}
        placeholder={t("account.profile.college.placeholder")}
        options={colleges}
        defaultValue={initial.collegeId}
        optional
      />
      <div>
        <SubmitButton
          disabledReason={blocked === null ? undefined : t(`account.profile.blocked.${blocked}`)}
          loading={submitting}
          loadingLabel={t("account.profile.submitting")}
        >
          {t("account.profile.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}
