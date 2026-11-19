// /auth/confirm (task 3.2, item 5, plan/screens.md): the page the confirmation email links to.
// GET only shows a button and spends nothing (email scanners follow links, section 5 of the
// addendum); the button sends API004. The proxy sends no Referer and forbids storing the page
// (SEC03), and nothing outside the site loads while the token is in the address: the form
// removes it from the address first, and Turnstile loads only for a resend after a spent link.
// While confirmation is off the page does not exist (DEC66).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@souq/i18n";
import { serverEnv } from "../../../lib/env";
import { ConfirmForm } from "./ConfirmForm";
import styles from "./confirm.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("auth.confirm.pageTitle"),
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

interface ConfirmPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const env = serverEnv();
  if (!env.EMAIL_CONFIRMATION_REQUIRED) notFound();
  const value = (await searchParams).token_hash;
  const tokenHash = typeof value === "string" && value !== "" && value.length <= 512 ? value : null;
  return (
    <div className={styles.page}>
      <h1>{t("auth.confirm.pageTitle")}</h1>
      <ConfirmForm tokenHash={tokenHash} siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
    </div>
  );
}
