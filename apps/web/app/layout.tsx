import type { Metadata } from "next";
import type { ReactNode } from "react";
import { t } from "@souq/i18n";

// DEC30: Arabic only, right to left. The full shell (header, footer, tokens) is task 1.5.
export const metadata: Metadata = {
  title: t("common.app.name"),
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
