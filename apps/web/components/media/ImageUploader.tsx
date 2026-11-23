"use client";

// Task 4.1: picks images and runs each through lib/client/upload.ts, one at a time, showing each
// one's state (UploadStatus). The screens of tasks 4.2, 4.7, 5.3 and 7.6 build on it. The file
// input stays disabled until React hydrates (task 4.0): a file chosen earlier would be lost.
// accept lists the three types, so an iPhone converts a HEIC photo to JPEG before upload.
import { useRef, useState } from "react";
import { IMAGE_MIME_TYPES, type enums } from "@souq/domain";
import { t } from "@souq/i18n";
import { removeUpload, uploadImage, type UploadState } from "../../lib/client/upload";
import { useHydrated } from "../../lib/client/use-hydrated";
import { UploadStatus } from "./UploadStatus";
import styles from "./media.module.css";

interface Item {
  readonly key: number;
  readonly file: File;
  readonly state: UploadState;
  readonly removing: boolean;
}

interface ImageUploaderProps {
  readonly purpose: enums.MediaPurpose;
  readonly idPrefix: string;
}

const CHECKING: UploadState = {
  phase: "checking",
  uploadId: null,
  reason: null,
  failure: null,
  retryAfter: null,
  previewUrl: null,
};

export function ImageUploader({ purpose, idPrefix }: ImageUploaderProps) {
  const hydrated = useHydrated();
  const [items, setItems] = useState<readonly Item[]>([]);
  const nextKey = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function update(key: number, change: Partial<Item>): void {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }

  function enqueue(key: number, file: File): void {
    queue.current = queue.current.then(async () => {
      await uploadImage(file, purpose, (state) => {
        update(key, { state });
      });
    });
  }

  function add(files: FileList | null): void {
    for (const file of files ?? []) {
      const key = nextKey.current;
      nextKey.current += 1;
      setItems((current) => [...current, { key, file, state: CHECKING, removing: false }]);
      enqueue(key, file);
    }
  }

  async function retry(item: Item): Promise<void> {
    if (item.state.uploadId !== null) await removeUpload(item.state.uploadId);
    update(item.key, { state: CHECKING });
    enqueue(item.key, item.file);
  }

  async function remove(item: Item): Promise<void> {
    if (item.state.uploadId !== null) {
      update(item.key, { removing: true });
      const removed = await removeUpload(item.state.uploadId);
      if (!removed) {
        update(item.key, { removing: false });
        return;
      }
    }
    setItems((current) => current.filter((other) => other.key !== item.key));
  }

  const inputId = `${idPrefix}-file`;
  const hintId = `${idPrefix}-hint`;
  return (
    <div className={styles.uploader}>
      <div className={styles.picker}>
        <label className={styles.label} htmlFor={inputId}>
          {t("media.picker.label")}
        </label>
        <input
          id={inputId}
          className={styles.input}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          multiple
          disabled={!hydrated}
          aria-describedby={hintId}
          onChange={(event) => {
            add(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <p id={hintId} className={styles.hint}>
          {hydrated ? t("media.picker.hint") : t("ui.loading")}
        </p>
      </div>
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.key}>
              <UploadStatus
                state={item.state}
                fileName={item.file.name}
                purpose={purpose}
                removing={item.removing}
                onRetry={() => {
                  void retry(item);
                }}
                onRemove={() => {
                  void remove(item);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
