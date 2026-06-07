import { db, type Database } from "../db/client";
import {
  buildCashflowForecastRows,
  type ForecastRow,
  type ForecastScenarioExpense,
} from "./cashflow";
import { addMonths, monthStart, nextMonthStart, toMonthKey } from "./months";
import {
  createForecastRunWithItems,
  listActualExpensesForPeriod,
  listIncomeEventsForPeriod,
} from "./repositories/events-repo";
import { listPlannedExpensesForPeriod } from "./repositories/planned-repo";
import { getFinancialSnapshot } from "./snapshot";

export type { ForecastRow, ForecastScenarioExpense };

export type ForecastResult = {
  userId: string;
  startMonth: string;
  horizonMonths: number;
  rows: ForecastRow[];
  minimumFreeCashMinor: number;
  minimumMonth: string;
  persistedForecastRunId?: string;
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
  const periodRequests = Array.from({ length: horizonMonths }, (_, index) => {
    const month = addMonths(startMonth, index);
    const from = monthStart(month);
    const to = nextMonthStart(month);

    return Promise.all([
      listPlannedExpensesForPeriod(database, userId, from, to),
      listActualExpensesForPeriod(database, userId, from, to),
      listIncomeEventsForPeriod(database, userId, from, to),
    ]);
  });
  const periodRows = await Promise.all(periodRequests);
  const plannedExpenses = periodRows.flatMap(([plans]) => plans);
  const actualExpenses = periodRows.flatMap(([, actuals]) => actuals);
  const incomeEvents = periodRows.flatMap(([, , events]) => events);
  const rows = buildCashflowForecastRows({
    now,
    horizonMonths,
    openingFreeCashMinor: snapshot.totals.availableOperatingCashMinor,
    openingProtectedSavingsMinor: snapshot.totals.protectedSavingsMinor,
    incomeRules: snapshot.incomeRules,
    incomeEvents,
    recurringExpenses: snapshot.recurringExpenses,
    plannedExpenses,
    actualExpenses,
    savingsRules: snapshot.savingsRules,
    scenarioExpenses,
  });
  const minimum = rows.reduce((lowest, row) =>
    row.closingFreeCashMinor < lowest.closingFreeCashMinor ? row : lowest,
  );

  let persistedForecastRunId: string | undefined;
  if (persist) {
    persistedForecastRunId = await createForecastRunWithItems({
      database,
      userId,
      horizonMonths,
      startedAt: now,
      snapshot,
      rows,
      sourceMessageId,
    });
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
