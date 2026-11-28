// /market «السوق» (task 4.3, plan/screens.md, FR06 to FR12, NFR14, RL04, DEC84): the search and
// filters live in the URL (the header search sends GET /market?q= without JavaScript), applying
// them shows the first page, and «إعادة ضبط» returns to the defaults. Distinct states: no results
// (with the filters still shown), a failed read with a retry that keeps the filters (FR07), a link
// with a bad filter or cursor (TC29), and RL04's wait.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { marketSearchParams, parseMarketParams, stripBidiControls } from "@souq/domain";
import { formatWait, t } from "@souq/i18n";
import { MarketFilters } from "../../components/listings/MarketFilters";
import { MarketResults } from "../../components/listings/MarketResults";
import { Alert } from "../../components/ui/Alert";
import { LinkButton } from "../../components/ui/Button";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { loadCatalog } from "../../lib/catalog";
import { appDb } from "../../lib/db/app-client";
import { DEFAULT_LIMIT } from "../../lib/http/cursor";
import { traceIdOf } from "../../lib/http/trace";
import { loadListingsPage, pageFavoriteMode, pageNow } from "../../lib/listings/pages";
import { routes } from "../../lib/routes";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("market.market.title") };

type SearchParams = Record<string, string | string[] | undefined>;

function urlParams(raw: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(name, first);
  }
  return params;
}

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = urlParams(await searchParams);
  const parsed = parseMarketParams(params);
  const catalog = await loadCatalog(appDb(), traceIdOf(await headers()));
  const filters = parsed.ok
    ? parsed.filters
    : { q: null, category: null, condition: null, location: null, sort: "newest" as const };
  const cursor = params.get("cursor");
  const result = parsed.ok
    ? await loadListingsPage(filters, cursor === "" ? null : cursor, DEFAULT_LIMIT)
    : ({ kind: "invalid" } as const);
  const query = marketSearchParams(filters).toString();
  const firstPage = query === "" ? routes.market : `${routes.market}?${query}`;
  const here = params.size === 0 ? routes.market : `${routes.market}?${params.toString()}`;
  const filtered =
    filters.q !== null ||
    filters.category !== null ||
    filters.condition !== null ||
    filters.location !== null;

  return (
    <div className={styles.page}>
      <h1>{t("market.market.title")}</h1>
      {filters.q !== null && (
        <p className={styles.resultsFor}>
          {t("market.market.resultsFor")}{" "}
          <q className={styles.query}>
            <bdi>{stripBidiControls(filters.q)}</bdi>
          </q>
        </p>
      )}
      <MarketFilters filters={filters} catalog={catalog} />
      <section aria-label={t("market.market.listLabel")} className={styles.results}>
        {result.kind === "ok" &&
          (result.page.cards.length === 0 ? (
            filtered ? (
              <EmptyState
                title={t("market.market.emptyTitle")}
                body={t("market.market.emptyBody")}
                action={
                  <LinkButton href={routes.market} variant="secondary">
                    {t("market.market.reset")}
                  </LinkButton>
                }
              />
            ) : (
              <EmptyState
                title={t("market.market.emptyAllTitle")}
                body={t("market.market.emptyAllBody")}
                action={<LinkButton href={routes.sell}>{t("market.home.emptyAction")}</LinkButton>}
              />
            )
          ) : (
            <MarketResults
              initialCards={result.page.cards}
              initialCursor={result.page.nextCursor}
              query={query}
              now={pageNow().toISOString()}
              favorite={{ mode: await pageFavoriteMode(), returnTo: here }}
            />
          ))}
        {result.kind === "invalid" && (
          <ErrorState
            title={t("market.market.invalidTitle")}
            body={t("market.market.invalidBody")}
            action={
              <LinkButton href={parsed.ok ? firstPage : routes.market} variant="secondary">
                {t("market.market.invalidAction")}
              </LinkButton>
            }
          />
        )}
        {result.kind === "limited" && (
          <Alert variant="warning" title={t("market.market.rateLimitedTitle")}>
            <p>{t("market.market.rateLimitedBody", { wait: formatWait(result.retryAfter) })}</p>
            <p>
              <LinkButton href={here} variant="secondary">
                {t("market.market.retry")}
              </LinkButton>
            </p>
          </Alert>
        )}
        {result.kind === "failed" && (
          <ErrorState
            title={t("market.market.errorTitle")}
            body={t("market.market.errorBody")}
            action={
              <LinkButton href={here} variant="secondary">
                {t("market.market.retry")}
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}
