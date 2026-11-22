// The email page shared by the Supabase Auth templates (packages/db/scripts/
// build-email-templates.ts, task 1.4) and the worker's notification email (task 3.8, item 9).
// Arabic, right to left, inline styles only, no external resources (SEC03).
import { t } from "@souq/i18n";

// Design tokens from v3 chapter 02.
export const EMAIL_COLOR = {
  primary: "#0B3B2D",
  text: "#06241B",
  muted: "#4B5563",
  page: "#FAF9F5",
  card: "#FFFFFF",
  border: "#E5E1D6",
} as const;

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** One small muted line, already escaped. */
export function noticeHtml(html: string): string {
  return `                <p style="margin: 0 0 8px; font-size: 13px; color: ${EMAIL_COLOR.muted}">${html}</p>`;
}

/** DEC65: the given notices, then the line for people who did not sign up, always last. */
export function noticeLines(notices: readonly string[]): string {
  return [...notices, t("email.common.notRegistered")]
    .map((notice) => noticeHtml(escapeHtml(notice)))
    .join("\n");
}

/** The page around the content, with a body paragraph that is already escaped HTML. */
export function layoutHtml(
  subject: string,
  heading: string,
  bodyHtml: string,
  rest: string,
): string {
  const font = "Tahoma, 'Segoe UI', Arial, sans-serif";
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${EMAIL_COLOR.page}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${EMAIL_COLOR.page}">
      <tr>
        <td align="center" style="padding: 24px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: ${EMAIL_COLOR.card}; border: 1px solid ${EMAIL_COLOR.border}; border-radius: 12px">
            <tr>
              <td dir="rtl" style="padding: 32px 24px; font-family: ${font}; color: ${EMAIL_COLOR.text}; text-align: right; line-height: 1.7">
                <p style="margin: 0 0 8px; font-size: 14px; font-weight: bold; color: ${EMAIL_COLOR.primary}">${escapeHtml(t("common.app.name"))}</p>
                <h1 style="margin: 0 0 16px; font-size: 22px">${escapeHtml(heading)}</h1>
                <p style="margin: 0 0 24px; font-size: 16px">${bodyHtml}</p>
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

/** The page around the content, with a plain-text body paragraph. */
export function layout(subject: string, heading: string, body: string, rest: string): string {
  return layoutHtml(subject, heading, escapeHtml(body), rest);
}

/** The primary button. */
export function buttonHtml(href: string, label: string): string {
  return `                <p style="margin: 0 0 24px">
                  <a href="${href}" style="display: inline-block; padding: 12px 24px; border-radius: 8px; background-color: ${EMAIL_COLOR.primary}; color: #FFFFFF; font-size: 16px; font-weight: bold; text-decoration: none">${escapeHtml(label)}</a>
                </p>
`;
}

/** A link written out left to right, for when a button does not work. */
export function linkLineHtml(href: string): string {
  return `                <p dir="ltr" style="margin: 0 0 24px; font-size: 13px; text-align: left; word-break: break-all"><a href="${href}" style="color: ${EMAIL_COLOR.primary}">${href}</a></p>`;
}
