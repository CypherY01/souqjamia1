import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@souq/i18n";
import {
  ADDRESS_LINES,
  EMAIL_TEMPLATES,
  generatedTemplates,
  NOTIFICATION_TEMPLATES,
  renderEmailTemplate,
  renderNotificationTemplate,
  TEMPLATES_DIR,
  type EmailTemplateName,
  type NotificationTemplateName,
} from "../../packages/db/scripts/build-email-templates.ts";

const names = Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[];

describe("Supabase Auth email templates (DEC30, DEC37, SEC03)", () => {
  it.each(names)("%s.html is up to date with packages/i18n", (name) => {
    const committed = readFileSync(join(TEMPLATES_DIR, `${name}.html`), "utf8");
    expect(committed).toBe(renderEmailTemplate(name));
  });

  it.each(names)("%s is Arabic RTL and links to its page with token_hash", (name) => {
    const html = renderEmailTemplate(name);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain(
      `href="{{ .SiteURL }}${EMAIL_TEMPLATES[name]}?token_hash={{ .TokenHash }}"`,
    );
    expect(html).toContain(t(`email.${name}.heading`));
    expect(html).toContain(t("email.common.validity"));
  });

  it.each(names)("DEC65: %s carries the line for people who did not sign up", (name) => {
    const html = renderEmailTemplate(name);
    expect(t("email.common.notRegistered")).toBe("إذا لم تسجّل في سوق الجامعة، تجاهل هذه الرسالة.");
    expect(html).toContain(t("email.common.notRegistered"));
  });

  it("SEC03: recovery and email change keep their own notice above the DEC65 line", () => {
    for (const name of ["recovery", "email_change"] as const) {
      const html = renderEmailTemplate(name);
      const own = html.indexOf(t(`email.${name}.notRequested`));
      expect(own).toBeGreaterThan(-1);
      expect(own).toBeLessThan(html.indexOf(t("email.common.notRegistered")));
    }
  });

  it.each(names)("%s loads no external resources and sets no-referrer", (name) => {
    const html = renderEmailTemplate(name);
    expect(html).not.toMatch(/<(img|script|link|iframe)\b/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });

  it("keeps the confirmation template for when DEC63 is reversed", () => {
    expect(names).toContain("confirmation");
  });
});

const notices = Object.keys(NOTIFICATION_TEMPLATES) as NotificationTemplateName[];

describe("Supabase Auth security notices (SEC11, task 3.4)", () => {
  it.each(notices)("%s is up to date with packages/i18n", (name) => {
    const committed = readFileSync(
      join(TEMPLATES_DIR, `${NOTIFICATION_TEMPLATES[name]}.html`),
      "utf8",
    );
    expect(committed).toBe(renderNotificationTemplate(name));
  });

  it.each(notices)("%s is Arabic RTL, has no link, and loads nothing from outside", (name) => {
    const html = renderNotificationTemplate(name);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain(t(`email.${name}.heading`));
    expect(html).not.toMatch(/<a\b|\.SiteURL|\.TokenHash|\.ConfirmationURL/);
    expect(html).not.toMatch(/<(img|script|link|iframe)\b/i);
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    // The only placeholder a notice may carry is the address line (task 3.6, item 10).
    const placeholders = html.match(/\{\{[^}]*\}\}/g) ?? [];
    expect(placeholders).toEqual(
      ADDRESS_LINES[name] === undefined ? [] : [ADDRESS_LINES[name].placeholder],
    );
  });

  it("task 3.6, item 10: the email change and its notice show the new address, left to right", () => {
    expect(renderEmailTemplate("email_change")).toContain(
      `${t("email.email_change.newAddress")} <span dir="ltr" style="font-weight: bold">{{ .NewEmail }}</span>`,
    );
    expect(renderNotificationTemplate("email_changed")).toContain(
      `${t("email.email_changed.newAddress")} <span dir="ltr" style="font-weight: bold">{{ .Email }}</span>`,
    );
  });

  it.each(notices)("DEC65: %s ends with the line for people who did not sign up", (name) => {
    const html = renderNotificationTemplate(name);
    const own = html.indexOf(t(`email.${name}.notRequested`));
    expect(own).toBeGreaterThan(-1);
    expect(own).toBeLessThan(html.indexOf(t("email.common.notRegistered")));
  });

  it("every generated file is listed once", () => {
    const files = generatedTemplates().map(({ file }) => file);
    expect(new Set(files).size).toBe(names.length + notices.length);
  });
});
