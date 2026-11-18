import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { LinkButton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/States";
import { routes } from "../lib/routes";

export const metadata: Metadata = { title: t("errors.notFound.title") };

// plan/screens.md "غير متاح": the same page whether the resource is missing or private, so it
// never reveals that something exists.
export default function NotFound() {
  return (
    <EmptyState
      headingLevel={1}
      title={t("errors.notFound.title")}
      body={t("errors.notFound.body")}
      action={
        <LinkButton href={routes.home} variant="primary">
          {t("errors.notFound.home")}
        </LinkButton>
      }
    />
  );
}
