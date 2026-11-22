// Task 3.8 (FR48, BR38, SEC11, DEC49, DEC65): the notification events and their email channel.
// The same rows are in app.notification_event (20261122170000_notifications.sql), where the
// database decides whether an email job is queued and whether it may be sent now.
// tests/integration/notification-events.test.ts keeps the two lists equal.
//
// Adding an event (tasks 5.x, 6.x, 7.x): a row in the task's migration and an entry here, its
// in-app text in packages/i18n/src/ar/notifications.json and its destination in
// apps/web/lib/notifications/events.ts. A 'required' event also needs its email in
// packages/email/src/notifications.ts; an optional one uses its group's email.
import type { NotificationContextType } from "./enums.ts";

/** The five optional email groups of public.notification_preference, all off by default. */
export const EMAIL_GROUPS = ["offers", "meetups", "deals", "reports", "reviews"] as const;
export type EmailGroup = (typeof EMAIL_GROUPS)[number];

/**
 * required  security or essential administrative email: never disabled (BR38, SEC11)
 * a group   optional, sent only while the member has the group on
 * none      in-app only (a new message, SEC11)
 */
export type EmailChannel = "required" | EmailGroup | "none";

export const EMAIL_CHANNELS: readonly EmailChannel[] = ["required", ...EMAIL_GROUPS, "none"];

export interface NotificationEventDefinition {
  readonly context: NotificationContextType;
  readonly email: EmailChannel;
}

export const NOTIFICATION_EVENTS = {
  // Task 3.7 (FR72, SEC11, owner condition 1 on task 3.8).
  "account.deletion_requested": { context: "account", email: "required" },
  "account.deletion_recovered": { context: "account", email: "required" },
} as const satisfies Record<string, NotificationEventDefinition>;

export type NotificationEventType = keyof typeof NOTIFICATION_EVENTS;

export function isNotificationEventType(value: string): value is NotificationEventType {
  return Object.hasOwn(NOTIFICATION_EVENTS, value);
}

export function isEmailGroup(value: string): value is EmailGroup {
  return (EMAIL_GROUPS as readonly string[]).includes(value);
}

export function isEmailChannel(value: string): value is EmailChannel {
  return (EMAIL_CHANNELS as readonly string[]).includes(value);
}
