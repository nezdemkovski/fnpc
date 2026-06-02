import { TZDate } from "@date-fns/tz";
import { format, isBefore, isValid, parse, parseISO, startOfMonth, subMonths } from "date-fns";
import { monthStart } from "./months";

const DATE_KEY_FORMAT = "yyyy-MM-dd";
const MONTH_KEY_FORMAT = "yyyy-MM";

export const currentDateKey = (timezone: string, now = new Date()): string =>
  format(TZDate.tz(timezone, now), DATE_KEY_FORMAT);

export const currentMonthKey = (timezone: string, now = new Date()): string =>
  format(TZDate.tz(timezone, now), MONTH_KEY_FORMAT);

const utcDateStart = (value: string): Date => {
  const parsed = parse(value, DATE_KEY_FORMAT, new Date(0));
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
};

export const parseUserDate = (value: string): Date => {
  const date = /^\d{4}-\d{2}$/.test(value)
    ? monthStart(value)
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? utcDateStart(value)
      : parseISO(value);
  if (!isValid(date)) throw new Error(`Invalid date: ${value}`);
  return date;
};

export const normalizeCurrency = (currency: string | null | undefined, fallback?: string | null): string => {
  const value = currency ?? fallback;
  if (!value) throw new Error("Currency is required");
  return value.toUpperCase();
};

export const safeReportedBalanceDate = ({
  value,
  timezone,
  now = new Date(),
}: {
  value?: string;
  timezone?: string | null;
  now?: Date;
}): Date => {
  if (!value) return now;
  if (!timezone) throw new Error("Timezone is required when balanceAsOf is provided");

  const date = parseUserDate(value);
  const earliestAcceptedDate = startOfMonth(subMonths(TZDate.tz(timezone, now), 1));
  if (isBefore(date, earliestAcceptedDate)) return now;

  return date;
};
