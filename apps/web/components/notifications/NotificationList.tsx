// The notifications list (task 3.8, FR48): newest first, «غير مقروء» in text (never color
// alone), the Riyadh time, and the destination the server derived. An item this build cannot
// open shows «غير متاح». Used by /notifications and the /dev/ui gallery.
import { t } from "@souq/i18n";
import { cx } from "../../lib/cx";
import { Badge } from "../ui/Badge";
import { DateTimeText } from "../ui/Display";
import { NotificationLink } from "./NotificationLink";
import styles from "./notifications.module.css";

export interface NotificationListItem {
  id: string;
  text: string;
  destination: string;
  available: boolean;
  read_at: string | null;
  created_at: string;
}

export function NotificationList({
  items,
  preview = false,
}: {
  items: readonly NotificationListItem[];
  preview?: boolean;
}) {
  return (
    <ul className={styles.list} aria-label={t("notifications.page.listLabel")}>
      {items.map((item) => {
        const unread = item.read_at === null;
        return (
          <li key={item.id} className={cx(styles.item, unread && styles.unread)}>
            <div className={styles.line}>
              {unread && <Badge variant="neutral">{t("notifications.page.unread")}</Badge>}
              <span className={styles.when}>
                <DateTimeText value={item.created_at} />
              </span>
            </div>
            {item.available ? (
              <NotificationLink
                id={item.id}
                href={item.destination}
                unread={unread}
                preview={preview}
              >
                {item.text}
              </NotificationLink>
            ) : (
              <p className={styles.text}>
                {item.text}{" "}
                <span className={styles.unavailable}>{t("notifications.page.unavailable")}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
