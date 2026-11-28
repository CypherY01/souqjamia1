// «بطاقة الإعلان» (plan/screens.md, task 4.3): a 4:3 image or «الصور قيد التجهيز», the price or
// «مجاني», the condition, «قابل للتفاوض», the title (the link to the listing, FR06), the meeting
// point or «حسب الاتفاق» (DEC28), a relative date and the student badge. Task 4.5: the favorite
// control over the image, outside the title link (it does not open the listing). The whole card
// is the link's target area, so its border is a control border (CLAUDE.md, interactive
// boundaries).
// No "use client": the server renders it, and the market's «أظهر المزيد» renders more of it.
import Link from "next/link";
import { t } from "@souq/i18n";
import type { FavoriteMode } from "../../lib/favorites/mode";
import type { ListingCard as Card } from "../../lib/listings/public";
import { routes } from "../../lib/routes";
import { SafeText } from "../text/SafeText";
import { Badge, NegotiableBadge, StudentBadge } from "../ui/Badge";
import { Price, RelativeDate } from "../ui/Display";
import { FavoriteButton } from "./FavoriteButton";
import { ImagesPending } from "./ImagesPending";
import styles from "./listings.module.css";

export interface CardFavorite {
  mode: FavoriteMode;
  /** The local path the guest's login comes back to. */
  returnTo: string;
  onChange?: (saved: boolean) => void;
}

interface ListingCardProps {
  card: Card;
  /** The server's time of the page, so every card's relative date uses the same clock. */
  now: Date;
  /** The first cards of a page load their image at once; the rest when they come near. */
  eager?: boolean;
  headingLevel?: 2 | 3;
  /** Task 4.5: the favorite control; none when left out. */
  favorite?: CardFavorite;
}

export function ListingCard({
  card,
  now,
  eager = false,
  headingLevel = 3,
  favorite,
}: ListingCardProps) {
  const Heading = `h${String(headingLevel)}` as "h2" | "h3";
  const image = card.primary_image;
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        {image === null ? (
          <ImagesPending compact />
        ) : (
          // The worker already made the sizes (w150, w600, DEC08): no next/image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.image}
            src={image.w600}
            srcSet={`${image.w150} 150w, ${image.w600} 600w`}
            sizes="(min-width: 1024px) 280px, (min-width: 768px) 33vw, 50vw"
            width={600}
            height={450}
            alt={""}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
          />
        )}
      </div>
      {favorite !== undefined && (
        <FavoriteButton
          listingId={card.id}
          title={card.title}
          saved={card.is_favorite === true}
          mode={favorite.mode}
          returnTo={favorite.returnTo}
          size="card"
          {...(favorite.onChange === undefined ? {} : { onChange: favorite.onChange })}
        />
      )}
      <div className={styles.body}>
        <Heading className={styles.title}>
          <Link className={styles.link} href={routes.listing(card.id)}>
            <SafeText text={card.title} newTabLabel={t("ui.newTab")} links={false} />
          </Link>
        </Heading>
        <p className={styles.price}>
          <Price halalas={card.price_minor} />
        </p>
        <p className={styles.badges}>
          {card.status === "sold" && <Badge variant="neutral">{t("market.card.sold")}</Badge>}
          <Badge variant="condition">{t(`listing.condition.${card.condition}.label`)}</Badge>
          {card.is_negotiable && <NegotiableBadge />}
          {card.seller_student_badge && <StudentBadge />}
        </p>
        <p className={styles.meta}>
          <span>{card.location?.label_ar ?? t("listing.location.byAgreement")}</span>
          <RelativeDate value={card.created_at} now={now} />
        </p>
      </div>
    </article>
  );
}
