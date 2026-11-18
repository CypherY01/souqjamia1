// Messages with a title, an icon and text: the variant is never shown by color alone.
import type { ReactNode } from "react";
import { t } from "@souq/i18n";
import { Icon, type IconName } from "./Icon";
import { cx } from "../../lib/cx";
import styles from "./Alert.module.css";

export type AlertVariant = "info" | "success" | "warning" | "danger" | "safety";

const icons: Record<AlertVariant, IconName> = {
  info: "info",
  success: "check",
  warning: "warning",
  danger: "error",
  safety: "shield",
};

interface AlertProps {
  variant: AlertVariant;
  title: string;
  children?: ReactNode;
  /** Announce it when it appears after an action (role="alert" for danger, else "status"). */
  live?: boolean;
}

export function Alert({ variant, title, children, live = false }: AlertProps) {
  const role = live ? (variant === "danger" ? "alert" : "status") : undefined;
  return (
    <div className={cx(styles.alert, styles[variant])} role={role}>
      <span className={styles.icon}>
        <Icon name={icons[variant]} />
      </span>
      <div>
        <p className={styles.title}>{title}</p>
        {children !== undefined && <div className={styles.body}>{children}</div>}
      </div>
    </div>
  );
}

/** BR10 and DEC28: meet in a public place, never write a room or home address. */
export function SafeMeetupNotice() {
  return (
    <Alert variant="safety" title={t("ui.alert.safety")}>
      {t("ui.safety.meetup")}
    </Alert>
  );
}
