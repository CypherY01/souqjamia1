"use client";

// The button of the deletion recovery link page (task 3.7): API028 on a click only. The token
// leaves the address as soon as the page runs (history.replaceState). API028 answers 303 to the
// done page; fetch follows it and the page goes there with a full load.
//   invalid   a spent, old or superseded link, or one for an account not awaiting deletion: a new
//             link is asked from the account itself, after signing in with the password (DEC41)
//   deadline  the 30 days have passed (DEADLINE_PASSED, TC59)
import { useEffect, useState } from "react";
import { t } from "@souq/i18n";
import { FailureAlert } from "../../../components/auth/messages";
import { Alert } from "../../../components/ui/Alert";
import { Button, LinkButton } from "../../../components/ui/Button";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./account-recovery.module.css";

type LinkState = "ready" | "sending" | "invalid" | "deadline";

export function AccountRecoveryLinkForm({ tokenHash }: { tokenHash: string | null }) {
  const [state, setState] = useState<LinkState>(tokenHash === null ? "invalid" : "ready");
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    if (window.location.search !== "") {
      window.history.replaceState(null, "", routes.accountRecoveryLink);
    }
  }, []);

  async function spend(): Promise<void> {
    if (tokenHash === null) return;
    setState("sending");
    setFailure(null);
    const result = await api.request(routes.api.deletionRecoveryConfirm, {
      body: { token_hash: tokenHash },
    });
    if (result.ok) {
      window.location.assign(result.location ?? routes.accountRecoveryDone);
      return;
    }
    if (result.code === "LINK_INVALID_OR_EXPIRED") {
      setState("invalid");
      return;
    }
    if (result.code === "DEADLINE_PASSED") {
      setState("deadline");
      return;
    }
    setState("ready");
    setFailure(result);
  }

  if (state === "invalid" || state === "deadline") {
    const key = state === "deadline" ? "deadline" : tokenHash === null ? "missing" : "invalid";
    return (
      <div className={styles.link}>
        <Alert
          variant="warning"
          title={t(`auth.accountRecovery.${key}.title`)}
          live={tokenHash !== null}
        >
          {t(`auth.accountRecovery.${key}.body`)}
        </Alert>
        {state === "invalid" && (
          <LinkButton href={routes.login} variant="secondary" fullWidth>
            {t("auth.accountRecovery.login")}
          </LinkButton>
        )}
      </div>
    );
  }

  return (
    <div className={styles.link}>
      <p>{t("auth.accountRecovery.body")}</p>
      {failure !== null && (
        <FailureAlert title={t("auth.accountRecovery.formError")} failure={failure} />
      )}
      <Button
        fullWidth
        loading={state === "sending"}
        loadingLabel={t("auth.accountRecovery.submitting")}
        onClick={() => {
          void spend();
        }}
      >
        {t("auth.accountRecovery.submit")}
      </Button>
    </div>
  );
}
