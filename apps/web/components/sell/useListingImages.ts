"use client";

// Task 4.2 (FR17, FR21, FR60, BR06, DEC08, TC07, TC33): the images of the wizard's first step.
//  - Up to ten, each through lib/client/upload.ts (task 4.1), two at a time: the worker processes
//    two at a time too.
//  - The order is the publication order; position 1 is the primary image.
//  - Restored from the tab's draft: only the upload ids, so each one is asked again (API039).
//    An expired one (24 hours, RET01) shows why and is removed by the member; the text stays.
//  - Private previews live 60 seconds (BR26): refreshPreviews() asks for new links before the
//    images are shown again (the images and review steps).
//  - Task 4.4, the edit page: the listing's current images come in as attached. They show their
//    public w150 copy (or none while it is prepared), are never asked again, and removing one only
//    takes it out of the list: the edit detaches it when saved (API035), never API040.
import { LISTING_IMAGES_MAX } from "@souq/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { followUpload, removeUpload, uploadImage, type UploadState } from "../../lib/client/upload";

export type ServerProblem = "invalid" | "notReady";

export interface ImageItem {
  readonly key: number;
  /** null for an image restored from the draft: its file is not kept, so no retry. */
  readonly file: File | null;
  readonly fileName: string;
  readonly state: UploadState;
  readonly removing: boolean;
  /** When the current private preview link was issued (it lives 60 seconds). */
  readonly previewAt: number | null;
  /** What API034 said about this image (MEDIA_INVALID, MEDIA_NOT_READY). */
  readonly serverProblem: ServerProblem | null;
  readonly restored: boolean;
  /** Task 4.4: one of the listing's current images (removed from the list only, never deleted). */
  readonly attached: boolean;
}

/** Task 4.4: an image the listing already has, with its public thumbnail if it exists. */
export interface AttachedImage {
  readonly mediaId: string;
  readonly label: string;
  readonly previewUrl: string | null;
}

/** An image kept in the tab's draft. */
export interface RestoredImage {
  readonly mediaId: string;
  readonly fileName: string;
}

const CHECKING: UploadState = {
  phase: "checking",
  uploadId: null,
  reason: null,
  failure: null,
  retryAfter: null,
  previewUrl: null,
};

/** Two uploads at a time. */
const PARALLEL = 2;
/** A preview older than this is asked again before it is shown (links live 60 seconds). */
const PREVIEW_FRESH_MS = 45_000;

export interface ListingImages {
  readonly items: readonly ImageItem[];
  /** Adds files up to the limit; returns how many were accepted. */
  readonly add: (files: readonly File[]) => number;
  readonly retry: (item: ImageItem) => void;
  readonly remove: (item: ImageItem) => Promise<void>;
  readonly move: (key: number, delta: -1 | 1) => void;
  readonly makePrimary: (key: number) => void;
  readonly refreshPreviews: () => void;
  readonly markServerProblems: (problems: ReadonlyMap<number, ServerProblem>) => void;
  readonly reset: () => void;
}

interface Queue {
  active: number;
  waiting: (() => Promise<void>)[];
}

function pump(queue: Queue): void {
  while (queue.active < PARALLEL && queue.waiting.length > 0) {
    const task = queue.waiting.shift();
    if (task === undefined) break;
    queue.active += 1;
    void task().finally(() => {
      queue.active -= 1;
      pump(queue);
    });
  }
}

function restoredItems(images: readonly RestoredImage[]): ImageItem[] {
  return images.slice(0, LISTING_IMAGES_MAX).map((image, index) => ({
    key: index,
    file: null,
    fileName: image.fileName,
    state: { ...CHECKING, phase: "processing", uploadId: image.mediaId },
    removing: false,
    previewAt: null,
    serverProblem: null,
    restored: true,
    attached: false,
  }));
}

function attachedItems(images: readonly AttachedImage[], first: number): ImageItem[] {
  return images.slice(0, LISTING_IMAGES_MAX).map((image, index) => ({
    key: first + index,
    file: null,
    fileName: image.label,
    state: { ...CHECKING, phase: "ready", uploadId: image.mediaId, previewUrl: image.previewUrl },
    removing: false,
    previewAt: null,
    serverProblem: null,
    restored: false,
    attached: true,
  }));
}

