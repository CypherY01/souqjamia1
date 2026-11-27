// /account/listings «إعلاناتي» (task 4.4, plan/screens.md, FR23, FR24, BR27, API033, API036):
// three tabs as links (?status=, the active one by default, working without JavaScript), one page
// of the tab read on the server through app.my_listings() (DEC77), and the client part for the
// actions and «أظهر المزيد». A member page: a guest goes to the login page and comes back, a
// restricted account or one awaiting deletion to /restricted. A member who cannot write yet sees
// why, and the account page where it is done (API033 refuses both anyway). Distinct states: the
// list, an empty tab, a bad link (tab or cursor), and a failed read with a retry.
import type { Metadata } from "next";
import { MY_LISTING_TABS } from "@souq/domain";
import { t } from "@souq/i18n";
import { MyListings } from "../../../components/listings/MyListings";
import styles from "../../../components/listings/my-listings.module.css";
import { Alert } from "../../../components/ui/Alert";
import { LinkButton } from "../../../components/ui/Button";
import { EmptyState, ErrorState } from "../../../components/ui/States";
import { memberDenial } from "../../../lib/auth/guards";
import { requireMemberPage } from "../../../lib/auth/page";
import { loadMyListingsPage, pageNow } from "../../../lib/listings/pages";
import { routes } from "../../../lib/routes";
import page from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("myListings.page.title") };

type SearchParams = Record<string, string | string[] | undefined>;

function urlParams(raw: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(name, first);
  }
  return params;
}

export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const auth = await requireMemberPage(routes.account.listings);
  const denial = memberDenial(auth.state);
  if (denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED") {
    return (
      <div className={page.page}>
        <h1>{t("myListings.page.title")}</h1>
        <Alert variant="warning" title={t(`myListings.blocked.${denial}.title`)}>
          <p>{t(`myListings.blocked.${denial}.body`)}</p>
        </Alert>
        <p className={page.action}>
          <LinkButton href={routes.account.home}>{t("myListings.blocked.account")}</LinkButton>
        </p>
      </div>
    );
  }

  const params = urlParams(await searchParams);
  const requested = params.get("status");
  const tab = MY_LISTING_TABS.find((value) => value === requested) ?? "active";
  const result = await loadMyListingsPage(auth, params);
  const here =
    params.size === 0 ? routes.account.listings : `${routes.account.listings}?${params.toString()}`;

  return (
    <div className={page.page}>
      <h1>{t("myListings.page.title")}</h1>
      <p className={page.intro}>{t("myListings.page.intro")}</p>
      <nav aria-label={t("myListings.tabs.label")}>
        <ul className={styles.tabs}>
          {MY_LISTING_TABS.map((value) => (
            <li key={value}>
              <a
                className={styles.tab}
                href={`${routes.account.listings}?status=${value}`}
                aria-current={value === tab ? "page" : undefined}
              >
                {t(`myListings.tabs.${value}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-label={t(`myListings.tabs.${tab}`)}>
        {result.kind === "ok" &&
          (result.page.items.length === 0 ? (
            <EmptyState
              title={t(`myListings.empty.${tab}.title`)}
              body={t(`myListings.empty.${tab}.body`)}
              action={
                tab === "active" ? (
                  <LinkButton href={routes.sell}>{t("myListings.empty.action")}</LinkButton>
                ) : undefined
              }
            />
          ) : (
            <MyListings
              tab={tab}
              initialItems={result.page.items}
              initialCursor={result.page.nextCursor}
              now={pageNow().toISOString()}
            />
          ))}
        {result.kind === "invalid" && (
          <ErrorState
            title={t("myListings.states.invalidTitle")}
            body={t("myListings.states.invalidBody")}
            action={
              <LinkButton href={routes.account.listings} variant="secondary">
                {t("myListings.states.invalidAction")}
              </LinkButton>
            }
          />
        )}
        {result.kind === "failed" && (
          <ErrorState
            title={t("myListings.states.errorTitle")}
            body={t("myListings.states.errorBody")}
            action={
              <LinkButton href={here} variant="secondary">
                {t("myListings.states.retry")}
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}
