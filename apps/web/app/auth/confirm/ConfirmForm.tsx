"use client";

// The button of the confirmation link page (task 3.2, item 5): API004 on a click only. The token
// leaves the address as soon as the page runs (history.replaceState), so it is not kept in the
// history, bookmarks or a shared screenshot. A spent or old link shows the resend form (DEC37).
import { useEffect, useState } from "react";
import { t } from "@souq/i18n";
import { FailureAlert } from "../../../components/auth/messages";
import { ResendForm } from "../../../components/auth/ResendForm";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./confirm.module.css";

interface ConfirmFormProps {
  tokenHash: string | null;
  siteKey: string;
}

export function ConfirmForm({ tokenHash, siteKey }: ConfirmFormProps) {
  const [state, setState] = useState<"ready" | "sending" | "invalid">(
    tokenHash === null ? "invalid" : "ready",
  );
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    if (window.location.search !== "") {
      window.history.replaceState(null, "", routes.confirmEmail);
    }
  }, []);

  async function confirm(): Promise<void> {
    if (tokenHash === null) return;
    setState("sending");
    setFailure(null);
    const result = await api.request("/api/auth/confirm", { body: { token_hash: tokenHash } });
    if (result.ok) {
      window.location.assign(result.location ?? routes.login);
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
      <>
        <Alert
          variant="warning"
          title={t(missing ? "auth.confirm.missing.title" : "auth.confirm.invalid.title")}
          live={!missing}
        >
          {t(missing ? "auth.confirm.missing.body" : "auth.confirm.invalid.body")}
        </Alert>
        <ResendForm siteKey={siteKey} />
      </>
    );
  }

  return (
    <div className={styles.confirm}>
      <p>{t("auth.confirm.body")}</p>
      {failure !== null && <FailureAlert title={t("ui.alert.danger")} failure={failure} />}
      <Button
        fullWidth
        loading={state === "sending"}
        loadingLabel={t("auth.confirm.submitting")}
        onClick={() => {
          void confirm();
        }}
      >
        {t("auth.confirm.submit")}
      </Button>
    </div>
  );
}
