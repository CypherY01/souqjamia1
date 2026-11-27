"use client";

// Task 4.4, «إعلاناتي» (plan/screens.md, FR23, FR24, BR27, DEC09, item 4, items 7 and 8): one tab
// of the seller's listings with what each one allows now (allowedListingActions, @souq/domain).
//  - Hidden by moderation: the label in text and no action at all (owner rule on item 4).
//  - Archived: until when it can be restored, or why it cannot.
//  - «تحديد كمباع» and «أرشفة» ask first in a Dialog (sold is final); «استرجاع» does not.
//  - A done action takes the listing out of the tab and says where it went. A refusal stays
//    under its listing: STATE_CONFLICT with a refresh link, DEADLINE_PASSED, LIMIT_REACHED,
//    FORBIDDEN, NOT_FOUND.
//  - «أظهر المزيد» is a link to the next page (works without JavaScript); with React it fetches
//    API033 and adds the cards, keeping them on a failure.
import { allowedListingActions, canEditListing, type ListingAction } from "@souq/domain";
import { formatDate, t } from "@souq/i18n";
import { useEffect, useRef, useState, type MouseEvent, type SubmitEvent } from "react";
import { api, type ApiFailure } from "../../lib/client/api";
import { useHydrated } from "../../lib/client/use-hydrated";
import type { OwnerListing } from "../../lib/listings/owner";
import { routes } from "../../lib/routes";
import { SafeText } from "../text/SafeText";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Button, buttonClassName, LinkButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DateText, Price } from "../ui/Display";
import { SubmitButton } from "../ui/SubmitButton";
import { ImagesPending } from "./ImagesPending";
import styles from "./my-listings.module.css";

interface MyListingsProps {
  tab: OwnerListing["status"];
  initialItems: OwnerListing[];
  initialCursor: string | null;
  /** The server's time of the page, as ISO text. */
  now: string;
}

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "failed" };

interface Done {
  action: ListingAction;
  tab: OwnerListing["status"];
}

function tabHref(tab: string, cursor?: string): string {
  const params = new URLSearchParams({ status: tab });
  if (cursor !== undefined) params.set("cursor", cursor);
  return `${routes.account.listings}?${params.toString()}`;
}

function refusalText(failure: ApiFailure): string {
  switch (failure.code) {
    case "STATE_CONFLICT":
      return t("myListings.failure.conflict");
    case "DEADLINE_PASSED":
      return t("myListings.failure.deadline");
    case "LIMIT_REACHED":
      return t("myListings.failure.limit");
    case "FORBIDDEN":
      return t("myListings.failure.forbidden");
    case "NOT_FOUND":
      return t("myListings.failure.notFound");
    default:
      return t("myListings.failure.failed");
  }
}

function ArchiveNote({ item, now }: { item: OwnerListing; now: number }) {
  if (item.restorable_until !== null) {
    return Date.parse(item.restorable_until) > now ? (
      <p className={styles.note}>
        {t("myListings.card.restoreUntil", { date: formatDate(item.restorable_until) })}
      </p>
    ) : (
      <p className={styles.note}>{t("myListings.card.restoreExpired")}</p>
    );
  }
  return (
    <p className={styles.note}>
      {item.previous_status === "sold"
        ? t("myListings.card.archivedSold")
        : t("myListings.card.archivedOther")}
    </p>
  );
}

function when(item: OwnerListing): { label: string; value: string } {
  if (item.status === "sold" && item.sold_at !== null) {
    return { label: t("myListings.card.soldOn"), value: item.sold_at };
  }
  if (item.status === "archived" && item.archived_at !== null) {
    return { label: t("myListings.card.archivedOn"), value: item.archived_at };
  }
  return { label: t("myListings.card.published"), value: item.created_at };
}

interface ItemProps {
  item: OwnerListing;
  now: number;
  busy: boolean;
  failure: ApiFailure | null;
  onAction: (item: OwnerListing, action: ListingAction) => void;
  index: number;
}

