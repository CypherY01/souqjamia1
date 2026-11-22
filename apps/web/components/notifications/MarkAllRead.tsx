"use client";

// Task 3.8 (API079): marks the unread notifications shown on this page read, then refreshes the
// page and the count in the site header. The result takes the focus.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@souq/i18n";
import { api, type ApiFailure } from "../../lib/client/api";
import { routes } from "../../lib/routes";
import { FailureAlert } from "../auth/messages";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import styles from "./notifications.module.css";

interface MarkAllReadProps {
  /** The unread ids of this page: at most 20, within the 1 to 100 of API079. */
  ids: string[];
  /** The /dev/ui preview sends nothing. */
  preview?: boolean;
}

export function MarkAllRead({ ids, preview = false }: MarkAllReadProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done || failure !== null) feedback.current?.focus();
  }, [done, failure]);

  async function markAll(): Promise<void> {
    setFailure(null);
    setDone(false);
    if (preview) {
      setDone(true);
      return;
    }
    setBusy(true);
    const result = await api.request(routes.api.notifications, {
      method: "PATCH",
      body: { ids, read: true },
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setDone(true);
    router.refresh();
  }

  // The page keeps this component after the refresh, with no unread ids left, so the result
  // stays on screen; with nothing unread and nothing to report it shows nothing.
  if (ids.length === 0 && !done && failure === null) return null;
  return (
    <div className={styles.markAll}>
      {(done || failure !== null) && (
        <div ref={feedback} tabIndex={-1}>
          {done && <Alert variant="success" title={t("notifications.page.markAllDone")} live />}
          {failure !== null && (
            <FailureAlert title={t("notifications.page.actionError")} failure={failure} />
          )}
        </div>
      )}
      {ids.length > 0 && (
        <div>
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            loadingLabel={t("notifications.page.markingAll")}
            onClick={() => {
              void markAll();
            }}
          >
            {t("notifications.page.markAll")}
          </Button>
        </div>
      )}
    </div>
  );
}
