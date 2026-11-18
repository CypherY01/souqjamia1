// Supabase Auth email templates (task 1.4: DEC30, DEC37, DEC63, SEC03).
// The Arabic text comes from packages/i18n (no hard-coded UI strings), so the HTML files in
// supabase/templates are generated, never edited by hand.
//   node scripts/build-email-templates.ts           write the files
//   node scripts/build-email-templates.ts --check   fail if a file is out of date
// SEC03: no external resources (images, fonts, scripts), and a no-referrer policy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "@souq/i18n";

/** Supabase template name -> the app page that consumes the link (plan/screens.md). */
export const EMAIL_TEMPLATES = {
  // DEC63: confirmation is switched off for now, but the template stays for when it is turned on.
  confirmation: "/auth/confirm",
  recovery: "/auth/recover",
  email_change: "/auth/email-change",
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;

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

export function renderEmailTemplate(name: EmailTemplateName): string {
  const text = {
    subject: escapeHtml(t(`email.${name}.subject`)),
    heading: escapeHtml(t(`email.${name}.heading`)),
    body: escapeHtml(t(`email.${name}.body`)),
    button: escapeHtml(t(`email.${name}.button`)),
    notRequested: escapeHtml(t(`email.${name}.notRequested`)),
    validity: escapeHtml(t("email.common.validity")),
    linkHint: escapeHtml(t("email.common.linkHint")),
    appName: escapeHtml(t("common.app.name")),
  };
  // Go template placeholders filled in by Supabase Auth. The page shows a button and only its
  // POST consumes the link, so mail scanners cannot use it (section 5 of the addendum).
  const link = `{{ .SiteURL }}${EMAIL_TEMPLATES[name]}?token_hash={{ .TokenHash }}`;
  const font = "Tahoma, 'Segoe UI', Arial, sans-serif";
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${text.subject}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${color.page}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${color.page}">
      <tr>
        <td align="center" style="padding: 24px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: ${color.card}; border: 1px solid ${color.border}; border-radius: 12px">
            <tr>
              <td dir="rtl" style="padding: 32px 24px; font-family: ${font}; color: ${color.text}; text-align: right; line-height: 1.7">
                <p style="margin: 0 0 8px; font-size: 14px; font-weight: bold; color: ${color.primary}">${text.appName}</p>
                <h1 style="margin: 0 0 16px; font-size: 22px">${text.heading}</h1>
                <p style="margin: 0 0 24px; font-size: 16px">${text.body}</p>
                <p style="margin: 0 0 24px">
                  <a href="${link}" style="display: inline-block; padding: 12px 24px; border-radius: 8px; background-color: ${color.primary}; color: #FFFFFF; font-size: 16px; font-weight: bold; text-decoration: none">${text.button}</a>
                </p>
                <p style="margin: 0 0 8px; font-size: 14px">${text.validity}</p>
                <p style="margin: 0 0 8px; font-size: 13px; color: ${color.muted}">${text.linkHint}</p>
                <p dir="ltr" style="margin: 0 0 24px; font-size: 13px; text-align: left; word-break: break-all"><a href="${link}" style="color: ${color.primary}">${link}</a></p>
                <p style="margin: 0; font-size: 13px; color: ${color.muted}">${text.notRequested}</p>
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

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const name of Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[]) {
    const file = join(TEMPLATES_DIR, `${name}.html`);
    const html = renderEmailTemplate(name);
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
