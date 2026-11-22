// Task 3.8: the email of a notification (SEC11, BR38, DEC65, owner conditions 1 and 2).
//  - BR38: the input has no free text. An email shows fixed Arabic text, dates formatted here,
//    and the site's contact address; never a message, a name or anything a member wrote.
//  - A required event has its own email (EVENT_EMAILS). An optional event uses its group's email,
//    which says only that something changed and opens /notifications (item 7): the destination
//    is checked again when the member opens it there (FR48).
//  - DEC65: the line for people who did not sign up ends the HTML and the text.
//  - Links point to fixed paths on APP_ORIGIN only.
import { isEmailGroup, type EmailChannel, type EmailGroup } from "@souq/domain";
import { formatDateTime, t, type MessageKey } from "@souq/i18n";
import {
  buttonHtml,
  escapeHtml,
  layoutHtml,
  linkLineHtml,
  noticeHtml,
  noticeLines,
} from "./layout.ts";

export interface NotificationEmailInput {
  readonly eventType: string;
  /** From app.notification_email(): the channel the database decided with. */
  readonly channel: EmailChannel;
  readonly createdAt: Date;
  /** account.deletion_requested only: the end of the 30-day recovery period (FR72). */
  readonly deletionDeadline: Date | null;
  /** APP_ORIGIN, e.g. https://souqjamia1.com. */
  readonly origin: string;
  /** CONTACT_EMAIL (FR78), for a member who cannot sign in. */
  readonly contactEmail: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** A required event without an email here, or a channel that sends none: a programming error. */
export class UnknownEmailEventError extends Error {
  override name = "UnknownEmailEventError";
}

/** Site paths the emails open (apps/web/lib/routes.ts has the same ones). */
export const EMAIL_PATHS = {
  login: "/login",
  notifications: "/notifications",
  preferences: "/account/notifications",
} as const;

/** Plain text, or a value shown left to right and isolated (an address). */
type Piece = string | { readonly ltr: string };
type Values = Readonly<Record<string, Piece>>;

interface EmailContent {
  subject: string;
  heading: string;
  /** The first is the body under the heading. */
  paragraphs: readonly (readonly Piece[])[];
  button: { label: string; path: string };
  /** Smaller lines above the channel notice and the DEC65 line. */
  notices: readonly (readonly Piece[])[];
}

/** A message split at its {placeholders}, each filled from values (a missing one throws). */
export function pieces(key: MessageKey, values: Values = {}): Piece[] {
  const raw = t(key);
  const out: Piece[] = [];
  let last = 0;
  for (const match of raw.matchAll(/\{(\w+)\}/g)) {
    const name = match[1] ?? "";
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Missing value "${name}" for message key: ${key}`);
    }
    if (match.index > last) out.push(raw.slice(last, match.index));
    out.push(values[name] as Piece);
    last = match.index + match[0].length;
  }
  if (last < raw.length) out.push(raw.slice(last));
  return out;
}

function piecesHtml(parts: readonly Piece[]): string {
  return parts
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part)
        : `<span dir="ltr">${escapeHtml(part.ltr)}</span>`,
    )
    .join("");
}

function piecesText(parts: readonly Piece[]): string {
  return parts.map((part) => (typeof part === "string" ? part : part.ltr)).join("");
}

function deletionRequested(input: NotificationEmailInput): EmailContent {
  if (input.deletionDeadline === null) {
    throw new UnknownEmailEventError("account.deletion_requested needs its deadline");
  }
  return {
    subject: t("email.notification.account.deletion_requested.subject"),
    heading: t("email.notification.account.deletion_requested.heading"),
    paragraphs: [
      pieces("email.notification.account.deletion_requested.body", {
        requestedAt: formatDateTime(input.createdAt),
        deadline: formatDateTime(input.deletionDeadline),
      }),
      pieces("email.notification.account.deletion_requested.steps"),
    ],
    button: { label: t("email.notification.logIn"), path: EMAIL_PATHS.login },
    notices: [
      pieces("email.notification.account.deletion_requested.notRequested", {
        contact: { ltr: input.contactEmail },
      }),
    ],
  };
}

function deletionRecovered(): EmailContent {
  return {
    subject: t("email.notification.account.deletion_recovered.subject"),
    heading: t("email.notification.account.deletion_recovered.heading"),
    paragraphs: [pieces("email.notification.account.deletion_recovered.body")],
    button: { label: t("email.notification.logIn"), path: EMAIL_PATHS.login },
    notices: [pieces("email.notification.account.deletion_recovered.notRequested")],
  };
}

/** The email of each required event (SEC11). tests/unit/email-render.test.ts checks coverage. */
export const EVENT_EMAILS: Readonly<
  Record<string, (input: NotificationEmailInput) => EmailContent>
> = {
  "account.deletion_requested": deletionRequested,
  "account.deletion_recovered": deletionRecovered,
};

function groupEmail(group: EmailGroup): EmailContent {
  return {
    subject: t(`email.notification.groups.${group}.subject`),
    heading: t(`email.notification.groups.${group}.heading`),
    paragraphs: [pieces(`email.notification.groups.${group}.body`)],
    button: { label: t("email.notification.openNotifications"), path: EMAIL_PATHS.notifications },
    notices: [],
  };
}

function contentOf(input: NotificationEmailInput): EmailContent {
  if (input.channel === "required") {
    const render = EVENT_EMAILS[input.eventType];
    if (render === undefined) {
      throw new UnknownEmailEventError(`no email for required event ${input.eventType}`);
    }
    return render(input);
  }
  if (isEmailGroup(input.channel)) return groupEmail(input.channel);
  throw new UnknownEmailEventError(`channel ${input.channel} sends no email`);
}

function siteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const content = contentOf(input);
  const [body = [], ...more] = content.paragraphs;
  const buttonUrl = siteUrl(input.origin, content.button.path);
  const preferencesUrl = siteUrl(input.origin, EMAIL_PATHS.preferences);
  const required = input.channel === "required";
  const channelNotice = required
    ? t("email.notification.requiredNotice")
    : t("email.notification.optionalNotice");

  const html = layoutHtml(
    content.subject,
    content.heading,
    piecesHtml(body),
    [
      ...more.map(
        (paragraph) =>
          `                <p style="margin: 0 0 24px; font-size: 16px">${piecesHtml(paragraph)}</p>\n`,
      ),
      buttonHtml(escapeHtml(buttonUrl), content.button.label),
      noticeHtml(escapeHtml(t("email.common.linkHint"))),
      "\n",
      linkLineHtml(escapeHtml(buttonUrl)),
      "\n",
      ...content.notices.map((notice) => `${noticeHtml(piecesHtml(notice))}\n`),
      ...(required
        ? []
        : [
            `${noticeHtml(escapeHtml(channelNotice))}\n`,
            `${linkLineHtml(escapeHtml(preferencesUrl))}\n`,
          ]),
      noticeLines(required ? [channelNotice] : []),
    ].join(""),
  );

  const text = [
    t("common.app.name"),
    content.heading,
    ...content.paragraphs.map(piecesText),
    `${content.button.label}: ${buttonUrl}`,
    ...content.notices.map(piecesText),
    ...(required ? [channelNotice] : [`${channelNotice} ${preferencesUrl}`]),
    t("email.common.notRegistered"),
  ].join("\n\n");

  return { subject: content.subject, html, text: `${text}\n` };
}