export function useListingImages(
  initial: readonly RestoredImage[],
  attached: readonly AttachedImage[] = [],
): ListingImages {
  const [items, setItems] = useState<readonly ImageItem[]>(() => [
    ...restoredItems(initial),
    ...attachedItems(attached, LISTING_IMAGES_MAX),
  ]);
  const latest = useRef<readonly ImageItem[]>(items);
  const nextKey = useRef(LISTING_IMAGES_MAX * 2);
  const queue = useRef<Queue>({ active: 0, waiting: [] });

  useEffect(() => {
    latest.current = items;
  }, [items]);

  const update = useCallback((key: number, change: Partial<ImageItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }, []);

  const onState = useCallback(
    (key: number) => (state: UploadState) => {
      update(key, {
        state,
        previewAt: state.phase === "ready" && state.previewUrl !== null ? Date.now() : null,
      });
    },
    [update],
  );

  const follow = useCallback(
    (key: number, uploadId: string) => {
      void followUpload(uploadId, onState(key));
    },
    [onState],
  );

  // The restored images are asked again once (their state and a fresh preview).
  const restoredOnce = useRef(false);
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    for (const item of latest.current) {
      if (item.restored && item.state.uploadId !== null) follow(item.key, item.state.uploadId);
    }
  }, [follow]);

  const start = useCallback(
    (key: number, file: File) => {
      queue.current.waiting.push(async () => {
        await uploadImage(file, "listing", onState(key));
      });
      pump(queue.current);
    },
    [onState],
  );

  const add = useCallback(
    (files: readonly File[]): number => {
      const room = LISTING_IMAGES_MAX - latest.current.length;
      const accepted = files.slice(0, Math.max(room, 0));
      const added: ImageItem[] = accepted.map((file) => {
        const key = nextKey.current;
        nextKey.current += 1;
        return {
          key,
          file,
          fileName: file.name,
          state: CHECKING,
          removing: false,
          previewAt: null,
          serverProblem: null,
          restored: false,
          attached: false,
        };
      });
      latest.current = [...latest.current, ...added];
      setItems((current) => [...current, ...added]);
      for (const item of added) if (item.file !== null) start(item.key, item.file);
      return accepted.length;
    },
    [start],
  );

  const retry = useCallback(
    (item: ImageItem) => {
      const file = item.file;
      if (file === null) return;
      void (async () => {
        if (item.state.uploadId !== null) await removeUpload(item.state.uploadId);
        update(item.key, { state: CHECKING, serverProblem: null, previewAt: null });
        start(item.key, file);
      })();
    },
    [start, update],
  );

  const remove = useCallback(
    async (item: ImageItem) => {
      const id = item.state.uploadId;
      // An expired upload is gone already: removing it is only the member's way to clear it.
      // An attached image stays the listing's until the edit is saved (task 4.4).
      if (id !== null && item.state.phase !== "expired" && !item.attached) {
        update(item.key, { removing: true });
        const removed = await removeUpload(id);
        if (!removed && item.state.phase === "ready") {
          update(item.key, { removing: false });
          return;
        }
      }
      setItems((current) => current.filter((other) => other.key !== item.key));
    },
    [update],
  );

  const move = useCallback((key: number, delta: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(target, 0, item);
      return next;
    });
  }, []);

  const makePrimary = useCallback((key: number) => {
    setItems((current) => {
      const item = current.find((other) => other.key === key);
      if (item === undefined) return current;
      return [item, ...current.filter((other) => other.key !== key)];
    });
  }, []);

  const refreshPreviews = useCallback(() => {
    const now = Date.now();
    for (const item of latest.current) {
      const id = item.state.uploadId;
      if (
        id !== null &&
        !item.attached &&
        item.state.phase === "ready" &&
        (item.previewAt === null || now - item.previewAt > PREVIEW_FRESH_MS)
      ) {
        follow(item.key, id);
      }
    }
  }, [follow]);

  const markServerProblems = useCallback((problems: ReadonlyMap<number, ServerProblem>) => {
    setItems((current) =>
      current.map((item, index) => ({ ...item, serverProblem: problems.get(index) ?? null })),
    );
  }, []);

  const reset = useCallback(() => {
    queue.current.waiting = [];
    latest.current = [];
    setItems([]);
  }, []);

  return {
    items,
    add,
    retry,
    remove,
    move,
    makePrimary,
    refreshPreviews,
    markServerProblems,
    reset,
  };
}
