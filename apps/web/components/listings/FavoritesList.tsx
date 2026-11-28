"use client";
// /account/favorites «المفضلة» (task 4.5, FR15, UC05, API048, API050, items 1 and 8):
//  - An available favorite is its card, with the favorite control: removing it there takes the
//    card off the list after the server's 204.
//  - «غير متاح» shows nothing of the listing (UC05): a fixed title, the time it was saved and
//    «إزالة», confirmed first because it cannot be saved again while unavailable (item 8).
//  - «أظهر المزيد» is a link to the next page (?cursor=), so it works without JavaScript; once
//    React runs it fetches API048 and adds the items, as in the market.
//  - After a removal, focus goes to the list's heading and a polite status line says it.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { t } from "@souq/i18n";
import { api } from "../../lib/client/api";
import { useHydrated } from "../../lib/client/use-hydrated";
import type { FavoriteItem } from "../../lib/favorites/favorites";
import { routes } from "../../lib/routes";
import { Alert } from "../ui/Alert";
import { Button, buttonClassName, LinkButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DateText } from "../ui/Display";
import { EmptyState } from "../ui/States";
import { ListingCard } from "./ListingCard";
import styles from "./listings.module.css";
import own from "./favorite.module.css";

interface FavoritesListProps {
  initialItems: FavoriteItem[];
  initialCursor: string | null;
  /** The server's time of the page, as ISO text. */
  now: string;
  /** The page's own path, where a guest's login would come back to. */
  here: string;
}

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "failed" };

function Unavailable({
  item,
  busy,
  onRemove,
}: {
  item: FavoriteItem;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <article className={own.unavailable}>
      <h3>{t("favorites.page.unavailableTitle")}</h3>
      <p>{t("favorites.page.unavailableBody")}</p>
      <p className={own.muted}>
        {t("favorites.page.savedOn")} <DateText value={item.saved_at} />
      </p>
      <div className={own.actions}>
        <Dialog
          triggerLabel={t("favorites.page.remove")}
          title={t("favorites.page.removeTitle")}
          closeLabel={t("favorites.page.cancel")}
          actions={
            <Button
              variant="danger"
              loading={busy}
              onClick={(event) => {
                // Closes the Dialog (its form is method="dialog"), then acts.
                event.currentTarget.closest("dialog")?.close();
                onRemove();
              }}
            >
              {t("favorites.page.removeConfirm")}
            </Button>
          }
        >
          <p>{t("favorites.page.removeBody")}</p>
        </Dialog>
      </div>
    </article>
  );
}

export function FavoritesList({ initialItems, initialCursor, now, here }: FavoritesListProps) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [focus, setFocus] = useState<"heading" | number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hydrated = useHydrated();
  const time = new Date(now);

  useEffect(() => {
    if (focus === "heading") heading.current?.focus();
    else if (focus !== null) {
      list.current?.querySelector<HTMLElement>(`[data-index="${String(focus)}"]`)?.focus();
    }
  }, [focus]);

  function removed(listingId: string) {
    setItems((current) => current.filter((item) => item.listing_id !== listingId));
    setStatus(t("favorites.page.removed"));
    setFocus("heading");
  }

  async function removeUnavailable(listingId: string) {
    setBusy(listingId);
    setFailed(false);
    const result = await api.request(routes.api.favorite(listingId), { method: "DELETE" });
    setBusy(null);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    removed(listingId);
  }

  async function loadMore(event: MouseEvent<HTMLAnchorElement>) {
    if (cursor === null) return;
    event.preventDefault();
    if (load.kind === "loading") return;
    setLoad({ kind: "loading" });
    const params = new URLSearchParams({ cursor });
    const result = await api.request<FavoriteItem[]>(
      `${routes.api.myFavorites}?${params.toString()}`,
      { method: "GET" },
    );
    if (!result.ok) {
      setLoad({ kind: "failed" });
      return;
    }
    const next = result.meta?.next_cursor;
    setFocus(items.length);
    setItems([...items, ...result.data]);
    setCursor(typeof next === "string" ? next : null);
    setLoad({ kind: "idle" });
  }

  return (
    <div className={styles.results} data-hydrated={hydrated ? "true" : undefined}>
      <h2 ref={heading} tabIndex={-1}>
        {t("favorites.page.listTitle")}
      </h2>
      {failed && (
        <Alert variant="danger" title={t("favorites.button.failed")} live>
          <p>{t("favorites.page.errorBody")}</p>
        </Alert>
      )}
      {items.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t("favorites.page.emptyTitle")}
          body={t("favorites.page.emptyBody")}
          action={<LinkButton href={routes.market}>{t("favorites.page.browse")}</LinkButton>}
        />
      ) : (
        <ul ref={list} className={styles.grid}>
          {items.map((item, index) => (
            <li key={item.listing_id} data-index={index} tabIndex={-1} className={styles.item}>
              {item.available ? (
                <ListingCard
                  card={item.listing}
                  now={time}
                  eager={index < 4}
                  favorite={{
                    mode: "member",
                    returnTo: here,
                    onChange: (saved) => {
                      if (!saved) removed(item.listing_id);
                    },
                  }}
                />
              ) : (
                <Unavailable
                  item={item}
                  busy={busy === item.listing_id}
                  onRemove={() => void removeUnavailable(item.listing_id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.more}>
        {load.kind === "failed" && (
          <Alert variant="danger" title={t("favorites.page.loadMoreFailed")} live>
            <p>{t("favorites.page.errorBody")}</p>
          </Alert>
        )}
        {cursor !== null ? (
          <a
            className={buttonClassName("secondary")}
            href={`${routes.account.favorites}?${new URLSearchParams({ cursor }).toString()}`}
            onClick={(event) => void loadMore(event)}
            aria-disabled={load.kind === "loading" ? true : undefined}
          >
            {load.kind === "loading"
              ? t("ui.loading")
              : load.kind === "failed"
                ? t("favorites.page.retry")
                : t("favorites.page.loadMore")}
          </a>
        ) : (
          items.length > 0 && <p className={styles.end}>{t("favorites.page.end")}</p>
        )}
        <p className="visually-hidden" role="status">
          {status !== "" ? status : typeof focus === "number" ? t("favorites.page.added") : ""}
        </p>
      </div>
    </div>
  );
}
