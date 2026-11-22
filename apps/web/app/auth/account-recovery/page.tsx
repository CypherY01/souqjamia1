// /auth/account-recovery (task 3.7, plan/screens.md): the page the deletion recovery email links
// to (API028). GET only shows a button and spends nothing (email scanners follow links, section 5
// of the addendum); the button sends API028. The proxy sends no Referer and forbids storing the
// page (SEC03), and the form removes the token from the address first. The browser's session is
// not used: the link recovers the account it was sent for, whoever is signed in here.
import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { AccountRecoveryLinkForm } from "./AccountRecoveryLinkForm";
import styles from "./account-recovery.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.accountRecovery.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

interface AccountRecoveryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AccountRecoveryPage({ searchParams }: AccountRecoveryPageProps) {
  const value = (await searchParams).token_hash;
  const tokenHash = typeof value === "string" && value !== "" && value.length <= 512 ? value : null;
  return (
    <div className={styles.page}>
      <h1>{t("auth.accountRecovery.pageTitle")}</h1>
      <AccountRecoveryLinkForm tokenHash={tokenHash} />
    </div>
  );
}
