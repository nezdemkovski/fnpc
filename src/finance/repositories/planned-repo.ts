import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Database } from "../../db/client";
import { plannedExpenses } from "../../db/schema";

export const listUpcomingPlannedExpenses = async (
  database: Database,
  userId: string,
  from: Date,
) =>
  database
    .select()
    .from(plannedExpenses)
    .where(
      and(
        eq(plannedExpenses.userId, userId),
        inArray(plannedExpenses.status, ["planned", "approved"]),
        gte(plannedExpenses.plannedFor, from),
      ),
    );

export const listPlannedExpensesForPeriod = async (
  database: Database,
  userId: string,
  from: Date,
  to: Date,
) =>
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
    );
