import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Arabic } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { t } from "@souq/i18n";
import { log } from "@souq/log";
import { MAIN_CONTENT_ID, SkipLink } from "../components/layout/SkipLink";
import { SiteFooter } from "../components/layout/SiteFooter";
import { SiteHeader, type HeaderMember } from "../components/layout/SiteHeader";
import { pageSession } from "../lib/auth/page";
import { serverEnv, turnstileStubOn } from "../lib/env";
import "./tokens.css";
import "./globals.css";
import styles from "./layout.module.css";

// Chapter 02: Noto Sans Arabic, with Noto Sans for Latin text. next/font downloads the files at
// build time and serves them from this site, so visitors' browsers never contact Google.
const arabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
});
const latin = Noto_Sans({ subsets: ["latin"], variable: "--font-latin", display: "swap" });

export const metadata: Metadata = {
  title: { default: t("common.app.name"), template: `%s · ${t("common.app.name")}` },
  description: t("common.app.description"),
};

/**
 * Task 3.1 (from task 1.5): the member variant of the header for an ordinary session. A limited
 * session or a guest sees the visitor header. If the database does not answer, the header falls
 * back to the visitor variant, and the page shows its own error state where it needs the data.
 * The unread count joins with the notifications in task 3.8.
 */
async function headerMember(): Promise<HeaderMember | null> {
  try {
    const auth = await pageSession();
    if (auth === null || auth.identity.limited) return null;
    return { name: auth.state.displayName, unreadNotifications: 0 };
  } catch (error) {
    log.warn("layout.session_unavailable", { name: (error as Error).name });
    return null;
  }
}

// DEC30: Arabic only, right to left.
// SEC06: the CSP nonce is new on every request, so every page renders on request (task 1.6).
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${arabic.variable} ${latin.variable}`}
      // Task 3.5: E2E's Turnstile stand-in (components/auth/Turnstile.tsx), never in production.
      data-turnstile-stub={turnstileStubOn(serverEnv()) ? "" : undefined}
    >
      <body>
        <SkipLink />
        <SiteHeader member={await headerMember()} />
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles.main}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
