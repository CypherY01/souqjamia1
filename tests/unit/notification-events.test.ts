// Task 3.8 (FR48, SEC11): the notification events, their in-app text and destination, and the
// events the migrations create. The database list is compared in
// tests/integration/notifications.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_CHANNELS, enums, NOTIFICATION_EVENTS } from "@souq/domain";
import { t } from "@souq/i18n";
import { notificationView } from "../../apps/web/lib/notifications/events.ts";

const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "packages",
  "db",
  "supabase",
  "migrations",
);

function migrationsSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .join("\n");
}

describe("FR48 and SEC11: the events", () => {
  it("each event has the job_kind format, a known context and a known channel", () => {
    for (const [type, definition] of Object.entries(NOTIFICATION_EVENTS)) {
      expect(type).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
      expect(enums.NotificationContextType).toContain(definition.context);
      expect(EMAIL_CHANNELS).toContain(definition.email);
    }
  });

  it("each event has its own in-app text and a destination", () => {
    for (const [type, definition] of Object.entries(NOTIFICATION_EVENTS)) {
      const view = notificationView(type, definition.context);
      expect(view.text, type).not.toBe(t("notifications.events.unknown"));
      expect(view.destination, type).not.toBeNull();
      expect(view.destination?.startsWith("/"), type).toBe(true);
    }
  });

  it("an unknown event, or a known one with another context, is «غير متاح»", () => {
    expect(notificationView("offer.received", "offer")).toEqual({
      text: t("notifications.events.unknown"),
      destination: null,
    });
    expect(notificationView("account.deletion_requested", "offer").destination).toBeNull();
  });

  it("every event a migration notifies is in NOTIFICATION_EVENTS and in app.notification_event", () => {
    const sql = migrationsSql();
    const notified = new Set<string>();
    for (const match of sql.matchAll(/app\.notify\(\s*[^,]+,\s*'([^']+)'/g)) {
      if (match[1] !== undefined) notified.add(match[1]);
    }
    const listed = new Set<string>();
    for (const match of sql.matchAll(
      /\(\s*'([a-z][a-z0-9_.]+)',\s*'(required|offers|meetups|deals|reports|reviews|none)'\s*\)/g,
    )) {
      if (match[1] !== undefined) listed.add(match[1]);
    }
    expect(notified.size).toBeGreaterThan(0);
    for (const type of notified) {
      expect(Object.keys(NOTIFICATION_EVENTS), type).toContain(type);
      expect([...listed], type).toContain(type);
    }
  });
});
