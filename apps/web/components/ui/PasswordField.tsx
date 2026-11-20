"use client";

// A password field (task 3.2, item 8): a show/hide toggle button and, for a new password, the
// limits only when they come near (DEC75): the count "x of 64" past 56 characters, and with it a
// notice past 72 UTF-8 bytes (Arabic letters and emoji take more than one byte). The hint under
// the field says "8 characters at least" only. The rule is checkPassword from @souq/domain, the
// same as on the server (DEC32). The value is never trimmed or changed, and the browser does not
// cut it: the server rejects longer input. Uncontrolled, so a form reads it from FormData.
import { useState, type InputHTMLAttributes } from "react";
import { PASSWORD_MAX, passwordHints, passwordLength } from "@souq/domain";
import { formatNumber, t } from "@souq/i18n";
import { describedBy, FieldFrame } from "./Field";
import styles from "./Field.module.css";

interface PasswordFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "className" | "type" | "maxLength" | "value"
> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** "new-password" for signup and reset, "current-password" for login and reauthentication. */
  autoComplete: "new-password" | "current-password";
  /** New passwords only: the count and the byte notice near the limits (DEC75). */
  showRules?: boolean;
}

export function PasswordField({
  id,
  label,
  hint,
  error,
  autoComplete,
  showRules = true,
  defaultValue,
  onChange,
  ...rest
}: PasswordFieldProps) {
  const initial = typeof defaultValue === "string" ? defaultValue : "";
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState(initial);
  const counterId = `${id}-counter`;
  const bytesId = `${id}-bytes`;
  const hints = passwordHints(value);
  const showCount = showRules && hints.count;
  const showBytes = showRules && hints.tooManyBytes;
  const described = [
    describedBy(id, hint, error),
    showCount ? counterId : undefined,
    showBytes ? bytesId : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className={styles.passwordRow}>
        <input
          {...rest}
          id={id}
          type={visible ? "text" : "password"}
          defaultValue={defaultValue}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="auto"
          className={styles.control}
          required
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={described === "" ? undefined : described}
          onChange={(event) => {
            setValue(event.target.value);
            onChange?.(event);
          }}
        />
        <button
          type="button"
          className={styles.reveal}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => {
            setVisible((shown) => !shown);
          }}
        >
          {t("ui.password.show")}
        </button>
      </div>
      {showCount && (
        <p id={counterId} className={styles.counter}>
          {t("ui.password.count", {
            count: formatNumber(passwordLength(value)),
            max: formatNumber(PASSWORD_MAX),
          })}
        </p>
      )}
      {showBytes && (
        <p id={bytesId} className={styles.notice}>
          {t("ui.password.tooManyBytes")}
        </p>
      )}
    </FieldFrame>
  );
}
