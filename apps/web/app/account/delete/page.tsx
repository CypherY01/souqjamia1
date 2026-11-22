// /account/delete «حذف الحساب» (task 3.7, plan/screens.md): API009 and API026. The consequences
// come before the confirmation (FR72, DEC39, DEC41, RET06, DEC61). The reauthentication window
// (DEC38) comes from the session's own amr, so the page knows whether to ask for the password
// first. DEC81: a member who has not acknowledged new policy versions may still leave; a
// restricted account or one already awaiting deletion is sent to /restricted by the page guard.
import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { Alert } from "../../../components/ui/Alert";
import { accountOwnerDenial, openReauthWindow } from "../../../lib/auth/guards";
import { requireMemberPage } from "../../../lib/auth/page";
import { serverEnv } from "../../../lib/env";
import { routes } from "../../../lib/routes";
import { DeleteAccountForm } from "./DeleteAccountForm";
import styles from "./delete.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("account.delete.pageTitle") };

const CONSEQUENCES = [
  "hidden",
  "cancelled",
  "signedOut",
  "period",
  "final",
  "restrictions",
] as const;

export default async function DeleteAccountPage() {
  const auth = await requireMemberPage(routes.account.delete);
  const blockedReason =
    accountOwnerDenial(auth.state) === "EMAIL_NOT_CONFIRMED"
      ? t("account.delete.blocked.EMAIL_NOT_CONFIRMED")
      : undefined;
  const reauthUntil = openReauthWindow(auth.identity);

  return (
    <div className={styles.page}>
      <h1>{t("account.delete.pageTitle")}</h1>
      <p className={styles.intro}>{t("account.delete.intro")}</p>
      {blockedReason !== undefined && (
        <div className={styles.feedback}>
          <Alert variant="warning" title={t("ui.alert.warning")}>
            {blockedReason}
          </Alert>
        </div>
      )}

      <section className={styles.section} aria-labelledby="delete-consequences-title">
        <h2 id="delete-consequences-title">{t("account.delete.consequences.title")}</h2>
        <ul className={styles.list}>
          {CONSEQUENCES.map((key) => (
            <li key={key}>{t(`account.delete.consequences.${key}`)}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="delete-confirm-title">
        <h2 id="delete-confirm-title">{t("account.delete.confirm.title")}</h2>
        <DeleteAccountForm
          siteKey={serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          reauthUntil={reauthUntil?.toISOString() ?? null}
          blockedReason={blockedReason}
        />
      </section>

      <p className={styles.back}>
        <a href={routes.account.home}>{t("account.delete.back")}</a>
      </p>
    </div>
  );
}
