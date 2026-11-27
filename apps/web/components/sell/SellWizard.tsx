"use client";

// Task 4.2: the publication wizard (/sell). FR16 to FR22, FR60, BR04 to BR08, DEC07, DEC28,
// section 6.3, TC07, TC08, TC09, TC33, TC82.
//  - Five steps in order: images, details, price, meeting place, review. "Next" checks the step
//    with the server's rules (@souq/domain); "Back" keeps everything. The step is in the URL
//    (?step=), so the browser's back button goes to the previous step.
//  - The tab's draft (lib/client/sell-draft.ts): text, choices and upload ids, saved on every
//    change unless the member marked the tab as a shared device. Restored images are asked again
//    (API039); expired ones are picked again, and the text stays (TC33).
//  - Publication (API034) with one Idempotency-Key per draft until it succeeds (FR22, TC09): a
//    retry after a lost answer returns the same listing. A field error goes back to its step
//    (section 6.3); MEDIA_INVALID and MEDIA_NOT_READY mark the image.
// One form with method="post" and a SubmitButton (task 4.0): nothing works before hydration.
import { enums, firstStepOf, LISTING_ACTIVE_MAX, SELL_STEPS, type SellStep } from "@souq/domain";
import { formatNumber, formatWait, t } from "@souq/i18n";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { api, type ApiFailure } from "../../lib/client/api";
import {
  browserStore,
  loadDraft,
  removeDraft,
  saveDraft,
  setSharedDevice,
  sharedDevice,
  type DraftStore,
  type SellDraftFields,
  type SellDraftPublish,
} from "../../lib/client/sell-draft";
import { useHydrated } from "../../lib/client/use-hydrated";
import { routes } from "../../lib/routes";
import { FailureAlert } from "../auth/messages";
import { SafeText } from "../text/SafeText";
import { Alert } from "../ui/Alert";
import { Button, LinkButton } from "../ui/Button";
import { Checkbox } from "../ui/Field";
import { Price } from "../ui/Display";
import { Stepper } from "../ui/Stepper";
import { SubmitButton } from "../ui/SubmitButton";
import { ListingImages } from "./ListingImages";
import { DetailsStep, PlaceStep, PriceStep, ReviewStep, stepTitle } from "./Steps";
import { useListingImages, type RestoredImage, type ServerProblem } from "./useListingImages";
import {
  AGREEMENT,
  buildPayload,
  controlIdOf,
  EMPTY_FIELDS,
  fieldErrorText,
  isSellField,
  stepErrors,
  type ListingPayload,
  type SellCatalog,
  type SellErrors,
  type SellField,
} from "./wizard";
import styles from "./sell.module.css";

interface SellWizardProps {
  /** The session's member: the draft belongs to them only (TC82). */
  owner: string;
  catalog: SellCatalog;
}

interface Published {
  /** Task 4.3: the listing page that the result links to. */
  id: string;
  title: string;
  priceMinor: number;
}

interface ListingData {
  id: string;
  title: string;
  price_minor: number;
}

type Notice = "restored" | "interrupted" | null;

const HEADING_ID = "sell-step-heading";

function stepFromUrl(): SellStep {
  const value = Number(new URLSearchParams(window.location.search).get("step") ?? "1");
  return (SELL_STEPS as readonly number[]).includes(value) ? (value as SellStep) : 1;
}

function urlOf(step: SellStep): string {
  return step === 1 ? routes.sell : `${routes.sell}?step=${String(step)}`;
}

/** Answers that never said what happened: the same key and payload are sent again. */
function outcomeUnknown(failure: ApiFailure): boolean {
  return (
    failure.code === "NETWORK" ||
    failure.code === "INTERNAL_ERROR" ||
    failure.code === "SERVICE_UNAVAILABLE"
  );
}

/**
 * The wizard needs the tab's storage, which only the browser has. Until React hydrates, a form
 * whose button waits («جارٍ التحميل», task 4.0); then the wizard with the restored draft.
 */
export function SellWizard({ owner, catalog }: SellWizardProps) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <form className={styles.wizard} method="post" noValidate>
        <Stepper
          label={t("sell.stepper.label")}
          steps={SELL_STEPS.map((item) => stepTitle(item))}
          current={1}
        />
        <div className={styles.nav}>
          <SubmitButton>{t("sell.nav.next")}</SubmitButton>
        </div>
      </form>
    );
  }
  return <Wizard owner={owner} catalog={catalog} />;
}

interface Start {
  store: DraftStore | null;
  shared: boolean;
  fields: SellDraftFields;
  step: SellStep;
  images: RestoredImage[];
  publish: SellDraftPublish | null;
  notice: Notice;
}

