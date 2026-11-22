// /auth/account-recovery/done (task 3.7): where API028 leads. The deletion request is cancelled;
// a suspension or ban stays (TC59), and what the request cancelled does not come back (DEC39).
// The link's session never reached this browser, so a guest signs in with the password; a
// browser already signed in (the deletion-pending session it signed in with) goes to its account.
import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { Alert } from "../../../../components/ui/Alert";
import { LinkButton } from "../../../../components/ui/Button";
import { pageSession } from "../../../../lib/auth/page";
import { routes } from "../../../../lib/routes";
import styles from "../account-recovery.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.accountRecoveryDone.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function AccountRecoveryDonePage() {
  const auth = await pageSession();
  const signedIn = auth !== null && !auth.identity.limited;
  return (
    <div className={styles.page}>
      <h1>{t("auth.accountRecoveryDone.pageTitle")}</h1>
      <div className={styles.link}>
        <Alert variant="success" title={t("auth.accountRecoveryDone.title")}>
          {t("auth.accountRecoveryDone.body")}
        </Alert>
        <LinkButton href={signedIn ? routes.account.home : routes.login} fullWidth>
          {t(signedIn ? "auth.accountRecoveryDone.account" : "auth.accountRecoveryDone.login")}
        </LinkButton>
      </div>
    </div>
  );
}