function Item({ item, now, busy, failure, onAction, index }: ItemProps) {
  const actions = allowedListingActions(item, now);
  const editable = canEditListing(item);
  const time = when(item);
  const image = item.primary_image;
  const publicPage = !item.moderation_hidden && item.status !== "archived";
  const title = item.title;
  return (
    <li className={styles.item} data-index={index} tabIndex={-1}>
      <article className={styles.card}>
        <div className={styles.media}>
          {image === null ? (
            <ImagesPending compact />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.image}
              src={image.w150}
              width={150}
              height={113}
              alt={""}
              loading={index < 4 ? "eager" : "lazy"}
              decoding="async"
            />
          )}
        </div>
        <div className={styles.body}>
          <h2 className={styles.title}>
            <SafeText text={title} newTabLabel={t("ui.newTab")} links={false} />
          </h2>
          <p className={styles.price}>
            <Price halalas={item.price_minor} />
          </p>
          <p className={styles.meta}>
            {time.label} <DateText value={time.value} />
          </p>
          {item.moderation_hidden && (
            <div className={styles.hidden}>
              <Badge variant="neutral">{t("myListings.card.hidden")}</Badge>
              <p className={styles.note}>{t("myListings.card.hiddenBody")}</p>
            </div>
          )}
          {item.status === "archived" && !item.moderation_hidden && (
            <ArchiveNote item={item} now={now} />
          )}
          <div
            className={styles.actions}
            role="group"
            aria-label={t("myListings.card.actionsLabel", { title })}
          >
            {publicPage && (
              <LinkButton
                href={routes.listing(item.id)}
                variant="ghost"
                aria-label={t("myListings.actions.viewOf", { title })}
              >
                {t("myListings.actions.view")}
              </LinkButton>
            )}
            {editable && (
              <LinkButton
                href={routes.account.listingEdit(item.id)}
                variant="secondary"
                aria-label={t("myListings.actions.editOf", { title })}
              >
                {t("myListings.actions.edit")}
              </LinkButton>
            )}
            {actions.includes("mark_sold") && (
              <Dialog
                triggerLabel={t("myListings.actions.markSold")}
                title={t("myListings.confirm.markSoldTitle")}
                closeLabel={t("myListings.actions.cancel")}
                actions={
                  <Button
                    loading={busy}
                    onClick={(event) => {
                      // Closes the Dialog (its form is method="dialog"), then acts.
                      event.currentTarget.closest("dialog")?.close();
                      onAction(item, "mark_sold");
                    }}
                  >
                    {t("myListings.confirm.markSoldConfirm")}
                  </Button>
                }
              >
                <p>
                  <SafeText text={title} newTabLabel={t("ui.newTab")} links={false} />
                </p>
                <p>{t("myListings.confirm.markSoldBody")}</p>
              </Dialog>
            )}
            {actions.includes("archive") && (
              <Dialog
                triggerLabel={t("myListings.actions.archive")}
                title={t("myListings.confirm.archiveTitle")}
                closeLabel={t("myListings.actions.cancel")}
                actions={
                  <Button
                    variant="danger"
                    loading={busy}
                    onClick={(event) => {
                      // Closes the Dialog (its form is method="dialog"), then acts.
                      event.currentTarget.closest("dialog")?.close();
                      onAction(item, "archive");
                    }}
                  >
                    {t("myListings.confirm.archiveConfirm")}
                  </Button>
                }
              >
                <p>
                  <SafeText text={title} newTabLabel={t("ui.newTab")} links={false} />
                </p>
                <p>
                  {item.status === "sold"
                    ? t("myListings.confirm.archiveSoldBody")
                    : t("myListings.confirm.archiveBody")}
                </p>
              </Dialog>
            )}
            {actions.includes("restore") && (
              <form
                method="post"
                className={styles.inline}
                onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  onAction(item, "restore");
                }}
              >
                <SubmitButton
                  variant="secondary"
                  loading={busy}
                  aria-label={t("myListings.actions.restoreOf", { title })}
                >
                  {t("myListings.actions.restore")}
                </SubmitButton>
              </form>
            )}
          </div>
          {failure !== null && (
            <Alert variant="danger" title={t("myListings.failure.title")} live>
              <p>{refusalText(failure)}</p>
              {failure.code === "STATE_CONFLICT" && (
                <p>
                  <a href={tabHref(item.status)}>{t("myListings.failure.refresh")}</a>
                </p>
              )}
            </Alert>
          )}
        </div>
      </article>
    </li>
  );
}

