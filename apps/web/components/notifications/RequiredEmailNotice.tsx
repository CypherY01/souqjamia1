// Task 3.8 (BR38, SEC11): the email that is always sent, shown as a fact with a «إلزامي» badge,
// not as a disabled control.
import { t } from "@souq/i18n";
import { Badge } from "../ui/Badge";
import styles from "./preferences.module.css";

export function RequiredEmailNotice() {
  return (
    <section className={styles.required} aria-labelledby="required-email-title">
      <div className={styles.requiredHead}>
        <h2 id="required-email-title">{t("notifications.preferences.required.title")}</h2>
        <Badge variant="neutral">{t("notifications.preferences.required.badge")}</Badge>
      </div>
      <p>{t("notifications.preferences.required.body")}</p>
    </section>
  );
}
