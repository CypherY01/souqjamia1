"use client";

// The button of the recovery link page (task 3.4): API007 on a click only. The token leaves the
// address as soon as the page runs (history.replaceState), so it is not kept in the history,
// bookmarks or a shared screenshot. API007 answers 303 to /account/reset with the recovery
// session; fetch follows it and the page goes there with a full load.
//   signed in  another account is signed in here (403 FORBIDDEN, or shown by the page first):
//              one button signs it out (API003), then sends API007 with the same token, with no
//              further step (owner decision on item 2). The link is not spent until then.
//   invalid    a spent, old or superseded link: a form for a new one (DEC37).
import { useEffect, useState } from "react";
import { t } from "@souq/i18n";
import { FailureAlert } from "../../../components/auth/messages";
import { RecoverForm } from "../../../components/auth/RecoverForm";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { api, type ApiFailure } from "../../../lib/client/api";
import { routes } from "../../../lib/routes";
import styles from "./recover-link.module.css";

interface RecoverLinkFormProps {
  tokenHash: string | null;
  /** A live ordinary session in this browser (the page checked it). */
  signedIn: boolean;
  siteKey: string;
}

type LinkState = "ready" | "sending" | "signedIn" | "leaving" | "invalid";

export function RecoverLinkForm({ tokenHash, signedIn, siteKey }: RecoverLinkFormProps) {
  const [state, setState] = useState<LinkState>(
    tokenHash === null ? "invalid" : signedIn ? "signedIn" : "ready",
  );
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    if (window.location.search !== "") {
      window.history.replaceState(null, "", routes.recoverLink);
    }
  }, []);

  async function spend(): Promise<void> {
    if (tokenHash === null) return;
    setState("sending");
    setFailure(null);
    const result = await api.request(routes.api.recoveryVerify, {
      body: { token_hash: tokenHash },
    });
    if (result.ok) {
      window.location.assign(result.location ?? routes.account.reset);
      return;
    }
    if (result.code === "LINK_INVALID_OR_EXPIRED") {
      setState("invalid");
      return;
    }
    if (result.code === "FORBIDDEN") {
      // Another tab signed in meanwhile.
      setState("signedIn");
      return;
    }
    setState("ready");
    setFailure(result);
  }

  async function signOutAndContinue(): Promise<void> {
    setState("leaving");
    setFailure(null);
    const result = await api.request(routes.api.logout);
    // 401: that session had already ended, which is signed out too (task 3.3).
    if (!result.ok && result.code !== "UNAUTHENTICATED") {
      setState("signedIn");
      setFailure(result);
      return;
    }
    // The guest binding changed with the sign-out (task 1.6).
    api.resetCsrfToken();
    await spend();
  }

  if (state === "invalid") {
    const missing = tokenHash === null;
    return (
      <>
        <Alert
          variant="warning"
          title={t(missing ? "auth.recoverLink.missing.title" : "auth.recoverLink.invalid.title")}
          live={!missing}
        >
          {t(missing ? "auth.recoverLink.missing.body" : "auth.recoverLink.invalid.body")}
        </Alert>
        <section className={styles.newLink} aria-labelledby="new-link-title">
          <h2 id="new-link-title" className={styles.title}>
            {t("auth.recoverLink.newLink")}
          </h2>
          <RecoverForm siteKey={siteKey} />
        </section>
      </>
    );
  }

  if (state === "signedIn" || state === "leaving") {
    return (
      <div className={styles.link}>
        <Alert variant="warning" title={t("auth.recoverLink.signedIn.title")}>
          {t("auth.recoverLink.signedIn.body")}
        </Alert>
        {failure !== null && <FailureAlert title={t("ui.alert.danger")} failure={failure} />}
        <Button
          fullWidth
          loading={state === "leaving"}
          loadingLabel={t("auth.recoverLink.signingOut")}
          onClick={() => {
            void signOutAndContinue();
          }}
        >
          {t("auth.recoverLink.signOutAndContinue")}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.link}>
      <p>{t("auth.recoverLink.body")}</p>
      {failure !== null && <FailureAlert title={t("ui.alert.danger")} failure={failure} />}
      <Button
        fullWidth
        loading={state === "sending"}
        loadingLabel={t("auth.recoverLink.submitting")}
        onClick={() => {
          void spend();
        }}
      >
        {t("auth.recoverLink.submit")}
      </Button>
    </div>
  );
}
