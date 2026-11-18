import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";
import { t } from "@souq/i18n";
import { MAIN_CONTENT_ID, SkipLink } from "../components/layout/SkipLink";
import { SiteFooter } from "../components/layout/SiteFooter";
import { SiteHeader } from "../components/layout/SiteHeader";
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

// DEC30: Arabic only, right to left.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={`${arabic.variable} ${latin.variable}`}>
      <body>
        <SkipLink />
        <SiteHeader />
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles.main}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
