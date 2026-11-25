// The home page (task 4.3, plan/screens.md «الرئيسية», FR06): the latest listings (each card opens
// its listing) with a link to the whole market, and the six main categories («أخرى» is in the
// market's full list). Sold listings are not here (DEC84). An empty market invites the first
// listing instead of an empty area. Wanted requests join this page with task 4.6.
import Link from "next/link";
import { headers } from "next/headers";
import { HOME_CATEGORY_KEYS, HOME_RECENT_COUNT } from "@souq/domain";
import { formatWait, t } from "@souq/i18n";
import { ListingCard } from "../components/listings/ListingCard";
import { Alert } from "../components/ui/Alert";
import { LinkButton } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/States";
import { loadCatalog } from "../lib/catalog";
import { appDb } from "../lib/db/app-client";
import { traceIdOf } from "../lib/http/trace";
import { loadListingsPage, pageNow } from "../lib/listings/pages";
import { routes } from "../lib/routes";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const LATEST = {
  q: null,
  category: null,
  condition: null,
  location: null,
  sort: "newest",
} as const;

export default async function HomePage() {
  const catalog = await loadCatalog(appDb(), traceIdOf(await headers()));
  const result = await loadListingsPage(LATEST, null, HOME_RECENT_COUNT);
  const categories = catalog.categories.filter((category) =>
    (HOME_CATEGORY_KEYS as readonly string[]).includes(category.key),
  );
  const now = pageNow();

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1>{t("common.app.name")}</h1>
        <p>{t("common.app.description")}</p>
      </header>

      {categories.length > 0 && (
        <section aria-labelledby="home-categories" className={styles.section}>
          <h2 id="home-categories">{t("market.home.categoriesTitle")}</h2>
          <ul className={styles.categories}>
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  className={styles.category}
                  href={`${routes.market}?${new URLSearchParams({ category: category.key }).toString()}`}
                >
                  {category.label_ar}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="home-recent" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="home-recent">{t("market.home.recentTitle")}</h2>
          <Link href={routes.market} className={styles.all}>
            {t("market.home.browseAll")}
          </Link>
        </div>
        {result.kind === "ok" &&
          (result.page.cards.length === 0 ? (
            <EmptyState
              title={t("market.home.emptyTitle")}
              body={t("market.home.emptyBody")}
              action={<LinkButton href={routes.sell}>{t("market.home.emptyAction")}</LinkButton>}
            />
          ) : (
            <ul className={styles.grid}>
              {result.page.cards.map((card, index) => (
                <li key={card.id}>
                  <ListingCard card={card} now={now} eager={index < 4} />
                </li>
              ))}
            </ul>
          ))}
        {result.kind === "limited" && (
          <Alert variant="warning" title={t("market.market.rateLimitedTitle")}>
            <p>{t("market.market.rateLimitedBody", { wait: formatWait(result.retryAfter) })}</p>
          </Alert>
        )}
        {(result.kind === "failed" || result.kind === "invalid") && (
          <ErrorState
            title={t("market.market.errorTitle")}
            body={t("market.market.errorBody")}
            action={
              <LinkButton href={routes.home} variant="secondary">
                {t("market.market.retry")}
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}
