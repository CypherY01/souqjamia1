"use client";

// An unexpected error while rendering a page: a safe message and a retry, never the error details.
import { t } from "@souq/i18n";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/States";

export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      headingLevel={1}
      title={t("errors.page.title")}
      body={t("errors.page.body")}
      action={<Button onClick={reset}>{t("ui.retry")}</Button>}
    />
  );
}
