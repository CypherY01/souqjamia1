// Task 4.3 in the component gallery: listing cards in each state, «الصور قيد التجهيز», the image
// gallery, the market filters and results (exact and close), and the market's page states.
// The pictures are inline SVG data (img-src allows data:), so the gallery needs no Storage.
import { formatWait, t } from "@souq/i18n";
import { ImageGallery } from "../../../components/listings/ImageGallery";
import { ImagesPending } from "../../../components/listings/ImagesPending";
import { ListingCard } from "../../../components/listings/ListingCard";
import { MarketFilters } from "../../../components/listings/MarketFilters";
import { MarketResults } from "../../../components/listings/MarketResults";
import { Alert } from "../../../components/ui/Alert";
import { LinkButton } from "../../../components/ui/Button";
import { EmptyState, ErrorState } from "../../../components/ui/States";
import type { CatalogRef, MeetingPointRef } from "../../../lib/catalog";
import type { ListingCard as Card } from "../../../lib/listings/public";
import type { ImageSet } from "../../../lib/media/public";
import { routes } from "../../../lib/routes";
import styles from "./page.module.css";

function picture(background: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${background}"/><circle cx="200" cy="150" r="80" fill="${shape}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function imageSet(background: string, shape: string): ImageSet {
  const src = picture(background, shape);
  return { w150: src, w600: src, w1200: src };
}

const GREEN = imageSet("#EAF2EE", "#0B3B2D");
const GOLD = imageSet("#F5EFE0", "#C59B27");
const DARK = imageSet("#06241B", "#FAF9F5");

const category: CatalogRef = {
  id: "00000000-0000-4000-8000-000000000001",
  key: "books_study",
  label_ar: t("dev.listings.category"),
  label_en: null,
};
const point: MeetingPointRef = {
  id: "00000000-0000-4000-8000-000000000002",
  key: "dev-point",
  kind: "campus",
  label_ar: t("dev.listings.point"),
  label_en: null,
};

function card(
  n: number,
  title: string,
  overrides: Partial<Card>,
  createdAt: Date,
  match?: Card["match"],
): Card {
  const value: Card = {
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    title,
    price_minor: 35000,
    is_negotiable: false,
    condition: "good",
    category,
    location: point,
    primary_image: GREEN,
    status: "active",
    seller_student_badge: false,
    created_at: createdAt.toISOString(),
    ...overrides,
  };
  if (match !== undefined) value.match = match;
  return value;
}

export function ListingsGallery({ now }: { now: Date }) {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
  const cards: Card[] = [
    card(1, t("dev.listings.ready"), { is_negotiable: true }, hoursAgo(1)),
    card(2, t("dev.listings.pending"), { primary_image: null }, hoursAgo(0)),
    card(3, t("dev.listings.free"), { price_minor: 0, location: null }, hoursAgo(5)),
    card(
      4,
      t("dev.listings.student"),
      { seller_student_badge: true, primary_image: GOLD },
      hoursAgo(30),
    ),
    card(5, t("dev.listings.sold"), { status: "sold", primary_image: DARK }, hoursAgo(200)),
    card(
      6,
      t("dev.listings.longTitle"),
      { condition: "new_boxed", price_minor: 120050 },
      hoursAgo(3),
    ),
  ];
  const results: Card[] = [
    card(7, t("dev.listings.exact"), {}, hoursAgo(2), "exact"),
    card(8, t("dev.listings.close"), { primary_image: GOLD }, hoursAgo(4), "close"),
  ];

  return (
    <>
      <h3>{t("dev.listings.cards")}</h3>
      <ul className={styles.listingGrid}>
        {cards.map((item) => (
          <li key={item.id}>
            <ListingCard card={item} now={now} />
          </li>
        ))}
      </ul>

      <h3>{t("dev.listings.pendingFull")}</h3>
      <div className={styles.listingMedia}>
        <ImagesPending />
      </div>

      <h3>{t("dev.listings.gallery")}</h3>
      <div className={styles.listingMedia}>
        <ImageGallery images={[GREEN, GOLD, DARK]} title={t("dev.listings.ready")} />
      </div>

      <h3>{t("dev.listings.filters")}</h3>
      <MarketFilters
        filters={{
          q: t("dev.listings.query"),
          category: "books_study",
          condition: null,
          location: null,
          sort: "price_asc",
        }}
        catalog={{ categories: [category], meeting_points: [point] }}
      />

      <h3>{t("dev.listings.results")}</h3>
      <MarketResults initialCards={results} initialCursor={null} query="" now={now.toISOString()} />

      <h3>{t("dev.listings.states")}</h3>
      <div className={styles.states}>
        <EmptyState
          headingLevel={3}
          title={t("market.market.emptyTitle")}
          body={t("market.market.emptyBody")}
          action={
            <LinkButton href={routes.market} variant="secondary">
              {t("market.market.reset")}
            </LinkButton>
          }
        />
        <ErrorState
          headingLevel={3}
          title={t("market.market.errorTitle")}
          body={t("market.market.errorBody")}
          action={
            <LinkButton href={routes.market} variant="secondary">
              {t("market.market.retry")}
            </LinkButton>
          }
        />
        <ErrorState
          headingLevel={3}
          title={t("market.market.invalidTitle")}
          body={t("market.market.invalidBody")}
          action={
            <LinkButton href={routes.market} variant="secondary">
              {t("market.market.invalidAction")}
            </LinkButton>
          }
        />
        <Alert variant="warning" title={t("market.market.rateLimitedTitle")}>
          <p>{t("market.market.rateLimitedBody", { wait: formatWait(40) })}</p>
        </Alert>
        <Alert variant="danger" title={t("market.market.loadMoreFailed")}>
          <p>{t("market.market.errorBody")}</p>
        </Alert>
      </div>
    </>
  );
}
