"use client";

// Task 4.4, «تعديل إعلان» (plan/screens.md, FR23, BR05 to BR08, DEC28, DEC85, item 6): one form
// with the wizard's parts (the images, details, price and place of components/sell) and one save
// button, no draft in the browser.
//  - The listing's images come in as attached: removing one takes it out of the list only, and the
//    save detaches it (API035; the server deletes it after 24 hours, RET01). New ones upload as in
//    the wizard (API037 to API039).
//  - The browser checks every part with the wizard's rules first; the server decides again. Field
//    errors go to their field and focus moves to the first one; MEDIA_INVALID and MEDIA_NOT_READY
//    mark the image.
//  - STATE_CONFLICT (the listing changed, or is no longer active), FORBIDDEN (hidden by
//    moderation), NOT_FOUND and RATE_LIMITED (DEC85) each have their message.
//  - BR41's notice (a price change cancels pending offers) comes with task 5.5 (item 2).
// One form with method="post" and a SubmitButton (task 4.0): nothing is sent before hydration.
import { enums } from "@souq/domain";
import { formatNumber, formatWait, t } from "@souq/i18n";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { api, type ApiFailure } from "../../lib/client/api";
import type { SellDraftFields } from "../../lib/client/sell-draft";
import { routes } from "../../lib/routes";
import { Alert } from "../ui/Alert";
import { LinkButton } from "../ui/Button";
import { SubmitButton } from "../ui/SubmitButton";
import { ListingImages } from "../sell/ListingImages";
import { DetailsStep, PlaceStep, PriceStep } from "../sell/Steps";
import { useListingImages, type ServerProblem } from "../sell/useListingImages";
import {
  AGREEMENT,
  buildPayload,
  controlIdOf,
  detailsErrors,
  fieldErrorText,
  imagesErrors,
  isSellField,
  placeErrors,
  priceErrors,
  priceTextOf,
  type SellCatalog,
  type SellErrors,
  type SellField,
} from "../sell/wizard";
import styles from "./my-listings.module.css";

/** What the edit page needs of the seller's OwnerListing. */
export interface EditableListing {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  condition: enums.Condition;
  priceMinor: number;
  negotiable: boolean;
  locationId: string | null;
  version: number;
  /** The current images in order, with their public w150 copy when it exists. */
  images: readonly { mediaId: string; thumbnail: string | null }[];
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "invalid" }
  | { kind: "failed"; failure: ApiFailure };

const FIELD_ORDER: readonly SellField[] = [
  "media_ids",
  "title",
  "category_id",
  "condition",
  "description",
  "price_minor",
  "is_negotiable",
  "location_id",
];

function failureText(failure: ApiFailure): string {
  switch (failure.code) {
    case "STATE_CONFLICT":
      return t("myListings.failure.conflict");
    case "FORBIDDEN":
      return t("myListings.failure.forbidden");
    case "NOT_FOUND":
      return t("myListings.failure.notFound");
    case "RATE_LIMITED":
      return t("myListings.failure.rateLimited", { wait: formatWait(failure.retryAfter ?? 60) });
    default:
      return t("myListings.failure.failed");
  }
}

