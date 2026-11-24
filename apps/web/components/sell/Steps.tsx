"use client";

// Task 4.2, steps 2 to 5 of the wizard (FR18 to FR21, BR04, BR05, BR08, DEC28). Controlled
// fields: the wizard keeps the values, so going back keeps them and the tab's draft saves them.
import {
  LISTING_DESCRIPTION_MAX,
  LISTING_TITLE_MAX,
  LISTING_TITLE_MIN,
  LISTING_DESCRIPTION_MIN,
  enums,
  normalizeText,
  type SellStep,
} from "@souq/domain";
import { formatNumber, t, type MessageKey } from "@souq/i18n";
import { useState } from "react";
import type { SellDraftFields } from "../../lib/client/sell-draft";
import { SafeText } from "../text/SafeText";
import { Alert, SafeMeetupNotice } from "../ui/Alert";
import { ChoiceCards } from "../ui/ChoiceCards";
import { Price } from "../ui/Display";
import { AmountField, Checkbox, Select, TextField } from "../ui/Field";
import { TextArea } from "../ui/TextArea";
import type { ImageItem } from "./useListingImages";
import { AGREEMENT, conditionOptions, priceOf, type SellCatalog, type SellErrors } from "./wizard";
import styles from "./sell.module.css";

type Change = (change: Partial<SellDraftFields>) => void;

interface StepProps {
  fields: SellDraftFields;
  errors: SellErrors;
  onChange: Change;
}

export function DetailsStep({
  fields,
  errors,
  onChange,
  catalog,
}: StepProps & { catalog: SellCatalog }) {
  return (
    <>
      <TextField
        id="sell-title"
        label={t("sell.details.title")}
        hint={t("sell.details.titleHint", {
          min: formatNumber(LISTING_TITLE_MIN),
          max: formatNumber(LISTING_TITLE_MAX),
        })}
        error={errors.title}
        value={fields.title}
        maxChars={LISTING_TITLE_MAX}
        autoComplete="off"
        onChange={(event) => {
          onChange({ title: event.target.value });
        }}
      />
      <Select
        id="sell-category"
        label={t("sell.details.category")}
        error={errors.category_id}
        placeholder={t("sell.details.categoryPlaceholder")}
        options={catalog.categories.map((category) => ({
          value: category.id,
          label: category.label,
        }))}
        value={fields.categoryId}
        onChange={(event) => {
          onChange({ categoryId: event.target.value });
        }}
      />
      <ChoiceCards
        name="sell-condition"
        legend={t("sell.details.condition")}
        options={conditionOptions()}
        value={fields.condition}
        error={errors.condition}
        onChange={(condition) => {
          onChange({ condition });
        }}
      />
      <TextArea
        id="sell-description"
        label={t("sell.details.description")}
        hint={t("sell.details.descriptionHint", {
          min: formatNumber(LISTING_DESCRIPTION_MIN),
          max: formatNumber(LISTING_DESCRIPTION_MAX),
        })}
        maxChars={LISTING_DESCRIPTION_MAX}
        error={errors.description}
        value={fields.description}
        onChange={(event) => {
          onChange({ description: event.target.value });
        }}
      />
    </>
  );
}

export function PriceStep({ fields, errors, onChange }: StepProps) {
  const halalas = priceOf(fields);
  const free = halalas === 0;
  return (
    <>
      <AmountField
        id="sell-price"
        label={t("sell.price.label")}
        hint={t("sell.price.hint")}
        error={errors.price_minor}
        value={fields.priceText}
        onChange={(event) => {
          const priceText = event.target.value;
          const next = priceOf({ ...fields, priceText });
          // BR08: a free item cannot be negotiable.
          onChange(next === 0 ? { priceText, negotiable: false } : { priceText });
        }}
      />
      {free && <Alert variant="info" title={t("sell.price.free")} />}
      <Checkbox
        id="sell-negotiable"
        label={t("sell.price.negotiable")}
        checked={fields.negotiable && !free}
        disabled={free}
        error={errors.is_negotiable}
        extra={free ? t("sell.price.negotiableFree") : t("sell.price.negotiableHint")}
        onChange={(event) => {
          onChange({ negotiable: event.target.checked });
        }}
      />
    </>
  );
}

function matches(label: string, query: string): boolean {
  const q = normalizeText(query).toLowerCase();
  return q === "" || label.toLowerCase().includes(q);
}

