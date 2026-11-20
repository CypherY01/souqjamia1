// /recover (task 3.4, plan/screens.md): API006. Any visitor asks for a recovery link; a live
// ordinary session goes to the home page (its password changes from the account page, task 3.6),
// and a limited session (an earlier link) sees the form. Linked from /login and from the DEC64
// message on the signup page.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@souq/i18n";
import { RecoverForm } from "../../components/auth/RecoverForm";
import { pageSession } from "../../lib/auth/page";
import { serverEnv } from "../../lib/env";
import { routes } from "../../lib/routes";
import styles from "./recover.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("auth.recover.pageTitle") };

export default async function RecoverPage() {
  const auth = await pageSession();
  if (auth !== null && !auth.identity.limited) redirect(routes.home);
  return (
    <div className={styles.page}>
      <h1>{t("auth.recover.pageTitle")}</h1>
      <p className={styles.intro}>{t("auth.recover.intro")}</p>
      <RecoverForm siteKey={serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      <p className={styles.back}>
        <a href={routes.login}>{t("auth.recover.backToLogin")}</a>
      </p>
    </div>
  );
}