export function MyListings({ tab, initialItems, initialCursor, now }: MyListingsProps) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<ReadonlyMap<string, ApiFailure>>(new Map());
  const [done, setDone] = useState<Done | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const time = Date.parse(now);

  useEffect(() => {
    if (focusIndex === null) return;
    container.current?.querySelector<HTMLElement>(`[data-index="${String(focusIndex)}"]`)?.focus();
  }, [focusIndex]);

  async function act(item: OwnerListing, action: ListingAction): Promise<void> {
    if (busy !== null) return;
    setBusy(item.id);
    setDone(null);
    const result = await api.request<OwnerListing>(routes.api.listingTransition(item.id), {
      method: "POST",
      body: { action, expected_version: item.version },
    });
    setBusy(null);
    if (result.ok) {
      setItems((current) => current.filter((other) => other.id !== item.id));
      setFailures((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
      setDone({ action, tab: result.data.status });
      doneRef.current?.focus();
      return;
    }
    setFailures((current) => new Map(current).set(item.id, result));
  }

  async function loadMore(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
    if (cursor === null) return;
    event.preventDefault();
    if (load.kind === "loading") return;
    setLoad({ kind: "loading" });
    const params = new URLSearchParams({ status: tab, cursor });
    const result = await api.request<OwnerListing[]>(
      `${routes.api.myListings}?${params.toString()}`,
      { method: "GET" },
    );
    if (!result.ok) {
      setLoad({ kind: "failed" });
      return;
    }
    const next = result.meta?.next_cursor;
    setFocusIndex(items.length);
    setItems([...items, ...result.data]);
    setCursor(typeof next === "string" ? next : null);
    setLoad({ kind: "idle" });
  }

  return (
    <div ref={container} className={styles.results} data-hydrated={hydrated ? "true" : undefined}>
      <div ref={doneRef} tabIndex={-1}>
        {done !== null && (
          <Alert variant="success" title={t(`myListings.done.${done.action}`)} live>
            <p>
              <a href={tabHref(done.tab)}>{t("myListings.done.open")}</a>
            </p>
          </Alert>
        )}
      </div>
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item, index) => (
            <Item
              key={item.id}
              item={item}
              now={time}
              busy={busy === item.id}
              failure={failures.get(item.id) ?? null}
              onAction={(target, action) => {
                void act(target, action);
              }}
              index={index}
            />
          ))}
        </ul>
      )}
      <div className={styles.more}>
        {load.kind === "failed" && (
          <Alert variant="danger" title={t("myListings.states.loadMoreFailed")} live>
            <p>{t("myListings.states.errorBody")}</p>
          </Alert>
        )}
        {cursor !== null ? (
          <a
            className={buttonClassName("secondary")}
            href={tabHref(tab, cursor)}
            onClick={(event) => void loadMore(event)}
            aria-disabled={load.kind === "loading" ? true : undefined}
          >
            {load.kind === "loading"
              ? t("ui.loading")
              : load.kind === "failed"
                ? t("myListings.states.retry")
                : t("myListings.states.loadMore")}
          </a>
        ) : (
          items.length > 0 && <p className={styles.end}>{t("myListings.states.end")}</p>
        )}
        <p className="visually-hidden" role="status">
          {focusIndex === null ? "" : t("myListings.states.added")}
        </p>
      </div>
    </div>
  );
}
