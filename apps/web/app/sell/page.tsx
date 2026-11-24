// /sell «أضف إعلاناً» (task 4.2, plan/screens.md «النشر»): the five-step wizard (FR16 to FR22,
// FR60). A member page: a guest goes to the login page and comes back, a restricted account or
// one awaiting deletion to /restricted (memberPageRedirect). A member who cannot write yet
// (email not confirmed while confirmation is on, or new policy versions not acknowledged) sees
// why, and the account page where it is done; API034 refuses both anyway (TC25).
// The pick lists are read on the server (app.active_categories, app.active_meeting_points,
// DEC77). The meeting points may be empty (G02): the wizard then offers «حسب الاتفاق» alone.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { t } from "@souq/i18n";
import { SellWizard } from "../../components/sell/SellWizard";
import { Alert } from "../../components/ui/Alert";
import { LinkButton } from "../../components/ui/Button";
import { memberDenial } from "../../lib/auth/guards";
import { requireMemberPage } from "../../lib/auth/page";
import { loadCatalog } from "../../lib/catalog";
import { appDb } from "../../lib/db/app-client";
import { traceIdOf } from "../../lib/http/trace";
import { routes } from "../../lib/routes";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("sell.page.title") };

export default async function SellPage() {
  const auth = await requireMemberPage(routes.sell);
  const denial = memberDenial(auth.state);
  if (denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED") {
    return (
      <div className={styles.page}>
        <h1>{t("sell.page.title")}</h1>
        <Alert variant="warning" title={t(`sell.blocked.${denial}.title`)}>
          <p>{t(`sell.blocked.${denial}.body`)}</p>
        </Alert>
        <p className={styles.action}>
          <LinkButton href={routes.account.home}>{t("sell.blocked.account")}</LinkButton>
        </p>
      </div>
    );
  }

  const catalog = await loadCatalog(appDb(), traceIdOf(await headers()));
  return (
    <div className={styles.page}>
      <h1>{t("sell.page.title")}</h1>
      <p className={styles.intro}>{t("sell.page.intro")}</p>
      <SellWizard
        owner={auth.identity.userId}
        catalog={{
          categories: catalog.categories.map((category) => ({
            id: category.id,
            label: category.label_ar,
          })),
          points: catalog.meeting_points.map((point) => ({
            id: point.id,
            kind: point.kind,
            label: point.label_ar,
          })),
        }}
      />
    </div>
  );
}
