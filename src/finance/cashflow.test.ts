import { describe, expect, test } from "bun:test";
import { buildCashflowForecastRows, type CashflowInput } from "./cashflow";

const june8 = new Date(Date.UTC(2026, 5, 8, 10));

const baseInput = (overrides: Partial<CashflowInput> = {}): CashflowInput => ({
  now: june8,
  horizonMonths: 2,
  openingFreeCashMinor: 100_000_00,
  openingProtectedSavingsMinor: 0,
  incomeRules: [],
  incomeEvents: [],
  recurringExpenses: [],
  plannedExpenses: [],
  actualExpenses: [],
  savingsRules: [],
  ...overrides,
});

describe("buildCashflowForecastRows", () => {
  test("does not count monthly salary for current month when its pay day already passed", () => {
    const rows = buildCashflowForecastRows(
      baseInput({
        incomeRules: [
          {
            id: "salary",
            amountMinor: 165_000_00,
            frequency: "monthly",
            defaultDay: 5,
          },
        ],
      }),
    );

    expect(rows[0]?.incomeMinor).toBe(0);
    expect(rows[1]?.incomeMinor).toBe(165_000_00);
  });

  test("does not count a dated recurring expense when it was already paid this month", () => {
    const rows = buildCashflowForecastRows(
      baseInput({
        recurringExpenses: [
          {
            name: "Rent",
            amountMinor: 42_000_00,
            frequency: "monthly",
            dayOfMonth: 1,
          },
        ],
        actualExpenses: [
          {
            name: "Rent",
            amountMinor: 42_000_00,
            spentAt: new Date(Date.UTC(2026, 5, 1, 9)),
          },
        ],
      }),
    );

    expect(rows[0]?.recurringExpensesMinor).toBe(0);
    expect(rows[1]?.recurringExpensesMinor).toBe(42_000_00);
  });

  test("prorates current-month recurring expenses without a due day", () => {
    const rows = buildCashflowForecastRows(
      baseInput({
        recurringExpenses: [
          {
            name: "Groceries",
            amountMinor: 30_000_00,
            frequency: "monthly",
          },
        ],
      }),
    );

    expect(rows[0]?.recurringExpensesMinor).toBe(23_000_00);
    expect(rows[1]?.recurringExpensesMinor).toBe(30_000_00);
  });

  test("keeps active current-month planned expenses even when the planned date passed", () => {
    const rows = buildCashflowForecastRows(
      baseInput({
        plannedExpenses: [
          {
            amountMinor: 15_000_00,
            plannedFor: new Date(Date.UTC(2026, 5, 1, 9)),
          },
        ],
      }),
    );

    expect(rows[0]?.plannedExpensesMinor).toBe(15_000_00);
  });

  test("does not count fixed savings contribution for current month when its day passed", () => {
    const rows = buildCashflowForecastRows(
      baseInput({
        savingsRules: [
          {
            type: "monthly_fixed",
            amountMinor: 20_000_00,
            dayOfMonth: 5,
          },
        ],
      }),
    );

    expect(rows[0]?.savingsContributionsMinor).toBe(0);
    expect(rows[1]?.savingsContributionsMinor).toBe(20_000_00);
  });
});
