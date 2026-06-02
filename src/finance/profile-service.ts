import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, type Database } from "../db/client";
import {
  accountBalances,
  accounts,
  actualExpenses,
  forecastRunItems,
  forecastRuns,
  incomeRules,
  plannedExpenses,
  recurringExpenses,
  savingsBuckets,
  savingsRules,
  users,
} from "../db/schema";
import { addMonths, monthStart, nextMonthStart, toMonthKey } from "./months";

export type UserIdentity = {
  mastraResourceId: string;
  telegramUserId?: string;
  displayName?: string;
};

export type FinancialSnapshot = Awaited<ReturnType<typeof getFinancialSnapshot>>;

export type ForecastRow = {
  month: string;
  openingFreeCashMinor: number;
  incomeMinor: number;
  recurringExpensesMinor: number;
  plannedExpensesMinor: number;
  actualExpensesMinor: number;
  savingsContributionsMinor: number;
  closingFreeCashMinor: number;
  protectedSavingsMinor: number;
  riskLevel: "ok" | "tight" | "negative";
};

export type ForecastResult = {
  userId: string;
  startMonth: string;
  horizonMonths: number;
  rows: ForecastRow[];
  minimumFreeCashMinor: number;
  minimumMonth: string;
  persistedForecastRunId?: string;
};

type ForecastScenarioExpense = {
  name: string;
  amountMinor: number;
  plannedFor: Date;
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const riskLevel = (closingFreeCashMinor: number): ForecastRow["riskLevel"] => {
  if (closingFreeCashMinor < 0) return "negative";
  if (closingFreeCashMinor < 50_000_00) return "tight";
  return "ok";
};

export const getOrCreateUser = async (identity: UserIdentity, database: Database = db) => {
  const [existing] = await database
    .select()
    .from(users)
    .where(eq(users.mastraResourceId, identity.mastraResourceId))
    .limit(1);
  if (existing) return existing;

  const [created] = await database
    .insert(users)
    .values({
      mastraResourceId: identity.mastraResourceId,
      telegramUserId: identity.telegramUserId,
      displayName: identity.displayName,
    })
    .returning();

  return created;
};

export const getFinancialSnapshot = async (userId: string, now = new Date(), database: Database = db) => {
  const userAccounts = await database
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isActive, true)));
  const latestBalances = await Promise.all(
    userAccounts.map(async (account) => {
      const [balance] = await database
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, account.id))
        .orderBy(desc(accountBalances.asOf))
        .limit(1);
      return { account, balance };
    }),
  );

  const [activeIncomeRules, activeRecurringExpenses, buckets, activeSavingsRules, upcomingPlans] = await Promise.all([
    database.select().from(incomeRules).where(and(eq(incomeRules.userId, userId), eq(incomeRules.isActive, true))),
    database
      .select()
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.userId, userId), eq(recurringExpenses.isActive, true))),
    database.select().from(savingsBuckets).where(eq(savingsBuckets.userId, userId)),
    database.select().from(savingsRules).where(and(eq(savingsRules.userId, userId), eq(savingsRules.isActive, true))),
    database
      .select()
      .from(plannedExpenses)
      .where(
        and(
          eq(plannedExpenses.userId, userId),
          inArray(plannedExpenses.status, ["planned", "approved"]),
          gte(plannedExpenses.plannedFor, monthStart(toMonthKey(now))),
        ),
      ),
  ]);

  const totalCashMinor = sum(latestBalances.map(({ balance }) => balance?.amountMinor ?? 0));
  const protectedSavingsMinor = sum(
    buckets.filter((bucket) => bucket.isProtected).map((bucket) => bucket.currentAmountMinor),
  );
  const monthlyIncomeMinor = sum(
    activeIncomeRules.filter((rule) => rule.frequency === "monthly").map((rule) => rule.amountMinor),
  );
  const monthlyRecurringExpensesMinor = sum(
    activeRecurringExpenses.filter((expense) => expense.frequency === "monthly").map((expense) => expense.amountMinor),
  );
  const monthlyFixedSavingsMinor = sum(
    activeSavingsRules
      .filter((rule) => rule.type === "monthly_fixed")
      .map((rule) => rule.amountMinor ?? 0),
  );
  const monthlyPercentageSavingsMinor = sum(
    activeSavingsRules
      .filter((rule) => rule.type === "percentage_of_income")
      .map((rule) => Math.round((monthlyIncomeMinor * (rule.percentBps ?? 0)) / 10_000)),
  );
  const monthlySavingsContributionsMinor = monthlyFixedSavingsMinor + monthlyPercentageSavingsMinor;

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
      monthlySurplusMinor: monthlyIncomeMinor - monthlyRecurringExpensesMinor - monthlySavingsContributionsMinor,
    },
  };
};

