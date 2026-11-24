// Task 4.2 (item 13): one choice among cards, each a radio button with a label and an optional
// short explanation: the five item conditions (BR04) and the meeting places (DEC28). A native
// radio group inside a fieldset, so the arrow keys move between options and screen readers say
// "1 of 5". The selected card has a thicker border and a check mark besides its color. An error
// is linked to every option with aria-describedby.
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { cx } from "../../lib/cx";
import styles from "./ChoiceCards.module.css";

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

interface ChoiceCardsProps {
  /** The radio group's name, and the prefix of the options' ids. */
  name: string;
  legend: string;
  options: readonly ChoiceOption[];
  /** Controlled: the selected value ("" for none), with onChange. */
  value?: string;
  onChange?: (value: string) => void;
  /** Uncontrolled (the /dev/ui gallery). */
  defaultValue?: string;
  hint?: string;
  error?: string;
  /** Content between the legend and the cards, such as a search field. */
  children?: ReactNode;
}

export function ChoiceCards({
  name,
  legend,
  options,
  value,
  onChange,
  defaultValue,
  hint,
  error,
  children,
}: ChoiceCardsProps) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const described = [hint === undefined ? "" : hintId, error === undefined ? "" : errorId]
    .filter(Boolean)
    .join(" ");
  return (
    <fieldset
      className={styles.fieldset}
      aria-describedby={described === "" ? undefined : described}
    >
      <legend className={styles.legend}>{legend}</legend>
      {hint !== undefined && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {children}
      {error !== undefined && (
        <p id={errorId} className={styles.error}>
          <Icon name="error" size={18} />
          {error}
        </p>
      )}
      <div className={styles.cards}>
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const checked = value === undefined ? undefined : value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cx(styles.card, checked === true && styles.checked)}
            >
              <input
                id={id}
                className={styles.input}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                defaultChecked={value === undefined ? option.value === defaultValue : undefined}
                onChange={
                  onChange === undefined
                    ? undefined
                    : () => {
                        onChange(option.value);
                      }
                }
              />
              <span className={styles.text}>
                <span className={styles.label}>{option.label}</span>
                {option.hint !== undefined && (
                  <span className={styles.optionHint}>{option.hint}</span>
                )}
              </span>
              <span className={styles.mark} aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
