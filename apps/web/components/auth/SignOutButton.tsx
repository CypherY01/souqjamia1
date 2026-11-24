"use client";

// Sign-out (task 3.3, item 1: the owner's finding in the review of task 3.2). API003 through the
// request tool, so it carries the CSRF token (SEC05); a plain HTML form could not. Then a full
// page load of the home page: the header is drawn again for a visitor, and nothing of the
// session stays in memory (TC56). The server signs the device out even when Supabase Auth does
// not answer (DEC76), so only a request that never got an answer shows the error; 401 means the
// session had already ended, which is signed out too.
import { useState } from "react";
import { t } from "@souq/i18n";
import { api } from "../../lib/client/api";
import { clearSellDraft } from "../../lib/client/sell-draft";
import { routes } from "../../lib/routes";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import styles from "./SignOutButton.module.css";

export type SignOutState = "idle" | "busy" | "failed";

interface SignOutButtonProps {
  /** For the /dev/ui gallery: shows this state, and a click sends nothing. */
  preview?: SignOutState;
}

export function SignOutButton({ preview }: SignOutButtonProps) {
  const [state, setState] = useState<SignOutState>(preview ?? "idle");

  async function signOut(): Promise<void> {
    if (preview !== undefined) return;
    setState("busy");
    const result = await api.request(routes.api.logout);
    if (result.ok || result.status === 401) {
      api.resetCsrfToken();
      // TC82 (task 4.2): the tab's wizard draft never outlives the session that wrote it.
      clearSellDraft();
      window.location.assign(routes.home);
      return;
    }
    setState("failed");
  }

  return (
    <div className={styles.signOut}>
      <Button
        variant="ghost"
        loading={state === "busy"}
        loadingLabel={t("auth.signOut.submitting")}
        onClick={() => {
          void signOut();
        }}
      >
        {t("auth.signOut.submit")}
      </Button>
      {state === "failed" && (
        <Alert variant="danger" title={t("auth.signOut.failed.title")} live>
          {t("auth.signOut.failed.body")}
        </Alert>
      )}
    </div>
  );
}
