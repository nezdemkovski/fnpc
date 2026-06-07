import { inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  accountBalances,
  accounts,
  financialEvents,
  incomeRules,
  plannedExpenses,
  recurringExpenses,
  savingsBuckets,
  savingsRules,
  users,
} from "../db/schema";
import { parseUserDate } from "../finance/dates";
import type { EvalDatasetDefinition } from "./datasets";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const workflowResourceIdsFromDatasets = (definitions: EvalDatasetDefinition[]): string[] => [
  ...new Set(
    definitions.flatMap((definition) =>
      definition.items.flatMap((item) => {
        if (!isRecord(item.input)) return [];
        const resourceId = item.input.mastraResourceId;
        return typeof resourceId === "string" && resourceId.startsWith("eval:") ? [resourceId] : [];
      }),
    ),
  ),
];

export const resetWorkflowEvalFixtures = async (definitions: EvalDatasetDefinition[]): Promise<string[]> => {
  const resourceIds = workflowResourceIdsFromDatasets(definitions);
  if (resourceIds.length === 0) return resourceIds;

  await db.delete(users).where(inArray(users.mastraResourceId, resourceIds));

  const insertedUsers = await db
    .insert(users)
    .values(
      resourceIds.map((mastraResourceId) => ({
        mastraResourceId,
        displayName: "Eval Fixture",
        defaultCurrency: "USD",
        timezone: "UTC",
      })),
    )
    .returning();

  for (const user of insertedUsers) {
    const [account] = await db
      .insert(accounts)
      .values({
        userId: user.id,
        name: "Operating account",
        type: "checking",
        currency: "USD",
      })
      .returning();

    await db.insert(accountBalances).values({
      accountId: account.id,
      amountMinor: 500_000_00,
      asOf: parseUserDate("2026-06-02"),
      source: "user_reported",
    });

    await db.insert(incomeRules).values({
      userId: user.id,
      name: "salary",
      amountMinor: 100_000_00,
      currency: "USD",
      frequency: "monthly",
      defaultDay: 5,
    });

    await db.insert(recurringExpenses).values({
      userId: user.id,
      name: "rent",
      amountMinor: 30_000_00,
      currency: "USD",
      frequency: "monthly",
      dayOfMonth: 1,
      isEssential: true,
    });

    if (user.mastraResourceId === "eval:actual-expense:recurring-match") {
      await db.insert(recurringExpenses).values({
        userId: user.id,
        name: "internet service",
        amountMinor: 75_00,
        currency: "USD",
        frequency: "monthly",
        dayOfMonth: 2,
        isEssential: true,
      });
    }

    if (user.mastraResourceId?.startsWith("eval:recurring:")) {
      await db.insert(recurringExpenses).values({
        userId: user.id,
        name: "coworking membership",
        amountMinor: 300_00,
        currency: "USD",
        frequency: "monthly",
        dayOfMonth: 3,
        isEssential: false,
      });
    }

    if (user.mastraResourceId === "eval:explain:recurring-event") {
      const [recurringExpense] = await db
        .insert(recurringExpenses)
        .values({
          userId: user.id,
          name: "internet service",
          amountMinor: 75_00,
          currency: "USD",
          frequency: "monthly",
          dayOfMonth: 2,
          isEssential: true,
        })
        .returning();

      await db.insert(financialEvents).values({
        userId: user.id,
        entityType: "recurring_expense",
        entityId: recurringExpense.id,
        eventType: "created",
        after: recurringExpense,
        reason:
          '{"source":"eval-fixture","sourceText":"internet service costs 75 USD per month"}',
        sourceMessageId: "eval-message:internet-service",
      });
    }

    const [bucket] = await db
      .insert(savingsBuckets)
      .values({
        userId: user.id,
        name: "reserve",
        currentAmountMinor: 100_000_00,
        currency: "USD",
        isProtected: true,
      })
      .returning();

    await db.insert(savingsRules).values({
      userId: user.id,
      bucketId: bucket.id,
      type: "monthly_fixed",
      amountMinor: user.mastraResourceId === "eval:savings:reallocate" ? 30_000_00 : 10_000_00,
      dayOfMonth: 6,
    });
  }

  const userByResourceId = new Map(insertedUsers.map((user) => [user.mastraResourceId, user]));
  const moveUser = userByResourceId.get("eval:planned-expense:move");
  if (moveUser) {
    await db.insert(plannedExpenses).values({
      userId: moveUser.id,
      name: "language course",
      amountMinor: 3_000_00,
      currency: "USD",
      plannedFor: parseUserDate("2026-08"),
      status: "planned",
      priority: "should",
    });
  }

  const cancelUser = userByResourceId.get("eval:planned-expense:cancel");
  if (cancelUser) {
    await db.insert(plannedExpenses).values({
      userId: cancelUser.id,
      name: "side table",
      amountMinor: 2_200_00,
      currency: "USD",
      plannedFor: parseUserDate("2026-07"),
      status: "planned",
      priority: "nice_to_have",
    });
  }

  return resourceIds;
};

export const cleanupWorkflowEvalFixtures = async (resourceIds: string[]): Promise<void> => {
  if (resourceIds.length === 0) return;
  await db.delete(users).where(inArray(users.mastraResourceId, resourceIds));
};
