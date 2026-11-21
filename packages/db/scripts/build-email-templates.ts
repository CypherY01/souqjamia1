// Supabase Auth email templates (task 1.4: DEC30, DEC37, DEC63, DEC65, SEC03).
// The Arabic text comes from packages/i18n (no hard-coded UI strings), so the HTML files in
// supabase/templates are generated, never edited by hand.
//   node scripts/build-email-templates.ts           write the files
//   node scripts/build-email-templates.ts --check   fail if a file is out of date
// SEC03: no external resources (images, fonts, scripts), and a no-referrer policy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { t, type MessageKey } from "@souq/i18n";

/** Supabase template name -> the app page that consumes the link (plan/screens.md). */
export const EMAIL_TEMPLATES = {
  // DEC63: confirmation is switched off for now, but the template stays for when it is turned on.
  confirmation: "/auth/confirm",
  recovery: "/auth/recover",
  email_change: "/auth/email-change",
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;

/**
 * Task 3.4, SEC11: security notices Supabase Auth sends after the change, with no link (a
 * password reset or change, and from task 3.6 a completed email change, sent to the old
 * address). Name -> the file name Supabase expects.
 */
export const NOTIFICATION_TEMPLATES = {
  password_changed: "password_changed_notification",
  email_changed: "email_changed_notification",
} as const;

export type NotificationTemplateName = keyof typeof NOTIFICATION_TEMPLATES;

/**
 * A notice specific to the template, shown above the DEC65 line. The confirmation template has
 * none: its notice was "ignore this if you did not sign up", which the DEC65 line already says.
 */
const OWN_NOTICE: Record<EmailTemplateName, MessageKey | null> = {
  confirmation: null,
  recovery: "email.recovery.notRequested",
  email_change: "email.email_change.notRequested",
};

/**
 * Task 3.6 (item 10): the new address, as a Go placeholder Supabase Auth fills in, so the owner
 * of the old address sees where the account moves. Shown left to right, isolated from the
 * Arabic text around it.
 */
export const ADDRESS_LINES: Partial<
  Record<EmailTemplateName | NotificationTemplateName, { label: MessageKey; placeholder: string }>
> = {
  email_change: { label: "email.email_change.newAddress", placeholder: "{{ .NewEmail }}" },
  email_changed: { label: "email.email_changed.newAddress", placeholder: "{{ .Email }}" },
};

function addressLine(name: EmailTemplateName | NotificationTemplateName): string {
  const line = ADDRESS_LINES[name];
  if (line === undefined) return "";
  return `                <p style="margin: 0 0 24px; font-size: 16px">${escapeHtml(t(line.label))} <span dir="ltr" style="font-weight: bold">${line.placeholder}</span></p>
`;
}

export const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "templates",
);

// Design tokens from v3 chapter 02.
const color = {
  primary: "#0B3B2D",
  text: "#06241B",
  muted: "#4B5563",
  page: "#FAF9F5",
  card: "#FFFFFF",
  border: "#E5E1D6",
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** DEC65: every email ends with the line for people who did not sign up. */
function noticeLines(ownNotice: MessageKey | null): string {
  return [...(ownNotice ? [t(ownNotice)] : []), t("email.common.notRegistered")]
    .map(
      (notice) =>
        `                <p style="margin: 0 0 8px; font-size: 13px; color: ${color.muted}">${escapeHtml(notice)}</p>`,
    )
    .join("\n");
}

/** The page around the content: Arabic, RTL, inline styles only, no external resources. */
function layout(subject: string, heading: string, body: string, rest: string): string {
  const font = "Tahoma, 'Segoe UI', Arial, sans-serif";
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${color.page}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${color.page}">
      <tr>
        <td align="center" style="padding: 24px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: ${color.card}; border: 1px solid ${color.border}; border-radius: 12px">
            <tr>
              <td dir="rtl" style="padding: 32px 24px; font-family: ${font}; color: ${color.text}; text-align: right; line-height: 1.7">
                <p style="margin: 0 0 8px; font-size: 14px; font-weight: bold; color: ${color.primary}">${escapeHtml(t("common.app.name"))}</p>
                <h1 style="margin: 0 0 16px; font-size: 22px">${escapeHtml(heading)}</h1>
                <p style="margin: 0 0 24px; font-size: 16px">${escapeHtml(body)}</p>
${rest}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export function renderEmailTemplate(name: EmailTemplateName): string {
  const button = escapeHtml(t(`email.${name}.button`));
  // Go template placeholders filled in by Supabase Auth. The page shows a button and only its
  // POST consumes the link, so mail scanners cannot use it (section 5 of the addendum).
  const link = `{{ .SiteURL }}${EMAIL_TEMPLATES[name]}?token_hash={{ .TokenHash }}`;
  const rest = `${addressLine(name)}                <p style="margin: 0 0 24px">
                  <a href="${link}" style="display: inline-block; padding: 12px 24px; border-radius: 8px; background-color: ${color.primary}; color: #FFFFFF; font-size: 16px; font-weight: bold; text-decoration: none">${button}</a>
                </p>
                <p style="margin: 0 0 8px; font-size: 14px">${escapeHtml(t("email.common.validity"))}</p>
                <p style="margin: 0 0 8px; font-size: 13px; color: ${color.muted}">${escapeHtml(t("email.common.linkHint"))}</p>
                <p dir="ltr" style="margin: 0 0 24px; font-size: 13px; text-align: left; word-break: break-all"><a href="${link}" style="color: ${color.primary}">${link}</a></p>
${noticeLines(OWN_NOTICE[name])}`;
  return layout(
    t(`email.${name}.subject`),
    t(`email.${name}.heading`),
    t(`email.${name}.body`),
    rest,
  );
}

/** SEC11: a security notice, with no link (a link in such an email teaches people to click). */
export function renderNotificationTemplate(name: NotificationTemplateName): string {
  return layout(
    t(`email.${name}.subject`),
    t(`email.${name}.heading`),
    t(`email.${name}.body`),
    `${addressLine(name)}${noticeLines(`email.${name}.notRequested`)}`,
  );
}

/** Every generated file and its content. */
export function generatedTemplates(): { file: string; html: string }[] {
  return [
    ...(Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[]).map((name) => ({
      file: join(TEMPLATES_DIR, `${name}.html`),
      html: renderEmailTemplate(name),
    })),
    ...(Object.keys(NOTIFICATION_TEMPLATES) as NotificationTemplateName[]).map((name) => ({
      file: join(TEMPLATES_DIR, `${NOTIFICATION_TEMPLATES[name]}.html`),
      html: renderNotificationTemplate(name),
    })),
  ];
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const { file, html } of generatedTemplates()) {
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== html) stale.push(file);
    } else {
      writeFileSync(file, html);
      console.log(`wrote ${file}`);
    }
  }
  if (stale.length > 0) {
    for (const file of stale) console.error(`  out of date: ${file}`);
    console.error("emails:check: run `pnpm --filter @souq/db emails:build`.");
    process.exitCode = 1;
  }
}
