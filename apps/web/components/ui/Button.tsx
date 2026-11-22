import Link from "next/link";
import { t } from "@souq/i18n";
import { useId, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function buttonClassName(variant: ButtonVariant, fullWidth = false): string {
  return cx(styles.button, styles[variant], fullWidth && styles.fullWidth);
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** While true the button is disabled and shows `loadingLabel` with a spinner. */
  loading?: boolean;
  loadingLabel?: string;
  /**
   * Task 4.0 (owner condition 2): the page is not interactive yet (SubmitButton, before React
   * hydrates). Disabled, with a spinner, the label kept, and «جارٍ التحميل» for screen readers.
   */
  preparing?: boolean;
  /**
   * Why the action is unavailable (`disabled_reason`, chapter 02). Disables the button and shows
   * the reason as text next to it, linked with aria-describedby.
   */
  disabledReason?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  fullWidth = false,
  loading = false,
  loadingLabel,
  preparing = false,
  disabledReason,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const button = (
    <button
      {...rest}
      type={type}
      className={buttonClassName(variant, fullWidth)}
      disabled={disabled === true || loading || preparing || disabledReason !== undefined}
      aria-describedby={disabledReason === undefined ? rest["aria-describedby"] : reasonId}
      aria-busy={preparing && !loading ? true : undefined}
    >
      {loading ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          {loadingLabel ?? children}
        </>
      ) : preparing ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          {children} <span className="visually-hidden">{t("ui.loading")}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
  if (disabledReason === undefined) return button;
  return (
    <span className={styles.withReason}>
      {button}
      <span id={reasonId} className={styles.reason}>
        {disabledReason}
      </span>
    </span>
  );
}

interface LinkButtonProps extends Omit<ComponentProps<typeof Link>, "className"> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

/** A navigation link that looks like a button. Navigation stays a link (no state change). */
export function LinkButton({ variant = "primary", fullWidth = false, ...rest }: LinkButtonProps) {
  return <Link {...rest} className={buttonClassName(variant, fullWidth)} />;
}
