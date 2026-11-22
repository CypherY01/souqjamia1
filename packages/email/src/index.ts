// Email rendering shared by the Supabase Auth templates and the worker (task 3.8, item 9).
export {
  buttonHtml,
  EMAIL_COLOR,
  escapeHtml,
  layout,
  layoutHtml,
  linkLineHtml,
  noticeHtml,
  noticeLines,
} from "./layout.ts";
export {
  EMAIL_PATHS,
  EVENT_EMAILS,
  pieces,
  renderNotificationEmail,
  UnknownEmailEventError,
  type NotificationEmailInput,
  type RenderedEmail,
} from "./notifications.ts";
