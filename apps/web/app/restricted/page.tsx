// /restricted (plan/screens.md, FR78 without appeals, DEC41, DEC81): the state of a suspended,
// banned or deletion-pending account and the contact address for objections and, for a
// restricted account, data deletion requests (DEC81). Awaiting deletion within the 30 days, the
// form that asks for the recovery link (API027, task 3.7) with the account's own address, read
// through app.me() (DEC77). A guest goes to the login page, a limited session to the
// new-password page within its 5 minutes and to the login page after them (task 3.4), an account
// that is not restricted to the home page.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { t } from "@souq/i18n";
import { AccountRestrictedNotice } from "../../components/account/AccountRestrictedNotice";
import { RequestRecoveryForm } from "../../components/account/RequestRecoveryForm";
import { SignOutButton } from "../../components/auth/SignOutButton";
import { loadAccount } from "../../lib/account/me";
import { limitedSessionPage, restrictionOf } from "../../lib/auth/guards";
import { pageSession } from "../../lib/auth/page";
import { appDb } from "../../lib/db/app-client";
import { serverEnv } from "../../lib/env";
import { traceIdOf } from "../../lib/http/trace";
import { routes } from "../../lib/routes";
import styles from "./restricted.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("account.restricted.pageTitle") };

export default async function RestrictedPage() {
  const auth = await pageSession();
  if (auth === null) redirect(routes.login);
  if (auth.identity.limited) redirect(limitedSessionPage(auth.identity));
  const restriction = restrictionOf(auth.state);
  if (restriction === null) redirect(routes.home);
  const env = serverEnv();
  const recoverable = restriction.kind === "deletion_pending" && restriction.recoverable;
  const email = recoverable
    ? (await loadAccount(appDb(), auth.identity, traceIdOf(await headers()))).me.email
    : null;
  return (
    <>
      <h1>{t("account.restricted.pageTitle")}</h1>
      <AccountRestrictedNotice restriction={restriction} contactEmail={env.CONTACT_EMAIL}>
        {email !== null && (
          <RequestRecoveryForm email={email} siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
        )}
      </AccountRestrictedNotice>
      {/* Task 3.3: the restricted flow has no header menu of its own, so sign-out is here too. */}
      <div className={styles.signOut}>
        <SignOutButton />
      </div>
    </>
  );
}