export function EditListingForm({
  listing,
  catalog,
}: {
  listing: EditableListing;
  catalog: SellCatalog;
}) {
  const [fields, setFields] = useState<SellDraftFields>(() => ({
    title: listing.title,
    description: listing.description,
    categoryId: listing.categoryId,
    condition: listing.condition,
    priceText: priceTextOf(listing.priceMinor),
    negotiable: listing.negotiable,
    place: listing.locationId ?? AGREEMENT,
  }));
  const [version, setVersion] = useState(listing.version);
  const [errors, setErrors] = useState<SellErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focusId, setFocusId] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const images = useListingImages(
    [],
    listing.images.map((image, index) => ({
      mediaId: image.mediaId,
      label: `${t("myListings.edit.currentImage")} ${formatNumber(index + 1)}`,
      previewUrl: image.thumbnail,
    })),
  );

  useEffect(() => {
    if (focusId === null) return;
    document.getElementById(focusId)?.focus();
  }, [focusId]);

  function change(next: Partial<SellDraftFields>): void {
    setFields((current) => ({ ...current, ...next }));
  }

  function showErrors(next: SellErrors): void {
    setErrors(next);
    setStatus({ kind: "invalid" });
    const first = FIELD_ORDER.find((field) => next[field] !== undefined);
    if (first !== undefined) setFocusId(controlIdOf(first, enums.Condition[0], AGREEMENT));
  }

  function summaries() {
    return images.items.map((item) => ({ phase: item.state.phase, uploadId: item.state.uploadId }));
  }

  async function save(): Promise<void> {
    const found: SellErrors = {
      ...imagesErrors(summaries()),
      ...detailsErrors(fields, catalog),
      ...priceErrors(fields),
      ...placeErrors(fields, catalog),
    };
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    const payload = buildPayload(fields, summaries());
    if (payload === null) return;
    setStatus({ kind: "saving" });
    setErrors({});
    images.markServerProblems(new Map());
    const result = await api.request<{ version: number }>(routes.api.listing(listing.id), {
      method: "PATCH",
      body: { ...payload, expected_version: version },
    });
    if (result.ok) {
      setVersion(result.data.version);
      setStatus({ kind: "saved" });
      setFocusId(null);
      statusRef.current?.focus();
      return;
    }
    if (
      result.code === "VALIDATION_FAILED" ||
      result.code === "MEDIA_INVALID" ||
      result.code === "MEDIA_NOT_READY"
    ) {
      const next: SellErrors = {};
      const problems = new Map<number, ServerProblem>();
      for (const item of result.fieldErrors) {
        const [name, index] = item.field.split(".");
        if (name === "media_ids" && index !== undefined) {
          problems.set(Number(index), result.code === "MEDIA_NOT_READY" ? "notReady" : "invalid");
          next.media_ids =
            result.code === "MEDIA_NOT_READY"
              ? t("sell.images.notReady")
              : t("sell.images.invalid");
        } else if (name !== undefined && isSellField(name)) {
          next[name] = fieldErrorText(name, item.code);
        }
      }
      images.markServerProblems(problems);
      if (Object.keys(next).length > 0) {
        showErrors(next);
        return;
      }
    }
    setStatus({ kind: "failed", failure: result });
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (status.kind === "saving") return;
    void save();
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className={styles.form}>
      <section className={styles.part} aria-labelledby="edit-images">
        <h2 id="edit-images">{t("myListings.edit.images")}</h2>
        <ListingImages images={images} error={errors.media_ids} />
        <p className={styles.note}>{t("myListings.edit.imagesNote")}</p>
      </section>
      <section className={styles.part} aria-labelledby="edit-details">
        <h2 id="edit-details">{t("myListings.edit.details")}</h2>
        <DetailsStep fields={fields} errors={errors} onChange={change} catalog={catalog} />
      </section>
      <section className={styles.part} aria-labelledby="edit-price">
        <h2 id="edit-price">{t("myListings.edit.price")}</h2>
        <PriceStep fields={fields} errors={errors} onChange={change} />
      </section>
      <section className={styles.part} aria-labelledby="edit-place">
        <h2 id="edit-place">{t("myListings.edit.place")}</h2>
        <PlaceStep fields={fields} errors={errors} onChange={change} catalog={catalog} />
      </section>
      <div ref={statusRef} tabIndex={-1} className={styles.status}>
        {status.kind === "invalid" && (
          <Alert variant="danger" title={t("myListings.edit.failedTitle")} live>
            <p>{t("myListings.edit.fixErrors")}</p>
          </Alert>
        )}
        {status.kind === "saved" && (
          <Alert variant="success" title={t("myListings.edit.savedTitle")} live>
            <p>{t("myListings.edit.savedBody")}</p>
          </Alert>
        )}
        {status.kind === "failed" && (
          <Alert variant="danger" title={t("myListings.edit.failedTitle")} live>
            <p>{failureText(status.failure)}</p>
            {status.failure.code === "STATE_CONFLICT" && (
              <p>
                <a href={routes.account.listingEdit(listing.id)}>
                  {t("myListings.failure.refresh")}
                </a>
              </p>
            )}
          </Alert>
        )}
      </div>
      <div className={styles.formActions}>
        <SubmitButton loading={status.kind === "saving"} loadingLabel={t("myListings.edit.saving")}>
          {t("myListings.edit.save")}
        </SubmitButton>
        <LinkButton href={routes.listing(listing.id)} variant="secondary">
          {t("myListings.actions.view")}
        </LinkButton>
        <LinkButton href={routes.account.listings} variant="ghost">
          {t("myListings.edit.back")}
        </LinkButton>
      </div>
    </form>
  );
}
