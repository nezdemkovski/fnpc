import { and, eq } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { incomeRules, savingsBuckets, savingsRules } from "../db/schema";
import { monthStart, toMonthKey } from "./months";
import { listActiveAccountsWithLatestBalance } from "./repositories/accounts-repo";
import { listUpcomingPlannedExpenses } from "./repositories/planned-repo";
import { listActiveRecurringExpenses } from "./repositories/recurring-repo";

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

export const getFinancialSnapshot = async (
  userId: string,
  now = new Date(),
  database: Database = db,
) => {
  const [
    latestBalances,
    activeIncomeRules,
    activeRecurringExpenses,
    buckets,
    activeSavingsRules,
    upcomingPlans,
  ] = await Promise.all([
    listActiveAccountsWithLatestBalance(database, userId),
    database
      .select()
      .from(incomeRules)
      .where(and(eq(incomeRules.userId, userId), eq(incomeRules.isActive, true))),
    listActiveRecurringExpenses(database, userId),
    database.select().from(savingsBuckets).where(eq(savingsBuckets.userId, userId)),
    database
      .select()
      .from(savingsRules)
      .where(and(eq(savingsRules.userId, userId), eq(savingsRules.isActive, true))),
    listUpcomingPlannedExpenses(database, userId, monthStart(toMonthKey(now))),
  ]);

  const totalCashMinor = sum(
    latestBalances.map(({ balance }) => balance?.amountMinor ?? 0),
  );
  const protectedSavingsMinor = sum(
    buckets
      .filter((bucket) => bucket.isProtected)
      .map((bucket) => bucket.currentAmountMinor),
  );
  const monthlyIncomeMinor = sum(
    activeIncomeRules
      .filter((rule) => rule.frequency === "monthly")
      .map((rule) => rule.amountMinor),
  );
  const monthlyRecurringExpensesMinor = sum(
    activeRecurringExpenses
      .filter((expense) => expense.frequency === "monthly")
      .map((expense) => expense.amountMinor),
  );
  const monthlyFixedSavingsMinor = sum(
    activeSavingsRules
      .filter((rule) => rule.type === "monthly_fixed")
      .map((rule) => rule.amountMinor ?? 0),
  );
  const monthlyPercentageSavingsMinor = sum(
    activeSavingsRules
      .filter((rule) => rule.type === "percentage_of_income")
      .map((rule) =>
        Math.round((monthlyIncomeMinor * (rule.percentBps ?? 0)) / 10_000),
      ),
  );
  const monthlySavingsContributionsMinor =
    monthlyFixedSavingsMinor + monthlyPercentageSavingsMinor;

  return {
    userId,
    asOf: now,
    accounts: latestBalances,
    savingsBuckets: buckets,
    incomeRules: activeIncomeRules,
    recurringExpenses: activeRecurringExpenses,
    savingsRules: activeSavingsRules,
    upcomingPlannedExpenses: upcomingPlans,
    totals: {
      totalCashMinor,
      protectedSavingsMinor,
      availableOperatingCashMinor: totalCashMinor - protectedSavingsMinor,
      monthlyIncomeMinor,
      monthlyRecurringExpensesMinor,
      monthlySavingsContributionsMinor,
      monthlySurplusMinor:
        monthlyIncomeMinor -
        monthlyRecurringExpensesMinor -
        monthlySavingsContributionsMinor,
    },
  };
};

export type FinancialSnapshot = Awaited<ReturnType<typeof getFinancialSnapshot>>;
