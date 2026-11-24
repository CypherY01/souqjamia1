// Task 4.2 (FR16, item 13): where a member is in a multi-step form. The progress is said in text
// («الخطوة 2 من 5») and each step's state too («مكتملة», «الخطوة الحالية»), never by color alone;
// the current step has aria-current="step". The steps are not links: a form moves between them
// with its own buttons, so a step is never skipped.
import { formatNumber, t } from "@souq/i18n";
import { cx } from "../../lib/cx";
import styles from "./Stepper.module.css";

interface StepperProps {
  /** The accessible name of the list, e.g. «خطوات النشر». */
  label: string;
  steps: readonly string[];
  /** 1-based. */
  current: number;
}

export function Stepper({ label, steps, current }: StepperProps) {
  return (
    <nav className={styles.stepper} aria-label={label}>
      <p className={styles.progress}>
        {t("ui.stepper.progress", {
          current: formatNumber(current),
          total: formatNumber(steps.length),
        })}
      </p>
      <ol className={styles.list}>
        {steps.map((step, index) => {
          const position = index + 1;
          const state = position < current ? "done" : position === current ? "current" : "next";
          return (
            <li
              key={step}
              className={cx(styles.step, styles[state])}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={styles.number} aria-hidden="true">
                {formatNumber(position)}
              </span>
              <span className={styles.label}>{step}</span>
              {state === "done" && <span className="visually-hidden">{t("ui.stepper.done")}</span>}
              {state === "current" && (
                <span className="visually-hidden">{t("ui.stepper.current")}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
