"use client";
// The market's cards (task 4.3, FR06 to FR12, DEC84, RL04):
//  - With a query, the "exact" cards first, then «نتائج قريبة من بحثك» before the first "close"
//    one (DEC84).
//  - «أظهر المزيد» is a link to the next page (?cursor=), so it works without JavaScript. Once
//    React runs, it fetches the next page from API031 and adds the cards instead. A failure or a
//    429 keeps every card already shown, with the message and the wait under them (RL04: never
//    break content already rendered).
//  - Focus moves to the first new card, and a polite status line says more were added.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { formatWait, t } from "@souq/i18n";
import { api } from "../../lib/client/api";
import { useHydrated } from "../../lib/client/use-hydrated";
import type { ListingCard as Card } from "../../lib/listings/public";
import { routes } from "../../lib/routes";
import { Alert } from "../ui/Alert";
import { buttonClassName } from "../ui/Button";
import { ListingCard, type CardFavorite } from "./ListingCard";
import styles from "./listings.module.css";

interface MarketResultsProps {
  initialCards: Card[];
  initialCursor: string | null;
  /** The page's filters as a URL query, without the cursor. */
  query: string;
  /** The server's time of the page, as ISO text. */
  now: string;
  /** Task 4.5: the favorite control of every card. */
  favorite: CardFavorite;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "limited"; retryAfter: number };

function withCursor(base: string, query: string, cursor: string): string {
  const params = new URLSearchParams(query);
  params.set("cursor", cursor);
  return `${base}?${params.toString()}`;
}

function CardList({
  cards,
  first,
  now,
  favorite,
}: {
  cards: Card[];
  first: number;
  now: Date;
  favorite: CardFavorite;
}) {
  return (
    <ul className={styles.grid}>
      {cards.map((card, index) => (
        <li key={card.id} data-index={first + index} tabIndex={-1} className={styles.item}>
          <ListingCard card={card} now={now} eager={first + index < 4} favorite={favorite} />
        </li>
      ))}
    </ul>
  );
}

export function MarketResults({
  initialCards,
  initialCursor,
  query,
  now,
  favorite,
}: MarketResultsProps) {
  const [cards, setCards] = useState(initialCards);
  const [cursor, setCursor] = useState(initialCursor);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const time = new Date(now);
  // Before React runs, «أظهر المزيد» is a plain link to the next page; data-hydrated tells the
  // E2E tests when a click fetches instead.
  const hydrated = useHydrated();

  useEffect(() => {
    if (focusIndex === null) return;
    container.current?.querySelector<HTMLElement>(`[data-index="${String(focusIndex)}"]`)?.focus();
  }, [focusIndex]);

  async function loadMore(event: MouseEvent<HTMLAnchorElement>) {
    if (cursor === null) return;
    event.preventDefault();
    if (state.kind === "loading") return;
    setState({ kind: "loading" });
    const result = await api.request<Card[]>(withCursor(routes.api.listings, query, cursor), {
      method: "GET",
    });
    if (!result.ok) {
      setState(
        result.code === "RATE_LIMITED" && result.retryAfter !== null
          ? { kind: "limited", retryAfter: result.retryAfter }
          : { kind: "failed" },
      );
      return;
    }
    const next = result.meta?.next_cursor;
    setFocusIndex(cards.length);
    setCards([...cards, ...result.data]);
    setCursor(typeof next === "string" ? next : null);
    setState({ kind: "idle" });
  }

  const firstClose = cards.findIndex((card) => card.match === "close");
  const exact = firstClose === -1 ? cards : cards.slice(0, firstClose);
  const close = firstClose === -1 ? [] : cards.slice(firstClose);

  return (
    <div ref={container} className={styles.results} data-hydrated={hydrated ? "true" : undefined}>
      {exact.length > 0 && <CardList cards={exact} first={0} now={time} favorite={favorite} />}
      {close.length > 0 && (
        <section aria-labelledby="close-results" className={styles.close}>
          <h2 id="close-results">{t("market.market.closeTitle")}</h2>
          <p className={styles.closeHint}>{t("market.market.closeHint")}</p>
          <CardList cards={close} first={exact.length} now={time} favorite={favorite} />
        </section>
      )}
      <div className={styles.more}>
        {state.kind === "failed" && (
          <Alert variant="danger" title={t("market.market.loadMoreFailed")} live>
            <p>{t("market.market.errorBody")}</p>
          </Alert>
        )}
        {state.kind === "limited" && (
          <Alert variant="warning" title={t("market.market.rateLimitedTitle")} live>
            <p>{t("market.market.rateLimitedBody", { wait: formatWait(state.retryAfter) })}</p>
          </Alert>
        )}
        {cursor !== null ? (
          <a
            className={buttonClassName("secondary")}
            href={withCursor(routes.market, query, cursor)}
            onClick={(event) => void loadMore(event)}
            aria-disabled={state.kind === "loading" ? true : undefined}
          >
            {state.kind === "loading"
              ? t("ui.loading")
              : state.kind === "idle"
                ? t("market.market.loadMore")
                : t("market.market.retry")}
          </a>
        ) : (
          cards.length > 0 && <p className={styles.end}>{t("market.market.end")}</p>
        )}
        <p className="visually-hidden" role="status">
          {focusIndex === null ? "" : t("market.market.added")}
        </p>
      </div>
    </div>
  );
}
