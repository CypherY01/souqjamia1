// Numbers, amounts and dates, isolated from the surrounding Arabic text with <bdi> (NFR02) and
// formatted with Western digits (DEC50). Format on the server, so the browser clock and locale
// never change what was rendered.
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPrice,
  formatRelative,
} from "@souq/i18n";

export function Num({ value }: { value: number }) {
  return <bdi>{formatNumber(value)}</bdi>;
}

/** An amount in halalas: "350 ريال", "350.50 ريال". */
export function Money({ halalas }: { halalas: number }) {
  return <bdi>{formatMoney(halalas)}</bdi>;
}

/** A listing price or wanted budget: 0 is "مجاني". */
export function Price({ halalas }: { halalas: number }) {
  return <bdi>{formatPrice(halalas)}</bdi>;
}

type DateValue = Date | string;

function iso(value: DateValue): string {
  return (typeof value === "string" ? new Date(value) : value).toISOString();
}

export function DateText({ value }: { value: DateValue }) {
  return (
    <time dateTime={iso(value)}>
      <bdi>{formatDate(value)}</bdi>
    </time>
  );
}

/** A meetup time, in Riyadh time (BR14). */
export function DateTimeText({ value }: { value: DateValue }) {
  return (
    <time dateTime={iso(value)}>
      <bdi>{formatDateTime(value)}</bdi>
    </time>
  );
}

/** "قبل 3 ساعات" on cards; the full date and time is in the title. */
export function RelativeDate({ value, now }: { value: DateValue; now?: Date }) {
  return (
    <time dateTime={iso(value)} title={formatDateTime(value)}>
      <bdi>{formatRelative(value, now)}</bdi>
    </time>
  );
}
