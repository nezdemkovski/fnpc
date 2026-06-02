export const majorToMinor = (amount: number): number => Math.round(amount * 100);

export const minorToMajor = (amountMinor: number): number => amountMinor / 100;

export const formatMoney = (amountMinor: number, currency: string): string => {
  const amount = minorToMajor(amountMinor);
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount)} ${currency}`;
};
