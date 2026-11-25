// Form fields: every control has a visible label, and hints and errors are linked with
// aria-describedby (WCAG 2.2 AA, chapter 02). Server-side validation stays the authority.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { countChars } from "@souq/domain";
import { t } from "@souq/i18n";
import { Icon } from "./Icon";
import { cx } from "../../lib/cx";
import styles from "./Field.module.css";

interface FieldFrameProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
  /** Task 4.3: false hides «(اختياري)» where every field is optional (the market filters). */
  optionalMark?: boolean | undefined;
  children: ReactNode;
}

export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint === undefined ? "" : `${id}-hint`, error === undefined ? "" : `${id}-error`];
  const joined = ids.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

export function FieldFrame({
  id,
  label,
  hint,
  error,
  optional,
  optionalMark = true,
  children,
}: FieldFrameProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {optional === true && optionalMark && (
          <span className={styles.optional}> {t("ui.optional")}</span>
        )}
      </label>
      {hint !== undefined && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {children}
      {error !== undefined && (
        <p id={`${id}-error`} className={styles.error}>
          <Icon name="error" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type">;

interface TextFieldProps extends InputProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  optionalMark?: boolean;
  type?: "text" | "email" | "password" | "search" | "tel" | "url";
  /**
   * Task 4.2: shows a live counter of the value against this limit, counted like the server
   * (code points after NFC and trimming). The browser never cuts the text (no maxLength: it
   * counts UTF-16 units). Needs a controlled `value`.
   */
  maxChars?: number;
}

export function TextField({
  id,
  label,
  hint,
  error,
  optional,
  optionalMark,
  type = "text",
  maxChars,
  ...rest
}: TextFieldProps) {
  const counterId = `${id}-counter`;
  const count =
    maxChars === undefined ? 0 : countChars(typeof rest.value === "string" ? rest.value : "");
  const described = [describedBy(id, hint, error), maxChars === undefined ? undefined : counterId]
    .filter(Boolean)
    .join(" ");
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      optionalMark={optionalMark}
    >
      <input
        {...rest}
        id={id}
        type={type}
        className={styles.control}
        required={optional !== true}
        aria-invalid={
          error !== undefined || (maxChars !== undefined && count > maxChars) ? true : undefined
        }
        aria-describedby={described === "" ? undefined : described}
      />
      {maxChars !== undefined && (
        <p id={counterId} className={styles.counter}>
          {t("ui.charCount", { count, max: maxChars })}
        </p>
      )}
    </FieldFrame>
  );
}

/**
 * An amount in riyals. Accepts Western and Arabic-Indic digits (DEC50); the server converts them
 * with parseAmount from @souq/domain and rejects more than two decimals instead of rounding.
 */
export function AmountField({
  id,
  label,
  hint,
  error,
  optional,
  ...rest
}: Omit<TextFieldProps, "type">) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className={cx(styles.control, styles.amount)}
        required={optional !== true}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(id, hint, error)}
      />
    </FieldFrame>
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  optionalMark?: boolean;
  /** The first, empty option, e.g. "اختر الفئة". */
  placeholder: string;
  options: readonly { value: string; label: string }[];
}

export function Select({
  id,
  label,
  hint,
  error,
  optional,
  optionalMark,
  placeholder,
  options,
  ...rest
}: SelectProps) {
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      optionalMark={optionalMark}
    >
      <select
        {...rest}
        id={id}
        className={styles.control}
        required={optional !== true}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(id, hint, error)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

interface CheckboxProps extends Omit<InputProps, "children"> {
  id: string;
  label: string;
  /** Task 3.2: a field error under the box, linked with aria-describedby. */
  error?: string;
  /** Task 3.2: content under the label, such as a link to the policy being accepted. */
  extra?: ReactNode;
}

export function Checkbox({ id, label, error, extra, ...rest }: CheckboxProps) {
  const box = (
    <div className={styles.choice}>
      <input
        {...rest}
        id={id}
        type="checkbox"
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
  if (error === undefined && extra === undefined) return box;
  return (
    <div className={styles.choiceField}>
      {box}
      {extra !== undefined && <p className={styles.choiceExtra}>{extra}</p>}
      {error !== undefined && (
        <p id={`${id}-error`} className={styles.error}>
          <Icon name="error" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}

interface RadioGroupProps {
  name: string;
  legend: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
}

export function RadioGroup({ name, legend, options, defaultValue }: RadioGroupProps) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        return (
          <div key={option.value} className={styles.choice}>
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === defaultValue}
            />
            <label htmlFor={id}>{option.label}</label>
          </div>
        );
      })}
    </fieldset>
  );
}
