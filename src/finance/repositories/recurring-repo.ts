import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { recurringExpenses } from "../../db/schema";

export const listActiveRecurringExpenses = async (
  database: Database,
  userId: string,
) =>
  database
    .select()
    .from(recurringExpenses)
    .where(
      and(eq(recurringExpenses.userId, userId), eq(recurringExpenses.isActive, true)),
    );
