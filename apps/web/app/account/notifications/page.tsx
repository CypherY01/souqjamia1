// /account/notifications «تفضيلات البريد» (task 3.8, plan/screens.md): API015 and API029.
// Security and administrative email is shown as always on, with no control that could suggest
// it can be turned off (BR38, SEC11). The five optional groups are off until the member turns
// them on (DEC49, DEC65). Read on the server through app.me() (DEC77). An unconfirmed member,
// or one who has not accepted new terms, sees why the form cannot save (API029 refuses both).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { t } from "@souq/i18n";
import {
  PreferencesForm,
  type PreferencesBlocked,
} from "../../../components/notifications/PreferencesForm";
import { RequiredEmailNotice } from "../../../components/notifications/RequiredEmailNotice";
import { loadAccount } from "../../../lib/account/me";
import { memberDenial } from "../../../lib/auth/guards";
import { requireMemberPage } from "../../../lib/auth/page";
import { appDb } from "../../../lib/db/app-client";
import { traceIdOf } from "../../../lib/http/trace";
import { routes } from "../../../lib/routes";
import styles from "./preferences.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("notifications.preferences.pageTitle") };

export default async function NotificationPreferencesPage() {
  const auth = await requireMemberPage(routes.account.notifications);
  const { me, state } = await loadAccount(appDb(), auth.identity, traceIdOf(await headers()));
  const denial = memberDenial(state);
  const blocked: PreferencesBlocked | null =
    denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED" ? denial : null;

  return (
    <div className={styles.page}>
      <h1>{t("notifications.preferences.pageTitle")}</h1>
      <p className={styles.intro}>{t("notifications.preferences.intro")}</p>
      <RequiredEmailNotice />
      <PreferencesForm
        initial={{ groups: me.preferences.email_groups, version: me.preferences.version }}
        blocked={blocked}
      />
      <p className={styles.note}>{t("notifications.preferences.noChatText")}</p>
      <p className={styles.back}>
        <a href={routes.account.home}>{t("notifications.preferences.back")}</a>
      </p>
    </div>
  );
}
