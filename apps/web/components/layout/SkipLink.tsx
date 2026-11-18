import { t } from "@souq/i18n";
import styles from "./SkipLink.module.css";

export const MAIN_CONTENT_ID = "main-content";

/** The first focusable element on every page: jumps past the header (WCAG 2.4.1). */
export function SkipLink() {
  return (
    <a href={`#${MAIN_CONTENT_ID}`} className={styles.skip}>
      {t("layout.skipLink")}
    </a>
  );
}
