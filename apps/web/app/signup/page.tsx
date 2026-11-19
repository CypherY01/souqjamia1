// /signup (task 3.2, item 8, plan/screens.md): API114, the active colleges (API030 joins with
// task 4.2) and API001. A live member session goes to the home page. Without published policy
// versions there is no signup (503 from API114, DEC36): the page shows that, with a retry.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { t } from "@souq/i18n";
import {
  activeColleges,
  currentPolicies,
  type College,
  type CurrentPolicies,
} from "../../lib/auth/policies";
import { pageSession } from "../../lib/auth/page";
import { appDb } from "../../lib/db/app-client";
import { serverEnv } from "../../lib/env";
import { ApiError } from "../../lib/http/errors";
import { traceIdOf } from "../../lib/http/trace";
import { routes } from "../../lib/routes";
import { LinkButton } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/States";
import { SignupForm } from "./SignupForm";
import styles from "./signup.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("auth.signup.pageTitle") };

export default async function SignupPage() {
  const auth = await pageSession();
  if (auth !== null && !auth.identity.limited) redirect(routes.home);

  const traceId = traceIdOf(await headers());
  const db = appDb();
  let policies: CurrentPolicies;
  let colleges: College[];
  try {
    [policies, colleges] = await Promise.all([
      currentPolicies(db, traceId),
      activeColleges(db, traceId),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.code === "SERVICE_UNAVAILABLE") {
      return (
        <ErrorState
          headingLevel={1}
          title={t("auth.signup.unavailable.title")}
          body={t("auth.signup.unavailable.body")}
          action={<LinkButton href={routes.signup}>{t("ui.retry")}</LinkButton>}
        />
      );
    }
    throw error;
  }

  return (
    <div className={styles.page}>
      <h1>{t("auth.signup.pageTitle")}</h1>
      <p className={styles.intro}>{t("auth.signup.intro")}</p>
      <SignupForm
        siteKey={serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        policies={{
          terms: policies.terms.version,
          privacy: policies.privacy.version,
        }}
        colleges={colleges.map((college) => ({ value: college.id, label: college.label_ar }))}
      />
      <p className={styles.login}>
        {t("auth.signup.haveAccount")} <a href={routes.login}>{t("auth.signup.login")}</a>
      </p>
    </div>
  );
}
