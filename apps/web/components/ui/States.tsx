// Every screen has distinct loading, empty and error states (CLAUDE.md, plan/screens.md).
// "No results" is an EmptyState; "the request failed" is an ErrorState with a retry (FR07).
import type { ReactNode } from "react";
import { t } from "@souq/i18n";
import { Icon } from "./Icon";
import { cx } from "../../lib/cx";
import styles from "./States.module.css";

export function LoadingState({ label = t("ui.loading") }: { label?: string }) {
  return (
    <div className={styles.state} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <p className={styles.text}>{label}</p>
    </div>
  );
}

interface MessageStateProps {
  title: string;
  body?: string;
  /** A call to action: a LinkButton for empty states, a retry Button for errors. */
  action?: ReactNode;
  /** 1 when the state is the whole page (not-found, page error). */
  headingLevel?: 1 | 2 | 3;
}

export function EmptyState({ title, body, action, headingLevel = 2 }: MessageStateProps) {
  const Heading = `h${String(headingLevel)}` as "h1" | "h2" | "h3";
  return (
    <div className={styles.state}>
      <Heading className={styles.title}>{title}</Heading>
      {body !== undefined && <p className={styles.text}>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, body, action, headingLevel = 2 }: MessageStateProps) {
  const Heading = `h${String(headingLevel)}` as "h1" | "h2" | "h3";
  return (
    <div className={cx(styles.state, styles.error)} role="alert">
      <span className={styles.errorIcon}>
        <Icon name="error" size={32} />
      </span>
      <Heading className={styles.title}>{title}</Heading>
      {body !== undefined && <p className={styles.text}>{body}</p>}
      {action}
    </div>
  );
}
