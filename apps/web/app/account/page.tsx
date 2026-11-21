// /account «حسابي» (task 3.5, plan/screens.md): API015 for the page itself, read on the server
// through app.me() (DEC77), never by a request from the server to its own API.
//   - A guest goes to the login page, a limited session to the new-password page (task 3.4), and
//     a restricted or deletion-pending account to /restricted (requireMemberPage).
//   - The private email, the name, the college and the join date, then links to the account
//     pages built so far (item 7): each later task adds its own.
//   - An unconfirmed email (confirmation on, DEC63) gets the resend form, and policy versions
//     published after signup get the acknowledgment form (API119, DEC69, item 8).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { t } from "@souq/i18n";
import { PolicyAcknowledgeForm } from "../../components/account/PolicyAcknowledgeForm";
import { ResendForm } from "../../components/auth/ResendForm";
import { Alert } from "../../components/ui/Alert";
import { DateText } from "../../components/ui/Display";
import { loadAccount } from "../../lib/account/me";
import { memberDenial } from "../../lib/auth/guards";
import { requireMemberPage } from "../../lib/auth/page";
import { currentPolicies } from "../../lib/auth/policies";
import { appDb } from "../../lib/db/app-client";
import { serverEnv } from "../../lib/env";
import { traceIdOf } from "../../lib/http/trace";
import { routes } from "../../lib/routes";
import styles from "./account.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("account.home.pageTitle") };

export default async function AccountPage() {
  const auth = await requireMemberPage(routes.account.home);
  const traceId = traceIdOf(await headers());
  const db = appDb();
  const { me, joinedAt, state } = await loadAccount(db, auth.identity, traceId);
  const denial = memberDenial(state);
  const policies = denial === "TERMS_NOT_ACKNOWLEDGED" ? await currentPolicies(db, traceId) : null;

  return (
    <div className={styles.page}>
      <h1>{t("account.home.pageTitle")}</h1>

      {denial === "EMAIL_NOT_CONFIRMED" && (
        <div className={styles.notice}>
          <Alert variant="warning" title={t("account.home.confirmEmail.title")}>
            <p>{t("account.home.confirmEmail.body")}</p>
          </Alert>
          <ResendForm siteKey={serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} email={me.email} />
        </div>
      )}

      {policies !== null && (
        <div className={styles.notice}>
          <Alert variant="warning" title={t("account.home.terms.title")}>
            <p>{t("account.home.terms.body")}</p>
          </Alert>
          <PolicyAcknowledgeForm
            terms={{ version: policies.terms.version, path: policies.terms.path }}
            privacy={{ version: policies.privacy.version, path: policies.privacy.path }}
          />
        </div>
      )}

      <section className={styles.section} aria-labelledby="account-details-title">
        <h2 id="account-details-title">{t("account.home.details.title")}</h2>
        <dl className={styles.details}>
          <div>
            <dt>{t("account.home.details.name")}</dt>
            <dd>
              <bdi>{me.display_name}</bdi>
            </dd>
          </div>
          <div>
            <dt>{t("account.home.details.email")}</dt>
            <dd>
              <bdi dir="ltr">{me.email}</bdi>
              <p className={styles.note}>{t("account.home.details.emailNote")}</p>
            </dd>
          </div>
          <div>
            <dt>{t("account.home.details.college")}</dt>
            <dd>
              {me.college === null ? (
                t("account.home.details.noCollege")
              ) : (
                <bdi>{me.college.label_ar}</bdi>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("account.home.details.joined")}</dt>
            <dd>
              <DateText value={joinedAt} />
            </dd>
          </div>
        </dl>
      </section>

      <nav className={styles.section} aria-labelledby="account-sections-title">
        <h2 id="account-sections-title">{t("account.home.sections.title")}</h2>
        <ul className={styles.links}>
          <li>
            <a href={routes.account.profile}>{t("account.home.sections.profile")}</a>
            <p className={styles.note}>{t("account.home.sections.profileHint")}</p>
          </li>
          <li>
            <a href={routes.account.security}>{t("account.home.sections.security")}</a>
            <p className={styles.note}>{t("account.home.sections.securityHint")}</p>
          </li>
        </ul>
      </nav>
    </div>
  );
}
