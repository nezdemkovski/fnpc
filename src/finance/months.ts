import { addMonths as addMonthsDateFns, format, parse } from "date-fns";

const MONTH_KEY_FORMAT = "yyyy-MM";

const parseMonthKey = (month: string): Date => parse(month, MONTH_KEY_FORMAT, new Date(0));

const utcMonthStart = (date: Date): Date => new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));

export const toMonthKey = (date: Date): string => format(date, MONTH_KEY_FORMAT);

export const addMonths = (month: string, count: number): string => {
  return format(addMonthsDateFns(parseMonthKey(month), count), MONTH_KEY_FORMAT);
};

export const monthStart = (month: string): Date => {
  return utcMonthStart(parseMonthKey(month));
};

export const nextMonthStart = (month: string): Date => {
  return utcMonthStart(addMonthsDateFns(parseMonthKey(month), 1));
};
