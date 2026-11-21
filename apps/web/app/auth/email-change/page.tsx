// /auth/email-change (task 3.6, plan/screens.md): the page both email change links lead to, one
// sent to the old address and one to the new (API020). GET only shows a button and spends
// nothing (email scanners follow links, section 5 of the addendum); the button sends API021.
// The proxy sends no Referer and forbids storing the page (SEC03), and nothing outside the site
// loads here. The link is opened on any device: no session is needed or used (DEC79).
import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { EmailChangeLinkForm } from "./EmailChangeLinkForm";
import styles from "./email-change.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.emailChangeLink.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

interface EmailChangeLinkPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EmailChangeLinkPage({ searchParams }: EmailChangeLinkPageProps) {
  const value = (await searchParams).token_hash;
  const tokenHash = typeof value === "string" && value !== "" && value.length <= 512 ? value : null;
  return (
    <div className={styles.page}>
      <h1>{t("auth.emailChangeLink.pageTitle")}</h1>
      <EmailChangeLinkForm tokenHash={tokenHash} />
    </div>
  );
}
