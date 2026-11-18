import type { ReactNode } from "react";
import { t } from "@souq/i18n";
import { cx } from "../../lib/cx";
import styles from "./Badge.module.css";

export type BadgeVariant = "student" | "negotiable" | "condition" | "neutral";

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={cx(styles.badge, styles[variant])}>{children}</span>;
}

/**
 * DEC27: the badge means a moderator reviewed a student card, nothing more. With `withHint` the
 * explanation is shown next to it (public profile); elsewhere it is read by screen readers.
 */
export function StudentBadge({ withHint = false }: { withHint?: boolean }) {
  const hint = t("ui.badge.studentHint");
  return (
    <span className={styles.studentWrap}>
      <Badge variant="student">{t("ui.badge.student")}</Badge>
      {withHint ? (
        <span className={styles.hint}>{hint}</span>
      ) : (
        <span className="visually-hidden">{hint}</span>
      )}
    </span>
  );
}

export function NegotiableBadge() {
  return <Badge variant="negotiable">{t("ui.badge.negotiable")}</Badge>;
}
