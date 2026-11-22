"use client";

// A button that shows and hides a panel: the mobile menu and the account menu (chapter 02).
// aria-expanded tells screen readers the state; Escape closes and returns focus to the button;
// a click outside or on a link inside closes it.
// Task 4.0 (item C, owner condition 2): until React hydrates the page the button is disabled,
// with a spinner and «جارٍ التحميل» for screen readers, so a press is never lost without a sign.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@souq/i18n";
import { useHydrated } from "../../lib/client/use-hydrated";
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
  const hydrated = useHydrated();

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
        disabled={!hydrated}
        aria-busy={hydrated ? undefined : true}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {hydrated ? null : <span className={styles.spinner} aria-hidden="true" />}
        {buttonContent}
        {hydrated ? null : (
          <>
            {" "}
            <span className="visually-hidden">{t("ui.loading")}</span>
          </>
        )}
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
