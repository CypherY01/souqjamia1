"use client";

// A multi-line field with a live character counter. The count uses the same rule as the server:
// Unicode code points after NFC and trimming (countChars from @souq/domain).
import { useState, type TextareaHTMLAttributes } from "react";
import { countChars } from "@souq/domain";
import { t } from "@souq/i18n";
import { describedBy, FieldFrame } from "./Field";
import styles from "./Field.module.css";

interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "className" | "maxLength"
> {
  id: string;
  label: string;
  /** The rule's limit. The browser does not cut the text; the server rejects longer input. */
  maxChars: number;
  hint?: string;
  error?: string;
  optional?: boolean;
}

export function TextArea({
  id,
  label,
  maxChars,
  hint,
  error,
  optional,
  defaultValue,
  onChange,
  ...rest
}: TextAreaProps) {
  const [count, setCount] = useState(() =>
    countChars(typeof defaultValue === "string" ? defaultValue : ""),
  );
  const counterId = `${id}-counter`;
  const over = count > maxChars;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        {...rest}
        id={id}
        defaultValue={defaultValue}
        className={styles.control}
        required={optional !== true}
        aria-invalid={error !== undefined || over ? true : undefined}
        aria-describedby={[describedBy(id, hint, error), counterId].filter(Boolean).join(" ")}
        onChange={(event) => {
          setCount(countChars(event.target.value));
          onChange?.(event);
        }}
      />
      <p id={counterId} className={styles.counter}>
        {t("ui.charCount", { count, max: maxChars })}
      </p>
    </FieldFrame>
  );
}
