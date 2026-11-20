// /account/reset (task 3.4, plan/screens.md): API008, for the recovery session only and within
// its 5 minutes (DEC38, DEC73). A live ordinary session goes to the home page (its password
// changes from the account page, task 3.6). A guest, and a recovery session past its 5 minutes,
// see why the page is closed, with a link to ask for a new one. The proxy sends no Referer and
// forbids storing the page, like the link pages.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@souq/i18n";
import { Alert } from "../../../components/ui/Alert";
import { recoveryDenial } from "../../../lib/auth/guards";
import { pageSession } from "../../../lib/auth/page";
import { routes } from "../../../lib/routes";
import { ResetForm } from "./ResetForm";
import styles from "./reset.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.reset.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ResetPage() {
  const auth = await pageSession();
  const denial = recoveryDenial(auth?.identity ?? null);
  if (denial === "FORBIDDEN") redirect(routes.home);
  return (
    <div className={styles.page}>
      <h1>{t("auth.reset.pageTitle")}</h1>
      {denial === null ? <ResetForm /> : <Closed expired={auth !== null} />}
    </div>
  );
}

/** A guest, or a recovery session past its 5 minutes. */
function Closed({ expired }: { expired: boolean }) {
  return (
    <div className={styles.closed}>
      <Alert
        variant="warning"
        title={t(expired ? "auth.reset.expired.title" : "auth.reset.guest.title")}
      >
        {t(expired ? "auth.reset.expired.body" : "auth.reset.guest.body")}
      </Alert>
      <p>
        <a href={routes.recover}>{t("auth.reset.requestLink")}</a>
      </p>
    </div>
  );
}
