import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  actualExpenses,
  forecastRunItems,
  forecastRuns,
  incomeEvents,
} from "../../db/schema";
import type { FinancialSnapshot } from "../snapshot";
import type { ForecastRow } from "../cashflow";

export const listActualExpensesForPeriod = async (
  database: Database,
  userId: string,
  from: Date,
  to: Date,
) =>
  database
    .select()
    .from(actualExpenses)
    .where(
      and(
        eq(actualExpenses.userId, userId),
        gte(actualExpenses.spentAt, from),
        lt(actualExpenses.spentAt, to),
      ),
    );

export const listIncomeEventsForPeriod = async (
  database: Database,
  userId: string,
  from: Date,
  to: Date,
) =>
  database
    .select()
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.userId, userId),
        inArray(incomeEvents.status, ["planned", "received"]),
        gte(incomeEvents.expectedDate, from),
        lt(incomeEvents.expectedDate, to),
      ),
    );

export const createForecastRunWithItems = async ({
  database,
  userId,
  horizonMonths,
  startedAt,
  snapshot,
  rows,
  sourceMessageId,
}: {
  database: Database;
  userId: string;
  horizonMonths: number;
  startedAt: Date;
  snapshot: FinancialSnapshot;
  rows: ForecastRow[];
  sourceMessageId?: string;
}) => {
  const minimum = rows.reduce((lowest, row) =>
    row.closingFreeCashMinor < lowest.closingFreeCashMinor ? row : lowest,
  );
  const [forecastRun] = await database
    .insert(forecastRuns)
    .values({
      userId,
      horizonMonths,
      startedAt,
      inputSnapshot: snapshot,
      resultSummary: {
        minimumFreeCashMinor: minimum.closingFreeCashMinor,
        minimumMonth: minimum.month,
      },
      sourceMessageId,
    })
    .returning();

  await database.insert(forecastRunItems).values(
    rows.map((row) => ({
      forecastRunId: forecastRun.id,
      ...row,
    })),
  );

  return forecastRun.id;
};
