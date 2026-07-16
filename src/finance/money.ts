import type { CurrencyFormat } from "ynab";

export type Milliunits = number & { readonly __brand: "Milliunits" };

export const asMilliunits = (value: number): Milliunits => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid YNAB milliunits value: ${value}`);
  }
  return value as Milliunits;
};

export const majorToMilliunits = (amount: number): Milliunits => {
  if (!Number.isFinite(amount)) throw new Error("Amount must be finite");
  return asMilliunits(Math.round(amount * 1000));
};

export const milliunitsToMajor = (amount: number): number => amount / 1000;

export const formatMilliunits = (
  amount: number,
  currency: CurrencyFormat,
  locale = "en-US",
): string =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.iso_code,
    minimumFractionDigits: currency.decimal_digits,
    maximumFractionDigits: currency.decimal_digits,
  }).format(milliunitsToMajor(amount));
