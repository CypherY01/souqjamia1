// /auth/email-change/done (task 3.6): where API021 leads. ?state=waiting after the first link
// (the other address is still to confirm), ?state=changed after both (every session ended, BR23):
// the member signs in with the new address. Anything else is not a page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@souq/i18n";
import { Alert } from "../../../../components/ui/Alert";
import { LinkButton } from "../../../../components/ui/Button";
import { routes } from "../../../../lib/routes";
import styles from "../email-change.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.emailChangeDone.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

interface EmailChangeDonePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EmailChangeDonePage({ searchParams }: EmailChangeDonePageProps) {
  const state = (await searchParams).state;
  if (state !== "waiting" && state !== "changed") notFound();
  return (
    <div className={styles.page}>
      <h1>{t("auth.emailChangeDone.pageTitle")}</h1>
      <div className={styles.link}>
        <Alert variant="success" title={t(`auth.emailChangeDone.${state}.title`)}>
          {t(`auth.emailChangeDone.${state}.body`)}
        </Alert>
        {state === "changed" && (
          <LinkButton href={routes.login} fullWidth>
            {t("auth.emailChangeDone.login")}
          </LinkButton>
        )}
      </div>
    </div>
  );
}
