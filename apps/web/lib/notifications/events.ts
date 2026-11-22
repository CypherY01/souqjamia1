// FR48 (task 3.8): the in-app text and the destination of each notification event, derived on
// the server from the event and its context, never from the browser. The destination page
// checks access again with its own guard when it opens. The events and their email channel are
// in @souq/domain (NOTIFICATION_EVENTS); a later task adds its text and destination here.
import { enums, isNotificationEventType, NOTIFICATION_EVENTS } from "@souq/domain";
import type { NotificationEventType } from "@souq/domain";
import { t, type MessageKey } from "@souq/i18n";
import { routes } from "../routes.ts";

const TEXT: Readonly<Record<NotificationEventType, MessageKey>> = {
  "account.deletion_requested": "notifications.events.account.deletion_requested",
  "account.deletion_recovered": "notifications.events.account.deletion_recovered",
};

/** A fixed local path for a context this build can open, or null. */
function destinationOf(contextType: enums.NotificationContextType): string | null {
  switch (contextType) {
    case "account":
      return routes.account.home;
    default:
      return null;
  }
}

export interface NotificationView {
  text: string;
  /** null: «غير متاح» (plan/screens.md), for an event or context this build does not know. */
  destination: string | null;
}

export function notificationView(
  eventType: string,
  contextType: enums.NotificationContextType,
): NotificationView {
  if (!isNotificationEventType(eventType)) {
    return { text: t("notifications.events.unknown"), destination: null };
  }
  const known = NOTIFICATION_EVENTS[eventType].context === contextType;
  return {
    text: t(known ? TEXT[eventType] : "notifications.events.unknown"),
    destination: known ? destinationOf(contextType) : null,
  };
}
