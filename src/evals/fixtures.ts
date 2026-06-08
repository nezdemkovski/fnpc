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

export const agentResourceIdFromMetadata = (metadata: Record<string, unknown> | undefined): string | null => {
  const category = typeof metadata?.category === "string" ? metadata.category : null;
  const testCase = typeof metadata?.case === "string" ? metadata.case : null;
  if (!category || !testCase) return null;
  return `eval:agent:${category}:${testCase}`;
};

export const agentResourceIdsFromDatasets = (definitions: EvalDatasetDefinition[]): string[] => [
  ...new Set(
    definitions.flatMap((definition) =>
      definition.items.flatMap((item) => {
        const resourceId = agentResourceIdFromMetadata(item.metadata);
        return resourceId ? [resourceId] : [];
      }),
    ),
  ),
];

export const resetAgentEvalFixtures = async (definitions: EvalDatasetDefinition[]): Promise<string[]> => {
  const resourceIds = agentResourceIdsFromDatasets(definitions);
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
      amountMinor: 100_000_00,
      asOf: parseUserDate("2026-06-02"),
      source: "user_reported",
    });

    await db.insert(incomeRules).values({
      userId: user.id,
      name: "salary",
      amountMinor: 10_000_00,
      currency: "USD",
      frequency: "monthly",
      defaultDay: 5,
    });
  }

  const userByResourceId = new Map(insertedUsers.map((user) => [user.mastraResourceId, user]));

  const movePlanUser = userByResourceId.get("eval:agent:planned_expense:move");
  if (movePlanUser) {
    await db.insert(plannedExpenses).values({
      userId: movePlanUser.id,
      name: "office chair",
      amountMinor: 1_500_00,
      currency: "USD",
      plannedFor: parseUserDate("2026-07"),
      status: "planned",
      priority: "should",
    });
  }

  const dateMovePlanUser = userByResourceId.get("eval:agent:date:next_month");
  if (dateMovePlanUser) {
    await db.insert(plannedExpenses).values({
      userId: dateMovePlanUser.id,
      name: "training course",
      amountMinor: 900_00,
      currency: "USD",
      plannedFor: parseUserDate("2026-06"),
      status: "planned",
      priority: "should",
    });
  }

  const cancelPlanUser = userByResourceId.get("eval:agent:planned_expense:cancel");
  if (cancelPlanUser) {
    await db.insert(plannedExpenses).values({
      userId: cancelPlanUser.id,
      name: "desk lamp",
      amountMinor: 120_00,
      currency: "USD",
      plannedFor: parseUserDate("2026-07"),
      status: "planned",
      priority: "nice_to_have",
    });
  }

  const recurringPaymentUser = userByResourceId.get("eval:agent:recurring_expense:record_payment_without_amount");
  if (recurringPaymentUser) {
    await db.insert(recurringExpenses).values({
      userId: recurringPaymentUser.id,
      name: "coworking membership",
      amountMinor: 300_00,
      currency: "USD",
      frequency: "monthly",
      dayOfMonth: 3,
      isEssential: false,
    });
  }

  const provenanceUser = userByResourceId.get("eval:agent:provenance:explain_saved_fact");
  if (provenanceUser) {
    const [recurringExpense] = await db
      .insert(recurringExpenses)
      .values({
        userId: provenanceUser.id,
        name: "internet bill",
        amountMinor: 75_00,
        currency: "USD",
        frequency: "monthly",
        dayOfMonth: 2,
        isEssential: true,
      })
      .returning();

    await db.insert(financialEvents).values({
      userId: provenanceUser.id,
      entityType: "recurring_expense",
      entityId: recurringExpense.id,
      eventType: "created",
      after: recurringExpense,
      reason:
        '{"source":"eval-fixture","sourceText":"internet bill costs 75 USD per month"}',
      sourceMessageId: "eval-message:internet-bill",
    });
  }

  for (const resourceId of [
    "eval:agent:savings:bucket_contribution",
    "eval:agent:savings:split_existing_contribution",
  ]) {
    const savingsUser = userByResourceId.get(resourceId);
    if (!savingsUser) continue;

    await db.insert(savingsRules).values({
      userId: savingsUser.id,
      type: "monthly_fixed",
      amountMinor: 30_000_00,
      dayOfMonth: 6,
    });

    await db.insert(savingsBuckets).values({
      userId: savingsUser.id,
      name: resourceId.endsWith("split_existing_contribution") ? "used car" : "car",
      currentAmountMinor: 0,
      currency: "USD",
      isProtected: true,
    });
  }

  return resourceIds;
};

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

export const cleanupAgentEvalFixtures = cleanupWorkflowEvalFixtures;
