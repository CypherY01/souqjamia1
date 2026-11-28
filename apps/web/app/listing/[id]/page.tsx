// /listing/{id} «تفاصيل إعلان» (task 4.3, plan/screens.md, FR13, UC04, TC05, TC31, TC81): the
// images (or «الصور قيد التجهيز»), the title, price, condition, category, meeting point or
// «حسب الاتفاق», the description as plain text with its line breaks and safe links, and the
// seller. A sold listing keeps its page with its state (DEC84). Anything the public may not see
// is the generic «غير متاح» page, the same for every reason. The contact button and the guest's
// sign-in come with task 5.1 (owner item 6): the capabilities are already computed (API032).
// Task 4.4: the seller's note links to «إعلاناتي».
// Task 4.5: the favorite control next to the price (the seller may save their own, DEC86).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { formatMonth, t } from "@souq/i18n";
import { ImageGallery } from "../../../components/listings/ImageGallery";
import { SafeText } from "../../../components/text/SafeText";
import { Alert, SafeMeetupNotice } from "../../../components/ui/Alert";
import { NegotiableBadge, StudentBadge } from "../../../components/ui/Badge";
import { LinkButton } from "../../../components/ui/Button";
import { DateText, Price } from "../../../components/ui/Display";
import { FavoriteButton } from "../../../components/listings/FavoriteButton";
import { loadPublicListing, pageFavoriteMode } from "../../../lib/listings/pages";
import { routes } from "../../../lib/routes";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// The metadata and the page read the listing once per request.
const listingOf = cache((id: string) => loadPublicListing(id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const listing = await listingOf((await params).id);
  return { title: listing === null ? t("errors.notFound.title") : listing.title };
}

export default async function ListingPage({ params }: Props) {
  const listing = await listingOf((await params).id);
  if (listing === null) notFound();
  const newTab = t("ui.newTab");
  const { seller } = listing;

  return (
    <article className={styles.page}>
      <div className={styles.top}>
        <div className={styles.gallery}>
          <ImageGallery images={listing.images} title={listing.title} />
        </div>
        <div className={styles.summary}>
          <h1 className={styles.title}>
            <SafeText text={listing.title} newTabLabel={newTab} links={false} />
          </h1>
          <p className={styles.price}>
            <span className="visually-hidden">{t("market.listing.price")} </span>
            <Price halalas={listing.price_minor} />
            {listing.is_negotiable && <NegotiableBadge />}
          </p>
          <FavoriteButton
            listingId={listing.id}
            title={listing.title}
            saved={listing.is_favorite === true}
            mode={await pageFavoriteMode()}
            returnTo={routes.listing(listing.id)}
            size="page"
          />
          {listing.status === "sold" && (
            <Alert variant="info" title={t("market.listing.soldTitle")}>
              {listing.sold_at !== null && (
                <p>
                  {t("market.listing.soldOn")} <DateText value={listing.sold_at} />
                </p>
              )}
              <p>{t("market.listing.soldBody")}</p>
            </Alert>
          )}
          {listing.capabilities.disabled_reason === "own_content" && (
            <Alert variant="info" title={t("market.listing.ownTitle")}>
              <p>{t("market.listing.ownBody")}</p>
              <p>
                <LinkButton href={routes.account.listings} variant="secondary">
                  {t("market.listing.manage")}
                </LinkButton>
              </p>
            </Alert>
          )}
          <dl className={styles.facts} aria-label={t("market.listing.facts")}>
            <div>
              <dt>{t("market.listing.condition")}</dt>
              <dd>
                {t(`listing.condition.${listing.condition}.label`)}
                <span className={styles.hint}>
                  {t(`listing.condition.${listing.condition}.hint`)}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("market.listing.category")}</dt>
              <dd>{listing.category.label_ar}</dd>
            </div>
            <div>
              <dt>{t("market.listing.location")}</dt>
              <dd>{listing.location?.label_ar ?? t("listing.location.byAgreement")}</dd>
            </div>
            <div>
              <dt>{t("market.listing.published")}</dt>
              <dd>
                <DateText value={listing.created_at} />
              </dd>
            </div>
          </dl>
          <SafeMeetupNotice />
          <section className={styles.seller} aria-labelledby="seller-title">
            <h2 id="seller-title">{t("market.listing.sellerTitle")}</h2>
            <p className={styles.sellerName}>
              <SafeText text={seller.display_name} newTabLabel={newTab} links={false} />
            </p>
            {seller.student_badge && <StudentBadge withHint />}
            {seller.college !== null && <p>{seller.college.label_ar}</p>}
            <p>
              {t("market.listing.joined")} <bdi>{formatMonth(seller.joined_month)}</bdi>
            </p>
            {seller.rating.count === 0 && (
              <p className={styles.newSeller}>{t("market.listing.newSeller")}</p>
            )}
          </section>
        </div>
      </div>
      <section className={styles.description} aria-labelledby="description-title">
        <h2 id="description-title">{t("market.listing.description")}</h2>
        <p>
          <SafeText text={listing.description} newTabLabel={newTab} />
        </p>
      </section>
      <p>
        <LinkButton href={routes.market} variant="secondary">
          {t("market.listing.browseMore")}
        </LinkButton>
      </p>
    </article>
  );
}
