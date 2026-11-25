// «الصور قيد التجهيز» (owner note on task 4.2, task 4.3): the listing is committed before
// media.publish copies its public images, so a card or a listing page can come first. This takes
// the image's place instead of a link to a file that is not there yet: no broken image and no
// 404 from Storage. The text says it, the icon only decorates.
import { t } from "@souq/i18n";
import { Icon } from "../ui/Icon";
import styles from "./listings.module.css";

export function ImagesPending({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? styles.pendingCompact : styles.pending}>
      <Icon name="image" size={compact ? 28 : 40} />
      <p className={styles.pendingTitle}>
        {compact ? t("market.card.imagesPending") : t("market.listing.imagesPendingTitle")}
      </p>
      {!compact && <p className={styles.pendingBody}>{t("market.listing.imagesPendingBody")}</p>}
    </div>
  );
}
