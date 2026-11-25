// Display formatting for numbers, money and dates (task 1.5).
// DEC50: Western digits (350) everywhere. Owner decisions on task 1.5:
//   money "350 ريال", "1,200 ريال", halalas only when present ("350.50 ريال"), price 0 "مجاني";
//   Gregorian dates with Arabic month names, 12-hour time, Asia/Riyadh.
// `ar-SA` would print Arabic-Indic digits, and the built-in currency style adds hidden U+200F
// marks, so the formats below are built on `ar-u-nu-latn`.
import { t } from "./t.ts";

const NUMBER_LOCALE = "ar-u-nu-latn";
const DATE_LOCALE = "ar-u-ca-gregory-nu-latn";

/** BR14: timestamps are stored in UTC and shown in Riyadh time. */
export const DISPLAY_TIME_ZONE = "Asia/Riyadh";

const numberFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat(DATE_LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});
const dateTimeFormat = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: DISPLAY_TIME_ZONE,
});
const relativeFormat = new Intl.RelativeTimeFormat(NUMBER_LOCALE, { numeric: "auto" });

/** An integer with Western digits and thousands separators: 1200350 -> "1,200,350". */
export function formatNumber(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("formatNumber expects a safe integer");
  }
  return numberFormat.format(value);
}

/**
 * Money is integer halalas (SAR x 100). 35000 -> "350 ريال", 35050 -> "350.50 ريال".
 * Integer arithmetic only, so nothing is ever rounded.
 */
export function formatMoney(halalas: number): string {
  if (!Number.isSafeInteger(halalas) || halalas < 0) {
    throw new RangeError("formatMoney expects a non-negative integer number of halalas");
  }
  const remainder = halalas % 100;
  const riyals = formatNumber((halalas - remainder) / 100);
  const amount = remainder === 0 ? riyals : `${riyals}.${String(remainder).padStart(2, "0")}`;
  return `${amount} ${t("format.currency")}`;
}

/** A listing price or wanted budget: 0 is shown as "مجاني". */
export function formatPrice(halalas: number): string {
  return halalas === 0 ? t("format.free") : formatMoney(halalas);
}

function toDate(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return date;
}

/** "18 نوفمبر 2026", in Riyadh time. */
export function formatDate(value: Date | string): string {
  return dateFormat.format(toDate(value));
}

const monthFormat = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A month of the contract (`joined_month`, "2026-11") as "نوفمبر 2026" (task 4.3, the seller's
 * join month). The value is already a calendar month, so no time zone moves it.
 */
export function formatMonth(month: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (match === null) throw new RangeError("formatMonth expects YYYY-MM");
  return monthFormat.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15)));
}

/** "الأربعاء، 18 نوفمبر 2026 في 4:30 م", in Riyadh time (meetups, FR38). */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormat.format(toDate(value));
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A short relative date for cards: "الآن", "قبل 5 دقائق", "قبل ساعتين", "أمس", "قبل 3 أيام".
 * A week or more ago, or any future time, falls back to the full date. `now` is a parameter so
 * the server and tests decide it, not the browser clock.
 */
export function formatRelative(value: Date | string, now: Date = new Date()): string {
  const date = toDate(value);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0 || seconds >= 7 * DAY) return formatDate(date);
  if (seconds < MINUTE) return relativeFormat.format(0, "second");
  if (seconds < HOUR) return relativeFormat.format(-Math.floor(seconds / MINUTE), "minute");
  if (seconds < DAY) return relativeFormat.format(-Math.floor(seconds / HOUR), "hour");
  return relativeFormat.format(-Math.floor(seconds / DAY), "day");
}

/**
 * A wait before trying again, from Retry-After (task 3.3, RL01): "خلال 45 ثانية", "خلال دقيقتين",
 * "خلال 5 دقائق", "خلال 15 دقيقة". Seconds below a minute, whole minutes rounded up after that.
 */
export function formatWait(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < MINUTE) return relativeFormat.format(whole, "second");
  return relativeFormat.format(Math.ceil(whole / MINUTE), "minute");
}
