"use client";

// Task 4.2, step 1 (FR17, BR06, DEC08, TC07, TC33): pick up to ten images, see each one's state
// (UploadStatus, task 4.1), order them with buttons that work from the keyboard, and choose the
// primary one (position 1). The file input stays disabled until React hydrates (task 4.0), and
// once ten images are chosen. A file beyond the tenth is not added, and the member is told.
import { IMAGE_MIME_TYPES, LISTING_IMAGES_MAX } from "@souq/domain";
import { formatNumber, t } from "@souq/i18n";
import { useState } from "react";
import { useHydrated } from "../../lib/client/use-hydrated";
import { UploadStatus } from "../media/UploadStatus";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { ImageItem, ListingImages as Images } from "./useListingImages";
import styles from "./sell.module.css";

export const IMAGES_INPUT_ID = "sell-images-file";

interface ListingImagesProps {
  images: Images;
  error?: string | undefined;
}

function problemText(item: ImageItem): string | null {
  if (item.serverProblem === "invalid") return t("sell.images.invalid");
  if (item.serverProblem === "notReady") return t("sell.images.notReady");
  return null;
}

export function ListingImages({ images, error }: ListingImagesProps) {
  const hydrated = useHydrated();
  const [trimmed, setTrimmed] = useState<number | null>(null);
  const count = images.items.length;
  const full = count >= LISTING_IMAGES_MAX;
  const max = formatNumber(LISTING_IMAGES_MAX);
  const hintId = `${IMAGES_INPUT_ID}-hint`;
  const errorId = `${IMAGES_INPUT_ID}-error`;
  const countId = `${IMAGES_INPUT_ID}-count`;

  return (
    <div className={styles.images}>
      <p className={styles.intro}>{t("sell.images.intro", { max })}</p>
      <div className={styles.picker}>
        <label className={styles.pickerLabel} htmlFor={IMAGES_INPUT_ID}>
          {t("media.picker.label")}
        </label>
        <p id={hintId} className={styles.hint}>
          {hydrated ? t("media.picker.hint") : t("ui.loading")}
        </p>
        <input
          id={IMAGES_INPUT_ID}
          className={styles.fileInput}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          multiple
          disabled={!hydrated || full}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={[hintId, countId, error === undefined ? "" : errorId]
            .filter(Boolean)
            .join(" ")}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            const accepted = images.add(files);
            setTrimmed(accepted < files.length ? accepted : null);
            event.currentTarget.value = "";
          }}
        />
        <p id={countId} className={styles.count}>
          {t("sell.images.count", { count: formatNumber(count), max })}
        </p>
        {full && <p className={styles.hint}>{t("sell.images.full", { max })}</p>}
        {error !== undefined && (
          <p id={errorId} className={styles.error}>
            <Icon name="error" size={18} />
            {error}
          </p>
        )}
      </div>
      {trimmed !== null && (
        <Alert
          variant="warning"
          title={t("sell.images.trimmed", { count: formatNumber(trimmed) })}
          live
        />
      )}
      {count > 0 && (
        <ol className={styles.imageList}>
          {images.items.map((item, index) => {
            const position = formatNumber(index + 1);
            const which = t("sell.images.position", { position });
            const problem = problemText(item);
            return (
              <li key={item.key} className={styles.imageItem}>
                <div className={styles.imageHead}>
                  <span className={styles.imagePosition}>{which}</span>
                  {index === 0 && <Badge variant="neutral">{t("sell.images.primary")}</Badge>}
                </div>
                <UploadStatus
                  state={item.state}
                  fileName={item.fileName}
                  purpose="listing"
                  removing={item.removing}
                  expiredText={item.restored ? t("sell.images.expired") : undefined}
                  onRetry={
                    item.file === null
                      ? undefined
                      : () => {
                          images.retry(item);
                        }
                  }
                  onRemove={() => {
                    void images.remove(item);
                  }}
                />
                {problem !== null && <Alert variant="danger" title={problem} live />}
                {count > 1 && (
                  <div className={styles.order}>
                    <Button
                      variant="secondary"
                      disabled={index === 0}
                      aria-label={t("sell.images.moveEarlierOf", { which })}
                      onClick={() => {
                        images.move(item.key, -1);
                      }}
                    >
                      {t("sell.images.moveEarlier")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={index === count - 1}
                      aria-label={t("sell.images.moveLaterOf", { which })}
                      onClick={() => {
                        images.move(item.key, 1);
                      }}
                    >
                      {t("sell.images.moveLater")}
                    </Button>
                    {index > 0 && (
                      <Button
                        variant="ghost"
                        aria-label={t("sell.images.makePrimaryOf", { which })}
                        onClick={() => {
                          images.makePrimary(item.key);
                        }}
                      >
                        {t("sell.images.makePrimary")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
