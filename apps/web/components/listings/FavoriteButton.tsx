"use client";
// Task 4.5 (FR15, UC05, DEC86, items 2, 7 and 8): the favorite control of a card and of the
// listing page.
//  - member: a form (method="post") sent by JavaScript, PUT or DELETE /api/favorites/{id}
//    (API049, API050). Until React hydrates, SubmitButton is disabled (task 4.0). The visible
//    text changes with the state («احفظ» / «محفوظ») and the heart fills, so the state is never
//    told by color alone; the accessible name carries the listing's title, so a page of cards
//    has distinct buttons. A polite status line says what happened.
//  - guest: a plain link to the login page that comes back here (works without JavaScript).
//  - none: nothing (a restricted account, a recovery session...).
// A failure keeps the previous state and shows why: «غير متاح» (NOT_FOUND), DEC86's limit and
// quota (LIMIT_REACHED, RATE_LIMITED with the wait), or a generic retry.
import { useState, type SubmitEvent } from "react";
import { FAVORITES_MAX, stripBidiControls } from "@souq/domain";
import { formatNumber, formatWait, t } from "@souq/i18n";
import { api } from "../../lib/client/api";
import { cx } from "../../lib/cx";
import type { FavoriteMode } from "../../lib/favorites/mode";
import { routes } from "../../lib/routes";
import { buttonClassName } from "../ui/Button";
import { SubmitButton } from "../ui/SubmitButton";
import styles from "./favorite.module.css";

export interface FavoriteButtonProps {
  listingId: string;
  /** The listing's title, for the accessible name (member text, bidi controls dropped). */
  title: string;
  saved: boolean;
  mode: FavoriteMode;
  /** The local path the guest's login comes back to. */
  returnTo: string;
  /** card: a short label over the image; page: the long label next to the price. */
  size: "card" | "page";
  /** Called after the server answered 204, with the new state. */
  onChange?: (saved: boolean) => void;
  /** The /dev/ui gallery only: show a failure state at once. */
  initialProblem?: Problem;
}

export type Problem = { kind: "failed" | "unavailable" | "limit" } | { kind: "rate"; wait: number };

function problemText(problem: Problem): string {
  switch (problem.kind) {
    case "unavailable":
      return t("favorites.button.unavailable");
    case "limit":
      return t("favorites.button.limitReached", { max: formatNumber(FAVORITES_MAX) });
    case "rate":
      return t("favorites.button.rateLimited", { wait: formatWait(problem.wait) });
    case "failed":
      return t("favorites.button.failed");
  }
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      className={cx(styles.heart, filled && styles.filled)}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2 0 3.4 1.1 5.1 3 1.7-1.9 3.1-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </svg>
  );
}

export function FavoriteButton({
  listingId,
  title,
  saved: initialSaved,
  mode,
  returnTo,
  size,
  onChange,
  initialProblem,
}: FavoriteButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(initialProblem ?? null);
  const [status, setStatus] = useState("");
  const name = stripBidiControls(title);

  if (mode === "none") return null;

  if (mode === "guest") {
    const href = `${routes.login}?${new URLSearchParams({ next: returnTo }).toString()}`;
    return (
      <div className={cx(styles.favorite, styles[size])}>
        <a
          className={buttonClassName("secondary")}
          href={href}
          aria-label={t("favorites.button.guestName", { title: name })}
        >
          <Heart filled={false} />
          {size === "card" ? t("favorites.button.save") : t("favorites.button.guestLong")}
        </a>
      </div>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setProblem(null);
    setStatus("");
    const next = !saved;
    const result = await api.request(routes.api.favorite(listingId), {
      method: next ? "PUT" : "DELETE",
    });
    setPending(false);
    if (!result.ok) {
      setProblem(
        result.code === "NOT_FOUND"
          ? { kind: "unavailable" }
          : result.code === "LIMIT_REACHED"
            ? { kind: "limit" }
            : result.code === "RATE_LIMITED" && result.retryAfter !== null
              ? { kind: "rate", wait: result.retryAfter }
              : { kind: "failed" },
      );
      return;
    }
    setSaved(next);
    setStatus(next ? t("favorites.button.added") : t("favorites.button.removed"));
    onChange?.(next);
  }

  const label =
    size === "card"
      ? saved
        ? t("favorites.button.saved")
        : t("favorites.button.save")
      : saved
        ? t("favorites.button.savedLong")
        : t("favorites.button.saveLong");

  return (
    <div className={cx(styles.favorite, styles[size])}>
      <form method="post" onSubmit={(event) => void submit(event)}>
        <SubmitButton
          variant="secondary"
          loading={pending}
          loadingLabel={t("favorites.button.pending")}
          aria-label={
            saved
              ? t("favorites.button.savedName", { title: name })
              : t("favorites.button.saveName", { title: name })
          }
          data-saved={saved ? "true" : "false"}
        >
          <Heart filled={saved} />
          {label}
        </SubmitButton>
      </form>
      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problemText(problem)}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {status}
      </p>
    </div>
  );
}
