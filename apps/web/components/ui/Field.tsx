// Form fields: every control has a visible label, and hints and errors are linked with
// aria-describedby (WCAG 2.2 AA, chapter 02). Server-side validation stays the authority.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
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
  children: ReactNode;
}

export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint === undefined ? "" : `${id}-hint`, error === undefined ? "" : `${id}-error`];
  const joined = ids.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

export function FieldFrame({ id, label, hint, error, optional, children }: FieldFrameProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {optional === true && <span className={styles.optional}> {t("ui.optional")}</span>}
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
  type?: "text" | "email" | "password" | "search" | "tel" | "url";
}

export function TextField({
  id,
  label,
  hint,
  error,
  optional,
  type = "text",
  ...rest
}: TextFieldProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        {...rest}
        id={id}
        type={type}
        className={styles.control}
        required={optional !== true}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(id, hint, error)}
      />
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
  placeholder,
  options,
  ...rest
}: SelectProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
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
}

export function Checkbox({ id, label, ...rest }: CheckboxProps) {
  return (
    <div className={styles.choice}>
      <input {...rest} id={id} type="checkbox" />
      <label htmlFor={id}>{label}</label>
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