export const runForecast = async ({
  userId,
  horizonMonths = 6,
  now = new Date(),
  persist = true,
  sourceMessageId,
  scenarioExpenses = [],
  database = db,
}: {
  userId: string;
  horizonMonths?: number;
  now?: Date;
  persist?: boolean;
  sourceMessageId?: string;
  scenarioExpenses?: ForecastScenarioExpense[];
  database?: Database;
}): Promise<ForecastResult> => {
  const snapshot = await getFinancialSnapshot(userId, now, database);
  const startMonth = toMonthKey(now);
  let freeCashMinor = snapshot.totals.availableOperatingCashMinor;
  let protectedSavingsMinor = snapshot.totals.protectedSavingsMinor;
  const rows: ForecastRow[] = [];

  for (let index = 0; index < horizonMonths; index += 1) {
    const month = addMonths(startMonth, index);
    const from = monthStart(month);
    const to = nextMonthStart(month);
    const [plans, actuals] = await Promise.all([
      database
        .select()
        .from(plannedExpenses)
        .where(
          and(
            eq(plannedExpenses.userId, userId),
            inArray(plannedExpenses.status, ["planned", "approved"]),
            gte(plannedExpenses.plannedFor, from),
            lt(plannedExpenses.plannedFor, to),
          ),
        ),
      database
        .select()
        .from(actualExpenses)
        .where(
          and(
            eq(actualExpenses.userId, userId),
            gte(actualExpenses.spentAt, from),
            lt(actualExpenses.spentAt, to),
          ),
        ),
    ]);

    const matchingScenarioExpenses = scenarioExpenses.filter(
      (expense) => expense.plannedFor >= from && expense.plannedFor < to,
    );
    const plannedExpensesMinor =
      sum(plans.map((expense) => expense.amountMinor)) +
      sum(matchingScenarioExpenses.map((expense) => expense.amountMinor));
    const actualExpensesMinor = sum(actuals.map((expense) => expense.amountMinor));
    const openingFreeCashMinor = freeCashMinor;
    const closingFreeCashMinor =
      openingFreeCashMinor +
      snapshot.totals.monthlyIncomeMinor -
      snapshot.totals.monthlyRecurringExpensesMinor -
      snapshot.totals.monthlySavingsContributionsMinor -
      plannedExpensesMinor -
      actualExpensesMinor;

    protectedSavingsMinor += snapshot.totals.monthlySavingsContributionsMinor;
    freeCashMinor = closingFreeCashMinor;

    rows.push({
      month,
      openingFreeCashMinor,
      incomeMinor: snapshot.totals.monthlyIncomeMinor,
      recurringExpensesMinor: snapshot.totals.monthlyRecurringExpensesMinor,
      plannedExpensesMinor,
      actualExpensesMinor,
      savingsContributionsMinor: snapshot.totals.monthlySavingsContributionsMinor,
      closingFreeCashMinor,
      protectedSavingsMinor,
      riskLevel: riskLevel(closingFreeCashMinor),
    });
  }

  const minimum = rows.reduce((lowest, row) =>
    row.closingFreeCashMinor < lowest.closingFreeCashMinor ? row : lowest,
  );

  let persistedForecastRunId: string | undefined;
  if (persist) {
    const [forecastRun] = await database
      .insert(forecastRuns)
      .values({
        userId,
        horizonMonths,
        startedAt: now,
        inputSnapshot: snapshot,
        resultSummary: {
          minimumFreeCashMinor: minimum.closingFreeCashMinor,
          minimumMonth: minimum.month,
        },
        sourceMessageId,
      })
      .returning();
    persistedForecastRunId = forecastRun.id;

    await database.insert(forecastRunItems).values(
      rows.map((row) => ({
        forecastRunId: forecastRun.id,
        ...row,
      })),
    );
  }

  return {
    userId,
    startMonth,
    horizonMonths,
    rows,
    minimumFreeCashMinor: minimum.closingFreeCashMinor,
    minimumMonth: minimum.month,
    persistedForecastRunId,
  };
};
