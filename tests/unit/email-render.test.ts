// Task 3.8: the notification email (packages/email): DEC65, BR38, SEC11 and owner conditions 1
// and 2, without a database.
import { describe, expect, it } from "vitest";
import {
  EMAIL_GROUPS,
  NOTIFICATION_EVENTS,
  type EmailChannel,
  type NotificationEventDefinition,
} from "@souq/domain";
import {
  EVENT_EMAILS,
  renderNotificationEmail,
  UnknownEmailEventError,
  type NotificationEmailInput,
} from "@souq/email";
import { formatDateTime, t } from "@souq/i18n";

const origin = "https://souqjamia1.test";
const contactEmail = "contact@souqjamia1.test";
const createdAt = new Date("2026-11-22T10:00:00Z");
const deadline = new Date("2026-12-22T10:00:00Z");
const notRegistered = t("email.common.notRegistered");
// Widened, so the checks below still read as rules when an optional event is added.
const EVENTS: Readonly<Record<string, NotificationEventDefinition>> = NOTIFICATION_EVENTS;

function input(eventType: string, channel: EmailChannel): NotificationEmailInput {
  return {
    eventType,
    channel,
    createdAt,
    deletionDeadline: eventType === "account.deletion_requested" ? deadline : null,
    origin,
    contactEmail,
  };
}

/** Every email the worker can send: each required event, and each optional group. */
const ALL = [
  ...Object.entries(EVENTS)
    .filter(([, definition]) => definition.email === "required")
    .map(([type]) => input(type, "required")),
  ...EMAIL_GROUPS.map((group) => input(`test.${group}.event`, group)),
];

/** The visible text of an HTML email, in order. */
function htmlText(html: string): string[] {
  return [...html.matchAll(/<(?:p|h1)\b[^>]*>(.*?)<\/(?:p|h1)>/gs)]
    .map((match) => (match[1] ?? "").replace(/<[^>]+>/g, "").trim())
    .filter((line) => line !== "");
}

describe("DEC65 and owner condition 2", () => {
  it("DEC65 every notification email ends with the not-registered line", () => {
    for (const email of ALL.map(renderNotificationEmail)) {
      expect(email.text.trimEnd().endsWith(notRegistered), email.subject).toBe(true);
      expect(htmlText(email.html).at(-1), email.subject).toBe(notRegistered);
    }
  });

  it("every required event has its email, and every group its texts", () => {
    for (const [type, definition] of Object.entries(EVENTS)) {
      if (definition.email === "required") expect(EVENT_EMAILS[type], type).toBeDefined();
    }
    for (const group of EMAIL_GROUPS) {
      expect(renderNotificationEmail(input("x.y", group)).subject).toBe(
        t(`email.notification.groups.${group}.subject`),
      );
    }
  });

  it("BR38 notification emails carry no member text", () => {
    // The input has no free text at all: these are its only fields.
    expect(Object.keys(input("account.deletion_requested", "required")).sort()).toEqual([
      "channel",
      "contactEmail",
      "createdAt",
      "deletionDeadline",
      "eventType",
      "origin",
    ]);
    // Anything else given is ignored, and every visible line is a fixed text of the site.
    const sneaky = { ...input("account.deletion_requested", "required"), message: "رسالة سرية" };
    for (const base of [sneaky, ...ALL]) {
      const email = renderNotificationEmail(base);
      expect(email.html).not.toContain("رسالة سرية");
      expect(email.text).not.toContain("رسالة سرية");
    }
    // An optional email says only that something changed: it names no event, nobody, no amount.
    for (const group of EMAIL_GROUPS) {
      const email = renderNotificationEmail(input("offer.received", group));
      expect(email.text).toContain(t(`email.notification.groups.${group}.body`));
      expect(email.text).not.toContain("offer.received");
    }
  });

  it("required email says it cannot be turned off; optional email says how to stop it", () => {
    const security = renderNotificationEmail(input("account.deletion_recovered", "required"));
    expect(security.text).toContain(t("email.notification.requiredNotice"));
    expect(security.text).not.toContain(`${origin}/account/notifications`);
    const optional = renderNotificationEmail(input("x.y", "deals"));
    expect(optional.text).toContain(t("email.notification.optionalNotice"));
    expect(optional.text).toContain(`${origin}/account/notifications`);
    expect(optional.text).toContain(
      `${t("email.notification.openNotifications")}: ${origin}/notifications`,
    );
    expect(optional.html).toContain(`href="${origin}/notifications"`);
  });

  it("a required event without an email, or the none channel, is refused", () => {
    expect(() => renderNotificationEmail(input("account.unknown", "required"))).toThrow(
      UnknownEmailEventError,
    );
    expect(() => renderNotificationEmail(input("x.y", "none"))).toThrow(UnknownEmailEventError);
    expect(() =>
      renderNotificationEmail({
        ...input("account.deletion_requested", "required"),
        deletionDeadline: null,
      }),
    ).toThrow(UnknownEmailEventError);
  });

  it("SEC03: no external resources, and every link is on the site's origin", () => {
    for (const email of ALL.map(renderNotificationEmail)) {
      expect(email.html).not.toMatch(/<(img|script|link|iframe)\b/i);
      expect(email.html).not.toMatch(/\ssrc=/i);
      expect(email.html).toContain('<meta name="referrer" content="no-referrer" />');
      for (const match of email.html.matchAll(/href="([^"]+)"/g)) {
        expect(match[1]?.startsWith(`${origin}/`), match[1]).toBe(true);
      }
    }
  });
});

describe("owner condition 1 (SEC11): the deletion emails", () => {
  it("SEC11 the deletion email has the request time, the deadline and the way to recover", () => {
    const email = renderNotificationEmail(input("account.deletion_requested", "required"));
    expect(email.subject).toBe("طُلب حذف حسابك في سوق الجامعة");
    expect(email.text).toContain(formatDateTime(createdAt));
    expect(email.text).toContain(formatDateTime(deadline));
    expect(email.text).toContain(t("email.notification.account.deletion_requested.steps"));
    expect(email.text).toContain(`${t("email.notification.logIn")}: ${origin}/login`);
    expect(email.text).toContain(contactEmail);
    // The address is isolated left to right inside the Arabic sentence (NFR02).
    expect(email.html).toContain(`<span dir="ltr">${contactEmail}</span>`);
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
  });

  it("owner addition 3: the recovery email has no sentence about a suspension or a ban", () => {
    const email = renderNotificationEmail(input("account.deletion_recovered", "required"));
    expect(email.subject).toBe("استُرجع حسابك في سوق الجامعة");
    expect(email.text).toContain("أُلغي طلب حذف حسابك، وعاد حسابك ظاهراً كما كان.");
    expect(email.text).not.toContain("الإيقاف");
    expect(email.text).not.toContain("الحظر");
  });

  it("dates are in Riyadh time with Arabic month names and Western digits", () => {
    const email = renderNotificationEmail(input("account.deletion_requested", "required"));
    // 10:00 UTC is 1:00 PM in Riyadh.
    expect(email.text).toContain("22 نوفمبر 2026 في 1:00 م");
    expect(email.text).toContain("22 ديسمبر 2026 في 1:00 م");
  });

  it("HTML is escaped", () => {
    const email = renderNotificationEmail({
      ...input("account.deletion_requested", "required"),
      contactEmail: 'a"<b>@souqjamia1.test',
    });
    expect(email.html).not.toContain("<b>@");
    expect(email.html).toContain("&lt;b&gt;");
  });
});
