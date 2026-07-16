import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const currentDateKey = (timezone: string, now = new Date()): string =>
  format(TZDate.tz(timezone, now), "yyyy-MM-dd");

export const currentMonthKey = (timezone: string, now = new Date()): string =>
  format(TZDate.tz(timezone, now), "yyyy-MM");

export const isIsoDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
