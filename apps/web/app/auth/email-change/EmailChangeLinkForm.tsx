"use client";

// The button of the email change link page (task 3.6): API021 on a click only. The token leaves
// the address as soon as the page runs (history.replaceState), so it is not kept in the history,
// bookmarks or a shared screenshot. API021 answers 303 to the done page; fetch follows it and the
// page goes there with a full load (the session cookies may have been removed).
//   invalid  a spent, old or replaced link (DEC37): a new request starts on the security page.
import { useEffect, useState } from "react";
import { t } from "@souq/i18n";
import { FailureAlert } from "../../../components/auth/messages";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./email-change.module.css";

type LinkState = "ready" | "sending" | "invalid";

export function EmailChangeLinkForm({ tokenHash }: { tokenHash: string | null }) {
  const [state, setState] = useState<LinkState>(tokenHash === null ? "invalid" : "ready");
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    if (window.location.search !== "") {
      window.history.replaceState(null, "", routes.emailChangeLink);
    }
  }, []);

  async function confirm(): Promise<void> {
    if (tokenHash === null) return;
    setState("sending");
    setFailure(null);
    const result = await api.request(routes.api.emailChangeConfirm, {
      body: { token_hash: tokenHash },
    });
    if (result.ok) {
      window.location.assign(result.location ?? routes.emailChangeDone);
      return;
    }
    if (result.code === "LINK_INVALID_OR_EXPIRED") {
      setState("invalid");
      return;
    }
    setState("ready");
    setFailure(result);
  }

  if (state === "invalid") {
    const missing = tokenHash === null;
    return (
      <div className={styles.link}>
        <Alert
          variant="warning"
          title={t(
            missing ? "auth.emailChangeLink.missing.title" : "auth.emailChangeLink.invalid.title",
          )}
          live={!missing}
        >
          {t(missing ? "auth.emailChangeLink.missing.body" : "auth.emailChangeLink.invalid.body")}
        </Alert>
        <p>
          <a href={routes.account.security}>{t("auth.emailChangeLink.toSecurity")}</a>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.link}>
      <p>{t("auth.emailChangeLink.body")}</p>
      {failure !== null && <FailureAlert title={t("ui.alert.danger")} failure={failure} />}
      <Button
        fullWidth
        loading={state === "sending"}
        loadingLabel={t("auth.emailChangeLink.submitting")}
        onClick={() => {
          void confirm();
        }}
      >
        {t("auth.emailChangeLink.submit")}
      </Button>
    </div>
  );
}
