// /login (task 3.3, item 6, plan/screens.md): API002. A live ordinary session goes on to the
// return path (or /restricted for a restricted account, FR78); a limited session (a recovery
// link, DEC73) sees the form. `next` from the address is kept only when it is a local path
// (safeLocalPath, TC02): otherwise it is dropped, and the member lands on the home page.
// `confirmed=1` comes from the confirmation link page (task 3.2), `reset=1` from the new-password
// page (task 3.4). The MFA step joins in 7.1.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeLocalPath } from "@souq/domain";
import { t } from "@souq/i18n";
import { Alert } from "../../components/ui/Alert";
import { restrictionOf } from "../../lib/auth/guards";
import { pageSession } from "../../lib/auth/page";
import { serverEnv } from "../../lib/env";
import { routes } from "../../lib/routes";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("auth.login.pageTitle") };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeLocalPath(single(params.next));
  const confirmed = single(params.confirmed) === "1";
  const reset = single(params.reset) === "1";

  const auth = await pageSession();
  if (auth !== null && !auth.identity.limited) {
    redirect(restrictionOf(auth.state) === null ? (next ?? routes.home) : routes.restricted);
  }

  return (
    <div className={styles.page}>
      <h1>{t("auth.login.pageTitle")}</h1>
      <p className={styles.intro}>{t("auth.login.intro")}</p>
      {confirmed && (
        <div className={styles.notice}>
          <Alert variant="success" title={t("auth.login.confirmed.title")}>
            {t("auth.login.confirmed.body")}
          </Alert>
        </div>
      )}
      {reset && (
        <div className={styles.notice}>
          <Alert variant="success" title={t("auth.login.reset.title")}>
            {t("auth.login.reset.body")}
          </Alert>
        </div>
      )}
      <LoginForm siteKey={serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} next={next} />
      <p className={styles.signup}>
        {t("auth.login.noAccount")} <a href={routes.signup}>{t("auth.login.signup")}</a>
      </p>
    </div>
  );
}
