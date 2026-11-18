"use client";

// A modal built on the native <dialog>: Escape closes it, focus stays inside while it is open, and
// focus returns to the button that opened it (chapter 02). It fits the viewport on small screens.
import { useId, useRef, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import styles from "./Dialog.module.css";

interface DialogProps {
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  closeLabel: string;
  children: ReactNode;
  /** Extra buttons next to Close, e.g. the confirming action. */
  actions?: ReactNode;
}

export function Dialog({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  closeLabel,
  children,
  actions,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button
        variant={triggerVariant}
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{children}</div>
        <form method="dialog" className={styles.actions}>
          {actions}
          <Button type="submit" variant="ghost">
            {closeLabel}
          </Button>
        </form>
      </dialog>
    </>
  );
}