export function PlaceStep({
  fields,
  errors,
  onChange,
  catalog,
}: StepProps & { catalog: SellCatalog }) {
  const [query, setQuery] = useState("");
  const shown = catalog.points.filter(
    (point) => point.id === fields.place || matches(point.label, query),
  );
  const options = [
    {
      value: AGREEMENT,
      label: t("listing.location.byAgreement"),
      hint: t("sell.place.byAgreementHint"),
    },
    ...shown.map((point) => ({
      value: point.id,
      label: point.label,
      hint: t(`listing.location.kind.${point.kind}`),
    })),
  ];
  return (
    <>
      <SafeMeetupNotice />
      <ChoiceCards
        name="sell-place"
        legend={t("sell.place.legend")}
        hint={t("sell.place.intro")}
        options={options}
        value={fields.place}
        error={errors.location_id}
        onChange={(place) => {
          onChange({ place });
        }}
      >
        {catalog.points.length === 0 ? (
          // Owner note 1 on task 4.2: no suggested places yet (G02). «حسب الاتفاق» alone, no error.
          <p className={styles.hint}>{t("sell.place.empty")}</p>
        ) : (
          <div className={styles.search}>
            <TextField
              id="sell-place-search"
              type="search"
              label={t("sell.place.search")}
              optional
              value={query}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            {shown.length === 0 && <p className={styles.hint}>{t("sell.place.noMatch")}</p>}
          </div>
        )}
      </ChoiceCards>
    </>
  );
}

interface ReviewStepProps {
  fields: SellDraftFields;
  catalog: SellCatalog;
  images: readonly ImageItem[];
  onEdit: (step: SellStep) => void;
}

const STEP_TITLES: Readonly<Record<SellStep, MessageKey>> = {
  1: "sell.steps.images",
  2: "sell.steps.details",
  3: "sell.steps.price",
  4: "sell.steps.place",
  5: "sell.steps.review",
};

export function stepTitle(step: SellStep): string {
  return t(STEP_TITLES[step]);
}

function EditLink({ step, onEdit }: { step: SellStep; onEdit: (step: SellStep) => void }) {
  return (
    <button
      type="button"
      className={styles.editLink}
      onClick={() => {
        onEdit(step);
      }}
    >
      {t("sell.nav.edit", { step: stepTitle(step) })}
    </button>
  );
}

export function ReviewStep({ fields, catalog, images, onEdit }: ReviewStepProps) {
  const halalas = priceOf(fields) ?? 0;
  const category = catalog.categories.find((item) => item.id === fields.categoryId);
  const point = catalog.points.find((item) => item.id === fields.place);
  const condition = (enums.Condition as readonly string[]).includes(fields.condition)
    ? (fields.condition as enums.Condition)
    : null;
  return (
    <>
      <p className={styles.intro}>{t("sell.review.intro")}</p>
      <section className={styles.reviewBlock} aria-labelledby="review-images">
        <div className={styles.reviewHead}>
          <h3 id="review-images">{t("sell.review.images")}</h3>
          <EditLink step={1} onEdit={onEdit} />
        </div>
        <ol className={styles.thumbs}>
          {images.map((item, index) => (
            <li key={item.key} className={styles.thumb}>
              {item.state.previewUrl !== null ? (
                // A private link of 60 seconds (BR26), refreshed when this step opens.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.state.previewUrl}
                  alt={t("sell.images.position", { position: formatNumber(index + 1) })}
                />
              ) : (
                <span>{t("sell.images.position", { position: formatNumber(index + 1) })}</span>
              )}
              {index === 0 && <span className={styles.thumbNote}>{t("sell.images.primary")}</span>}
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.reviewBlock} aria-labelledby="review-details">
        <div className={styles.reviewHead}>
          <h3 id="review-details">{t("sell.steps.details")}</h3>
          <EditLink step={2} onEdit={onEdit} />
        </div>
        <p className={styles.reviewTitle}>
          <SafeText text={normalizeText(fields.title)} newTabLabel={t("ui.newTab")} />
        </p>
        <dl className={styles.facts}>
          <dt>{t("sell.review.category")}</dt>
          <dd>{category?.label ?? ""}</dd>
          <dt>{t("sell.review.condition")}</dt>
          <dd>{condition === null ? "" : t(`listing.condition.${condition}.label`)}</dd>
        </dl>
        <h4 className={styles.reviewSub}>{t("sell.review.description")}</h4>
        <div className={styles.description}>
          <SafeText text={fields.description} newTabLabel={t("ui.newTab")} />
        </div>
      </section>
      <section className={styles.reviewBlock} aria-labelledby="review-price">
        <div className={styles.reviewHead}>
          <h3 id="review-price">{t("sell.review.price")}</h3>
          <EditLink step={3} onEdit={onEdit} />
        </div>
        <p>
          <Price halalas={halalas} />
        </p>
        {halalas > 0 && (
          <p className={styles.hint}>
            {fields.negotiable ? t("listing.price.negotiable") : t("listing.price.fixed")}
          </p>
        )}
      </section>
      <section className={styles.reviewBlock} aria-labelledby="review-place">
        <div className={styles.reviewHead}>
          <h3 id="review-place">{t("sell.review.place")}</h3>
          <EditLink step={4} onEdit={onEdit} />
        </div>
        <p>{point === undefined ? t("listing.location.byAgreement") : point.label}</p>
      </section>
      <p className={styles.hint}>{t("sell.review.draftNote")}</p>
    </>
  );
}
