// /account/favorites «المفضلة» (task 4.5, plan/screens.md, FR15, UC05, API048, API050): one page of
// the member's favorites read on the server through app.my_favorites() (DEC77), and the client
// part for removing and «أظهر المزيد». A member page: a guest goes to the login page and comes
// back, a restricted account or one awaiting deletion to /restricted. A member who cannot write
// yet sees why, and the account page where it is done (API048 refuses both anyway). Distinct
// states: the list, an empty list, a bad link (cursor), and a failed read with a retry. The
// loading state is the root loading.tsx.
import type { Metadata } from "next";
import { t } from "@souq/i18n";
import { FavoritesList } from "../../../components/listings/FavoritesList";
import { Alert } from "../../../components/ui/Alert";
import { LinkButton } from "../../../components/ui/Button";
import { EmptyState, ErrorState } from "../../../components/ui/States";
import { memberDenial } from "../../../lib/auth/guards";
import { requireMemberPage } from "../../../lib/auth/page";
import { loadFavoritesPage, pageNow } from "../../../lib/listings/pages";
import { routes } from "../../../lib/routes";
import page from "../listings/page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("favorites.page.title") };

type SearchParams = Record<string, string | string[] | undefined>;

function urlParams(raw: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(name, first);
  }
  return params;
}

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const auth = await requireMemberPage(routes.account.favorites);
  const denial = memberDenial(auth.state);
  if (denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED") {
    return (
      <div className={page.page}>
        <h1>{t("favorites.page.title")}</h1>
        <Alert variant="warning" title={t(`myListings.blocked.${denial}.title`)}>
          <p>{t(`favorites.blocked.${denial}`)}</p>
        </Alert>
        <p className={page.action}>
          <LinkButton href={routes.account.home}>{t("myListings.blocked.account")}</LinkButton>
        </p>
      </div>
    );
  }

  const params = urlParams(await searchParams);
  const result = await loadFavoritesPage(auth, params);
  const here =
    params.size === 0
      ? routes.account.favorites
      : `${routes.account.favorites}?${params.toString()}`;

  return (
    <div className={page.page}>
      <h1>{t("favorites.page.title")}</h1>
      <p className={page.intro}>{t("favorites.page.intro")}</p>
      <section aria-label={t("favorites.page.listTitle")}>
        {result.kind === "ok" &&
          (result.page.items.length === 0 ? (
            <EmptyState
              title={t("favorites.page.emptyTitle")}
              body={t("favorites.page.emptyBody")}
              action={<LinkButton href={routes.market}>{t("favorites.page.browse")}</LinkButton>}
            />
          ) : (
            <FavoritesList
              initialItems={result.page.items}
              initialCursor={result.page.nextCursor}
              now={pageNow().toISOString()}
              here={here}
            />
          ))}
        {result.kind === "invalid" && (
          <ErrorState
            title={t("favorites.page.errorTitle")}
            body={t("favorites.page.invalid")}
            action={
              <LinkButton href={routes.account.favorites} variant="secondary">
                {t("favorites.page.fromStart")}
              </LinkButton>
            }
          />
        )}
        {result.kind === "failed" && (
          <ErrorState
            title={t("favorites.page.errorTitle")}
            body={t("favorites.page.errorBody")}
            action={
              <LinkButton href={here} variant="secondary">
                {t("favorites.page.retry")}
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}
