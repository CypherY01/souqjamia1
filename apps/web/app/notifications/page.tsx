// /notifications «الإشعارات» (task 3.8, plan/screens.md): API078, API079 and API115. Read on the
// server through app.my_notifications() (DEC77), 20 per page, newest first, within 90 days
// (RET07). Older pages are a link with the signed cursor, so the list works without JavaScript.
// Opening an item marks it read (API079) and goes to the destination the server derived (FR48),
// where that page checks access again. An unknown destination shows «غير متاح».
// States: loading (app/loading.tsx), empty, error with retry (app/error.tsx), an expired cursor,
// and a member who still has to confirm the email or accept new terms.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { t } from "@souq/i18n";
import { MarkAllRead } from "../../components/notifications/MarkAllRead";
import { NotificationList } from "../../components/notifications/NotificationList";
import { Alert } from "../../components/ui/Alert";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { memberDenial } from "../../lib/auth/guards";
import { requireMemberPage } from "../../lib/auth/page";
import { appDb } from "../../lib/db/app-client";
import { serverEnv } from "../../lib/env";
import { ApiError } from "../../lib/http/errors";
import { traceIdOf } from "../../lib/http/trace";
import { readNotificationPage, type NotificationPage } from "../../lib/notifications/list";
import { routes } from "../../lib/routes";
import styles from "./notifications.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("notifications.page.title") };

const PAGE_SIZE = 20;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const auth = await requireMemberPage(routes.notifications);
  const denial = memberDenial(auth.state);
  const header = (
    <>
      <h1>{t("notifications.page.title")}</h1>
      <p className={styles.intro}>
        {t("notifications.page.intro")}{" "}
        <a href={routes.account.notifications}>{t("notifications.page.preferencesLink")}</a>
      </p>
    </>
  );
  if (denial === "EMAIL_NOT_CONFIRMED" || denial === "TERMS_NOT_ACKNOWLEDGED") {
    return (
      <div className={styles.page}>
        {header}
        <Alert variant="warning" title={t(`notifications.page.blocked.${denial}`)}>
          <p>
            <a href={routes.account.home}>{t("notifications.page.blocked.link")}</a>
          </p>
        </Alert>
      </div>
    );
  }

  const cursorParam = (await searchParams).cursor;
  const cursor = typeof cursorParam === "string" ? cursorParam : null;
  let page: NotificationPage;
  try {
    page = await readNotificationPage(appDb(), auth.identity, traceIdOf(await headers()), {
      cursor,
      limit: PAGE_SIZE,
      appSecret: serverEnv().APP_SECRET,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "INVALID_CURSOR") throw error;
    return (
      <div className={styles.page}>
        {header}
        <ErrorState
          title={t("notifications.page.cursorError")}
          action={<a href={routes.notifications}>{t("notifications.page.firstPage")}</a>}
        />
      </div>
    );
  }

  if (page.items.length === 0 && cursor === null) {
    return (
      <div className={styles.page}>
        {header}
        <EmptyState
          title={t("notifications.page.emptyTitle")}
          body={t("notifications.page.emptyBody")}
        />
      </div>
    );
  }

  const unreadIds = page.items.filter((item) => item.read_at === null).map((item) => item.id);
  return (
    <div className={styles.page}>
      {header}
      <MarkAllRead ids={unreadIds} />
      <NotificationList items={page.items} />
      {page.nextCursor !== null && (
        <p className={styles.more}>
          <a href={`${routes.notifications}?cursor=${encodeURIComponent(page.nextCursor)}`}>
            {t("notifications.page.more")}
          </a>
        </p>
      )}
    </div>
  );
}
