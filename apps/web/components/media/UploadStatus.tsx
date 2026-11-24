"use client";

// Task 4.1 (FR80, SEC08, DEC83): one image's upload state, each one distinct: checking,
// uploading, processing, ready (with its 60-second private preview), rejected with the safe
// reason, failed (network, quota, service, slow) with a retry, and expired. The state is said in
// text, never by color alone, and announced as it changes. A student card shows no preview after
// upload (DEC83). The file name is the member's text (SafeText).
import { t, formatWait, type MessageKey } from "@souq/i18n";
import type { enums } from "@souq/domain";
import type { UploadFailure, UploadPhase } from "../../lib/client/upload";
import { SafeText } from "../text/SafeText";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import styles from "./media.module.css";

export interface UploadStatusState {
  readonly phase: UploadPhase;
  readonly reason: enums.MediaRejectionReason | null;
  readonly failure: UploadFailure | null;
  readonly retryAfter: number | null;
  readonly previewUrl: string | null;
}

interface UploadStatusProps {
  readonly state: UploadStatusState;
  readonly fileName: string;
  readonly purpose: enums.MediaPurpose;
  readonly onRetry?: () => void;
  readonly onRemove?: () => void;
  readonly removing?: boolean;
  /** The /dev/ui preview: the buttons are shown and do nothing. */
  readonly preview?: boolean;
  /**
   * Task 4.2 (TC33): the text of the expired state, when the screen knows why (a temporary image
   * of the tab's draft whose 24 hours ran out). Defaults to the upload's own five minutes.
   */
  readonly expiredText?: string;
}

const PHASE_LABEL: Record<UploadPhase, MessageKey> = {
  checking: "media.status.checking",
  uploading: "media.status.uploading",
  processing: "media.status.processing",
  ready: "media.status.ready",
  rejected: "media.status.rejected",
  failed: "media.status.failed",
  expired: "media.status.expired",
};

const FAILURE_TEXT: Record<Exclude<UploadFailure, "rateLimited">, MessageKey> = {
  network: "media.failures.network",
  slow: "media.failures.slow",
  unavailable: "media.failures.unavailable",
};

function failureText(state: UploadStatusState): string {
  if (state.failure === "rateLimited") {
    return t("media.failures.rateLimited", { wait: formatWait(state.retryAfter ?? 60) });
  }
  return t(FAILURE_TEXT[state.failure ?? "network"]);
}

const BUSY: readonly UploadPhase[] = ["checking", "uploading", "processing"];

export function UploadStatus({
  state,
  fileName,
  purpose,
  onRetry,
  onRemove,
  removing = false,
  preview = false,
  expiredText,
}: UploadStatusProps) {
  const busy = BUSY.includes(state.phase);
  const canRetry = state.phase === "failed" || state.phase === "expired";
  const retry = preview ? () => undefined : onRetry;
  const remove = preview ? () => undefined : onRemove;
  return (
    <div className={styles.item}>
      <p className={styles.name}>
        <SafeText text={fileName} newTabLabel={t("ui.newTab")} />
      </p>
      <p className={styles.phase} role="status" aria-live="polite">
        {busy && <span className={styles.spinner} aria-hidden="true" />}
        <span>{t(PHASE_LABEL[state.phase])}</span>
      </p>
      {state.phase === "ready" && state.previewUrl !== null && (
        // A private link that lives 60 seconds (BR26): never through the image optimizer, whose
        // server cache would keep a copy.
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.preview} src={state.previewUrl} alt={t("media.preview")} />
      )}
      {state.phase === "ready" && purpose === "student_card" && (
        <p className={styles.note}>{t("media.cardPrivate")}</p>
      )}
      {state.phase === "rejected" && (
        <Alert
          variant="danger"
          title={t(`media.reasons.${state.reason ?? "processing_failed"}`)}
          live={!preview}
        />
      )}
      {state.phase === "failed" && (
        <Alert variant="warning" title={failureText(state)} live={!preview} />
      )}
      {state.phase === "expired" && (
        <Alert
          variant="warning"
          title={expiredText ?? t("media.failures.expired")}
          live={!preview}
        />
      )}
      {(canRetry || (!busy && remove !== undefined)) && (
        <div className={styles.actions}>
          {canRetry && retry !== undefined && (
            <Button type="button" variant="secondary" onClick={retry}>
              {t("media.actions.retry")}
            </Button>
          )}
          {!busy && remove !== undefined && (
            <Button
              type="button"
              variant="ghost"
              loading={removing}
              loadingLabel={t("media.actions.removing")}
              onClick={remove}
            >
              {t("media.actions.remove")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
