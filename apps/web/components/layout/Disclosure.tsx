"use client";

// A button that shows and hides a panel: the mobile menu and the account menu (chapter 02).
// aria-expanded tells screen readers the state; Escape closes and returns focus to the button;
// a click outside or on a link inside closes it.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Disclosure.module.css";

interface DisclosureProps {
  /** "menu": collapses on small screens only, always open on wide ones. */
  kind: "menu" | "account";
  buttonContent: ReactNode;
  children: ReactNode;
}

export function Disclosure({ kind, buttonContent, children }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === false) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cx(styles.root, styles[kind])} data-open={open}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {buttonContent}
      </button>
      <div
        id={panelId}
        className={styles.panel}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a") !== null) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