/** FR60: the draft of this tab, read once when the wizard mounts (in the browser only). */
function startOf(owner: string): Start {
  const store = browserStore();
  const shared = sharedDevice(store);
  const draft = shared ? null : loadDraft(store, owner);
  if (draft === null) {
    return {
      store,
      shared,
      fields: EMPTY_FIELDS,
      step: 1,
      images: [],
      publish: null,
      notice: null,
    };
  }
  const images = draft.images.flatMap((image) =>
    image.mediaId === null ? [] : [{ mediaId: image.mediaId, fileName: image.fileName }],
  );
  return {
    store,
    shared,
    fields: draft.fields,
    step: draft.step,
    images,
    publish: draft.publish,
    notice: images.length < draft.images.length ? "interrupted" : "restored",
  };
}

function Wizard({ owner, catalog }: SellWizardProps) {
  const [start] = useState(() => startOf(owner));
  const images = useListingImages(start.images);
  const [step, setStep] = useState<SellStep>(start.step);
  const [fields, setFields] = useState<SellDraftFields>(start.fields);
  const [errors, setErrors] = useState<SellErrors>({});
  const [publish, setPublish] = useState<SellDraftPublish | null>(start.publish);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [published, setPublished] = useState<{
    listing: Published | null;
    earlier: boolean;
  } | null>(null);
  const [shared, setShared] = useState(start.shared);
  const [notice, setNotice] = useState<Notice>(start.notice);
  const store = start.store;
  const storageMissing = store === null;
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = useRef<string | null>(null);
  const refreshPreviews = images.refreshPreviews;

  // The URL says the restored step, so the browser's back button starts from it.
  useEffect(() => {
    window.history.replaceState(null, "", urlOf(start.step));
  }, [start.step]);

  // FR60: saved on every change, unless this tab is a shared device (item 3).
  useEffect(() => {
    if (shared || published !== null) return;
    saveDraft(store, {
      v: 1,
      owner,
      step,
      fields,
      images: images.items.map((item) => ({
        mediaId: item.state.uploadId,
        fileName: item.fileName,
      })),
      publish,
    });
  }, [store, shared, published, owner, step, fields, images.items, publish]);

  // The browser's back and forward buttons move between the steps.
  useEffect(() => {
    function onPop(): void {
      setErrors({});
      setFailure(null);
      setStep(stepFromUrl());
      focusTarget.current = HEADING_ID;
    }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // The focus follows the step, or goes to the first wrong field.
  useEffect(() => {
    const target = focusTarget.current;
    if (target === null) return;
    focusTarget.current = null;
    if (target === HEADING_ID) heading.current?.focus();
    else document.getElementById(target)?.focus();
  });

  // Private previews live 60 seconds: new links when the images are shown again.
  useEffect(() => {
    if (step === 1 || step === 5) refreshPreviews();
  }, [step, refreshPreviews]);

  const change = useCallback((next: Partial<SellDraftFields>) => {
    setFields((current) => ({ ...current, ...next }));
  }, []);

  const firstCondition = enums.Condition[0];

  function focusField(field: SellField): void {
    focusTarget.current = controlIdOf(field, firstCondition, AGREEMENT);
  }

  function goTo(next: SellStep): void {
    setErrors({});
    setFailure(null);
    setStep(next);
    window.history.pushState(null, "", urlOf(next));
    focusTarget.current = HEADING_ID;
  }

  function showErrors(next: SellErrors): void {
    setErrors(next);
    const first = (Object.keys(next) as SellField[])[0];
    if (first !== undefined) focusField(first);
  }

  function summaries() {
    return images.items.map((item) => ({ phase: item.state.phase, uploadId: item.state.uploadId }));
  }

  async function send(payload: unknown, key: string) {
    return api.request<ListingData>(routes.api.listings, { body: payload, idempotencyKey: key });
  }

  async function submitListing(): Promise<void> {
    // Every step again: one may have been reached through the browser's history.
    for (const candidate of [1, 2, 3, 4] as const) {
      const found = stepErrors(candidate, fields, summaries(), catalog);
      if (Object.keys(found).length > 0) {
        goTo(candidate);
        showErrors(found);
        return;
      }
    }
    const payload: ListingPayload | null = buildPayload(fields, summaries());
    if (payload === null) return;
    const key = publish?.key ?? crypto.randomUUID();
    setSubmitting(true);
    setFailure(null);
    let result = await send(payload, key);
    let earlier = false;
    if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
      // FR22: this key already published a listing whose answer never arrived, before the text
      // changed. Its own payload, sent again with the key, returns that listing.
      earlier = true;
      if (publish?.unconfirmed != null) result = await send(publish.unconfirmed, key);
    }
    setSubmitting(false);

    if (result.ok || earlier) {
      removeDraft(store);
      setPublished({
        listing: result.ok
          ? { id: result.data.id, title: result.data.title, priceMinor: result.data.price_minor }
          : null,
        earlier,
      });
      window.history.replaceState(null, "", routes.sell);
      focusTarget.current = HEADING_ID;
      return;
    }

    setPublish({ key, unconfirmed: outcomeUnknown(result) ? payload : null });
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
        goTo(firstStepOf(result.fieldErrors.map((item) => item.field)));
        showErrors(next);
        return;
      }
    }
    setFailure(result);
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;
    if (step === 5) {
      void submitListing();
      return;
    }
    const found = stepErrors(step, fields, summaries(), catalog);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    goTo((step + 1) as SellStep);
  }

  function startAgain(): void {
    images.reset();
    setFields(EMPTY_FIELDS);
    setPublish(null);
    setPublished(null);
    setNotice(null);
    setErrors({});
    setFailure(null);
    setStep(1);
    window.history.replaceState(null, "", routes.sell);
    focusTarget.current = HEADING_ID;
  }

  if (published !== null) {
    return (
      <section className={styles.result} aria-labelledby={HEADING_ID}>
        <h2 id={HEADING_ID} ref={heading} tabIndex={-1}>
          {t("sell.result.title")}
        </h2>
        <Alert variant="success" title={t("sell.result.title")} live>
          {published.listing !== null && (
            <>
              <p className={styles.reviewTitle}>
                <SafeText text={published.listing.title} newTabLabel={t("ui.newTab")} />
              </p>
              <p>
                <Price halalas={published.listing.priceMinor} />
              </p>
            </>
          )}
          <p>{published.earlier ? t("sell.result.earlier") : t("sell.result.body")}</p>
        </Alert>
        <div className={styles.nav}>
          {published.listing !== null && (
            <LinkButton href={routes.listing(published.listing.id)}>
              {t("sell.result.view")}
            </LinkButton>
          )}
          <Button
            onClick={startAgain}
            variant={published.listing === null ? "primary" : "secondary"}
          >
            {t("sell.result.another")}
          </Button>
          <LinkButton href={routes.account.listings} variant="secondary">
            {t("sell.result.myListings")}
          </LinkButton>
          <LinkButton href={routes.home} variant="secondary">
            {t("sell.result.home")}
          </LinkButton>
        </div>
      </section>
    );
  }

  const failureBox =
    failure === null ? null : failure.code === "LIMIT_REACHED" ? (
      <Alert variant="danger" title={t("sell.failure.title")} live>
        <p>{t("sell.failure.limit", { max: formatNumber(LISTING_ACTIVE_MAX) })}</p>
      </Alert>
    ) : failure.code === "RATE_LIMITED" && failure.retryAfter !== null ? (
      <Alert variant="danger" title={t("sell.failure.title")} live>
        <p>{t("sell.failure.rate", { wait: formatWait(failure.retryAfter) })}</p>
      </Alert>
    ) : failure.code === "NETWORK" ? (
      <Alert variant="danger" title={t("sell.failure.title")} live>
        <p>{t("sell.failure.network")}</p>
      </Alert>
    ) : (
      <FailureAlert title={t("sell.failure.title")} failure={failure} />
    );

  return (
    <form
      className={styles.wizard}
      method="post"
      noValidate
      onSubmit={(event) => {
        onSubmit(event);
      }}
    >
      <div className={styles.draft}>
        <Checkbox
          id="sell-shared"
          label={t("sell.draft.shared")}
          checked={shared}
          extra={t("sell.draft.sharedHint")}
          onChange={(event) => {
            const next = event.target.checked;
            setShared(next);
            setSharedDevice(store, next);
          }}
        />
        {storageMissing && <Alert variant="info" title={t("sell.draft.unavailable")} />}
        {notice === "restored" && <Alert variant="info" title={t("sell.draft.restored")} />}
        {notice === "interrupted" && (
          <Alert variant="warning" title={t("sell.images.interrupted")} />
        )}
      </div>
      <Stepper
        label={t("sell.stepper.label")}
        steps={SELL_STEPS.map((item) => stepTitle(item))}
        current={step}
      />
      <section className={styles.step} aria-labelledby={HEADING_ID}>
        <h2 id={HEADING_ID} ref={heading} tabIndex={-1} className={styles.stepHeading}>
          {stepTitle(step)}
        </h2>
        {step === 1 && <ListingImages images={images} error={errors.media_ids} />}
        {step === 2 && (
          <DetailsStep fields={fields} errors={errors} onChange={change} catalog={catalog} />
        )}
        {step === 3 && <PriceStep fields={fields} errors={errors} onChange={change} />}
        {step === 4 && (
          <PlaceStep fields={fields} errors={errors} onChange={change} catalog={catalog} />
        )}
        {step === 5 && (
          <ReviewStep fields={fields} catalog={catalog} images={images.items} onEdit={goTo} />
        )}
      </section>
      {step === 5 && failureBox}
      <div className={styles.nav}>
        {step > 1 && (
          <Button
            variant="secondary"

            onClick={() => {
              goTo((step - 1) as SellStep);
            }}
          >
            {t("sell.nav.back")}
          </Button>
        )}
        <SubmitButton loading={submitting} loadingLabel={t("sell.review.publishing")}>
          {step === 5 ? t("sell.review.publish") : t("sell.nav.next")}
        </SubmitButton>
      </div>
    </form>
  );
}
