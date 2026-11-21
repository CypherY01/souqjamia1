// /account/security «الأمان» (task 3.6, plan/screens.md): API009, API020 and API022, and the
// pending state of an email change ("waiting for both addresses", API015 pending_email). Read on
// the server through app.me() (DEC77). The reauthentication window (DEC38) comes from the
// session's own amr, so the page knows whether to ask for the password before the email form.
// An unconfirmed member, or one who has not acknowledged new policy versions, sees why the forms
// cannot be sent (both APIs refuse them).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { t } from "@souq/i18n";
import { Alert } from "../../../components/ui/Alert";
import { loadAccount } from "../../../lib/account/me";
import { memberDenial, openReauthWindow } from "../../../lib/auth/guards";
import { requireMemberPage } from "../../../lib/auth/page";
import { appDb } from "../../../lib/db/app-client";
import { serverEnv } from "../../../lib/env";
import { traceIdOf } from "../../../lib/http/trace";
import { routes } from "../../../lib/routes";
import { EmailChangeForm } from "./EmailChangeForm";
import { PasswordChangeForm } from "./PasswordChangeForm";
import styles from "./security.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("account.security.pageTitle") };

export default async function SecurityPage() {
  const auth = await requireMemberPage(routes.account.security);
  const traceId = traceIdOf(await headers());
  const { me, state } = await loadAccount(appDb(), auth.identity, traceId);
  const denial = memberDenial(state);
  const blockedReason =
    denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED"
      ? t(`account.security.blocked.${denial}`)
      : undefined;
  const reauthUntil = openReauthWindow(auth.identity);
  const siteKey = serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <div className={styles.page}>
      <h1>{t("account.security.pageTitle")}</h1>
      <p className={styles.intro}>{t("account.security.intro")}</p>
      {blockedReason !== undefined && (
        <div className={styles.feedback}>
          <Alert variant="warning" title={t("ui.alert.warning")}>
            {blockedReason}
          </Alert>
        </div>
      )}

      <section className={styles.section} aria-labelledby="security-email-title">
        <h2 id="security-email-title">{t("account.security.email.title")}</h2>
        <p className={styles.current}>
          {t("account.security.email.current")} <bdi dir="ltr">{me.email}</bdi>
        </p>
        <EmailChangeForm
          siteKey={siteKey}
          reauthUntil={reauthUntil?.toISOString() ?? null}
          pendingEmail={me.pending_email}
          blockedReason={blockedReason}
        />
      </section>

      <section className={styles.section} aria-labelledby="security-password-title">
        <h2 id="security-password-title">{t("account.security.password.title")}</h2>
        <PasswordChangeForm siteKey={siteKey} blockedReason={blockedReason} />
      </section>

      <p className={styles.back}>
        <a href={routes.account.home}>{t("account.security.back")}</a>
      </p>
    </div>
  );
}
