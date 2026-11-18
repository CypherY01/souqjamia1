"use client";

// Replaces the root layout when the layout itself fails, so it renders its own <html>.
import { t } from "@souq/i18n";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/States";
import "./tokens.css";
import "./globals.css";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <main>
          <ErrorState
            headingLevel={1}
            title={t("errors.page.title")}
            body={t("errors.page.body")}
            action={<Button onClick={reset}>{t("ui.retry")}</Button>}
          />
        </main>
      </body>
    </html>
  );
}
