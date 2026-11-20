// /restricted (plan/screens.md, FR78 without appeals, DEC41): the state of a suspended, banned or
// deletion-pending account and the contact address for objections. A guest or a limited session
// goes to the login page, an account that is not restricted to the home page.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@souq/i18n";
import { AccountRestrictedNotice } from "../../components/account/AccountRestrictedNotice";
import { SignOutButton } from "../../components/auth/SignOutButton";
import { restrictionOf } from "../../lib/auth/guards";
import { pageSession } from "../../lib/auth/page";
import { serverEnv } from "../../lib/env";
import { routes } from "../../lib/routes";
import styles from "./restricted.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("account.restricted.pageTitle") };

export default async function RestrictedPage() {
  const auth = await pageSession();
  if (auth === null || auth.identity.limited) redirect(routes.login);
  const restriction = restrictionOf(auth.state);
  if (restriction === null) redirect(routes.home);
  return (
    <>
      <h1>{t("account.restricted.pageTitle")}</h1>
      <AccountRestrictedNotice restriction={restriction} contactEmail={serverEnv().CONTACT_EMAIL} />
      {/* Task 3.3: the restricted flow has no header menu of its own, so sign-out is here too. */}
      <div className={styles.signOut}>
        <SignOutButton />
      </div>
    </>
  );
}
