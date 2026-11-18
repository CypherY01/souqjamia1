import { t } from "@souq/i18n";

// The home page content (listings, wanted requests, categories) is task 4.3.
export default function HomePage() {
  return (
    <>
      <h1>{t("common.app.name")}</h1>
      <p>{t("common.app.description")}</p>
    </>
  );
}
