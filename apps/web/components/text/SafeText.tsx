// SEC06 and TC31: member text is rendered by React as text, so any HTML in it is shown, never run.
// Only http and https URLs become links. Bidi controls are dropped for display only.
import { Fragment } from "react";
import { linkify, stripBidiControls } from "@souq/domain";
import styles from "./SafeText.module.css";

export const MEMBER_LINK_REL = "noopener noreferrer nofollow ugc";

interface SafeTextProps {
  /** Member-written text, exactly as stored. */
  text: string;
  /** Screen-reader hint for links that open in a new tab, from t("ui.newTab"). */
  newTabLabel: string;
  /**
   * Task 4.3: false inside a link of our own (a listing card's title), where another link would
   * be invalid HTML. The text stays plain, URLs included.
   */
  links?: boolean;
}

export function SafeText({ text, newTabLabel, links = true }: SafeTextProps) {
  const clean = stripBidiControls(text);
  if (!links) return <bdi className={styles.text}>{clean}</bdi>;
  const parts = linkify(clean);
  return (
    // <bdi> isolates the member's text direction from the surrounding interface (NFR02).
    <bdi className={styles.text}>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <Fragment key={index}>{part.value}</Fragment>
        ) : (
          <a
            key={index}
            className={styles.link}
            href={part.href}
            rel={MEMBER_LINK_REL}
            target="_blank"
            dir="ltr"
          >
            {part.text}
            <span className="visually-hidden"> {newTabLabel}</span>
          </a>
        ),
      )}
    </bdi>
  );
}
