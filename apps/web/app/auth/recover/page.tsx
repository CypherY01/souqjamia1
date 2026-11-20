// /auth/recover (task 3.4, plan/screens.md): the page the recovery email links to, in both
// confirmation modes. GET only shows a button and spends nothing (email scanners follow links,
// section 5 of the addendum); the button sends API007. The proxy sends no Referer and forbids
// storing the page (SEC03), and nothing outside the site loads while the token is in the
// address: the form removes it first, and Turnstile loads only for a new link after a spent one.
// A live ordinary session in this browser is refused by API007, so the page offers "sign out and
// continue" instead of the button (owner decision on item 2).
import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { pageSession } from "../../../lib/auth/page";
import { serverEnv } from "../../../lib/env";
import { RecoverLinkForm } from "./RecoverLinkForm";
import styles from "./recover-link.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.recoverLink.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

interface RecoverLinkPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RecoverLinkPage({ searchParams }: RecoverLinkPageProps) {
  const value = (await searchParams).token_hash;
  const tokenHash = typeof value === "string" && value !== "" && value.length <= 512 ? value : null;
  const auth = await pageSession();
  return (
    <div className={styles.page}>
      <h1>{t("auth.recoverLink.pageTitle")}</h1>
      <RecoverLinkForm
        tokenHash={tokenHash}
        signedIn={auth !== null && !auth.identity.limited}
        siteKey={serverEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
    </div>
  );
}
