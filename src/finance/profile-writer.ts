import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "../db/client";
import {
  accountBalances,
  accounts,
  actualExpenses,
  financialEvents,
  incomeRules,
  plannedExpenses,
  recurringExpenses,
  savingsBuckets,
  savingsRules,
} from "../db/schema";
import { normalizeCurrency, parseUserDate, safeReportedBalanceDate } from "./dates";
import { majorToMinor } from "./money";
import { getOrCreateUser, type UserIdentity } from "./profile-service";

type AccountInput = {
  name: string;
  type?: "checking" | "cash" | "savings" | "brokerage" | "crypto" | "other";
  currency?: string;
  balance?: number;
  balanceAsOf?: string;
};

type IncomeRuleInput = {
  name: string;
  amount: number;
  currency?: string;
  expectedDayFrom?: number;
  expectedDayTo?: number;
  defaultDay?: number;
};

type RecurringExpenseInput = {
  name: string;
  amount: number;
  currency?: string;
  dayOfMonth?: number;
  isEssential?: boolean;
};

type PlannedExpenseInput = {
  name: string;
  amount: number;
  currency?: string;
  plannedFor: string;
  priority?: "must" | "should" | "nice_to_have";
};

type ActualExpenseInput = {
  name: string;
  amount: number;
  currency?: string;
  spentAt?: string;
  note?: string;
};

type SavingsBucketInput = {
  name: string;
  currentAmount?: number;
  targetAmount?: number;
  currency?: string;
  isProtected?: boolean;
  priority?: number;
};

type SavingsRuleInput = {
  type: "monthly_fixed" | "percentage_of_income" | "leftover";
  amount?: number;
  percent?: number;
  dayOfMonth?: number;
  bucketName?: string;
  mode?: "create_or_update" | "replace_type" | "reallocate_type";
};

type DeleteFactInput =
  | {
      entityType: "account" | "income_rule" | "recurring_expense" | "planned_expense";
      name: string;
      reason?: string;
    }
  | {
      entityType: "savings_rule";
      ruleType: "monthly_fixed" | "percentage_of_income" | "leftover";
      reason?: string;
    };

export type FinancialFactsPatch = {
  accounts?: AccountInput[];
  incomeRules?: IncomeRuleInput[];
  recurringExpenses?: RecurringExpenseInput[];
  plannedExpenses?: PlannedExpenseInput[];
  actualExpenses?: ActualExpenseInput[];
  savingsBuckets?: SavingsBucketInput[];
  savingsRules?: SavingsRuleInput[];
  deleteFacts?: DeleteFactInput[];
};

export type SaveFinancialFactsResult = {
  userId: string;
  changed: Array<{
    entityType: string;
    entityId: string;
    name: string;
    action: "created" | "updated" | "deleted";
  }>;
};

const saveEvent = async ({
  userId,
  entityType,
  entityId,
  eventType,
  before,
  after,
  reason,
  sourceMessageId,
  database,
}: {
  userId: string;
  entityType: (typeof financialEvents.$inferInsert)["entityType"];
  entityId: string;
  eventType: (typeof financialEvents.$inferInsert)["eventType"];
  before?: unknown;
  after: unknown;
  reason?: string;
  sourceMessageId?: string;
  database: Database;
}) => {
  await database.insert(financialEvents).values({
    userId,
    entityType,
    entityId,
    eventType,
    before,
    after,
    reason,
    sourceMessageId,
  });
};

export const saveFinancialFacts = async ({
  identity,
  patch,
  sourceMessageId,
  database = db,
}: {
  identity: UserIdentity;
  patch: FinancialFactsPatch;
  sourceMessageId?: string;
  database?: Database;
}): Promise<SaveFinancialFactsResult> => {
  const user = await getOrCreateUser(identity, database);
  const changed: SaveFinancialFactsResult["changed"] = [];

  for (const input of patch.deleteFacts ?? []) {
    if (input.entityType === "account") {
      const [existing] = await database
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.name, input.name)))
        .limit(1);
      if (!existing) continue;

      const [updated] = await database
        .update(accounts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(accounts.id, existing.id))
        .returning();
      changed.push({ entityType: "account", entityId: updated.id, name: updated.name, action: "deleted" });
      await saveEvent({
        userId: user.id,
        entityType: "account",
        entityId: updated.id,
        eventType: "deleted",
        before: existing,
        after: updated,
        reason: input.reason,
        sourceMessageId,
        database,
      });
    }

    if (input.entityType === "income_rule") {
      const [existing] = await database
        .select()
        .from(incomeRules)
        .where(and(eq(incomeRules.userId, user.id), eq(incomeRules.name, input.name)))
        .limit(1);
      if (!existing) continue;

      const [updated] = await database
        .update(incomeRules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(incomeRules.id, existing.id))
        .returning();
      changed.push({ entityType: "income_rule", entityId: updated.id, name: updated.name, action: "deleted" });
      await saveEvent({
        userId: user.id,
        entityType: "income_rule",
        entityId: updated.id,
        eventType: "deleted",
        before: existing,
        after: updated,
        reason: input.reason,
        sourceMessageId,
        database,
      });
    }

    if (input.entityType === "recurring_expense") {
      const [existing] = await database
        .select()
        .from(recurringExpenses)
        .where(and(eq(recurringExpenses.userId, user.id), eq(recurringExpenses.name, input.name)))
        .limit(1);
      if (!existing) continue;

      const [updated] = await database
        .update(recurringExpenses)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(recurringExpenses.id, existing.id))
        .returning();
      changed.push({ entityType: "recurring_expense", entityId: updated.id, name: updated.name, action: "deleted" });
      await saveEvent({
        userId: user.id,
        entityType: "recurring_expense",
        entityId: updated.id,
        eventType: "deleted",
        before: existing,
        after: updated,
        reason: input.reason,
        sourceMessageId,
        database,
      });
    }

    if (input.entityType === "planned_expense") {
      const [existing] = await database
        .select()
        .from(plannedExpenses)
        .where(and(eq(plannedExpenses.userId, user.id), eq(plannedExpenses.name, input.name)))
        .limit(1);
      if (!existing) continue;

      const [updated] = await database
        .update(plannedExpenses)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(plannedExpenses.id, existing.id))
        .returning();
      changed.push({ entityType: "planned_expense", entityId: updated.id, name: updated.name, action: "deleted" });
      await saveEvent({
        userId: user.id,
        entityType: "planned_expense",
        entityId: updated.id,
        eventType: "deleted",
        before: existing,
        after: updated,
        reason: input.reason,
        sourceMessageId,
        database,
      });
    }

    if (input.entityType === "savings_rule") {
      const [existing] = await database
        .select()
        .from(savingsRules)
        .where(and(eq(savingsRules.userId, user.id), eq(savingsRules.type, input.ruleType)))
        .limit(1);
      if (!existing) continue;

      const [updated] = await database
        .update(savingsRules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(savingsRules.id, existing.id))
        .returning();
      changed.push({ entityType: "savings_rule", entityId: updated.id, name: updated.type, action: "deleted" });
      await saveEvent({
        userId: user.id,
        entityType: "savings_rule",
        entityId: updated.id,
        eventType: "deleted",
        before: existing,
        after: updated,
        reason: input.reason,
        sourceMessageId,
        database,
      });
    }
  }

  for (const input of patch.accounts ?? []) {
    const [existing] = await database
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.name, input.name)))
      .limit(1);

    const values = {
      userId: user.id,
      name: input.name,
      type: input.type ?? "checking",
      currency: normalizeCurrency(input.currency, user.defaultCurrency),
    };
    const [account] = existing
      ? await database.update(accounts).set(values).where(eq(accounts.id, existing.id)).returning()
      : await database.insert(accounts).values(values).returning();

    changed.push({ entityType: "account", entityId: account.id, name: account.name, action: existing ? "updated" : "created" });
    await saveEvent({
      userId: user.id,
      entityType: "account",
      entityId: account.id,
      eventType: existing ? "updated" : "created",
      after: account,
      sourceMessageId,
      database,
    });

    if (typeof input.balance === "number") {
      const [balance] = await database
        .insert(accountBalances)
        .values({
          accountId: account.id,
          amountMinor: majorToMinor(input.balance),
          asOf: safeReportedBalanceDate({ value: input.balanceAsOf, timezone: user.timezone }),
          source: "user_reported",
        })
        .returning();
      changed.push({ entityType: "account_balance", entityId: balance.id, name: account.name, action: "created" });
      await saveEvent({
        userId: user.id,
        entityType: "account_balance",
        entityId: balance.id,
        eventType: "created",
        after: balance,
        sourceMessageId,
        database,
      });
    }
  }

  for (const input of patch.savingsBuckets ?? []) {
    const [existing] = await database
      .select()
      .from(savingsBuckets)
      .where(and(eq(savingsBuckets.userId, user.id), eq(savingsBuckets.name, input.name)))
      .limit(1);
    const values = {
      userId: user.id,
      name: input.name,
      currentAmountMinor: majorToMinor(input.currentAmount ?? 0),
      targetAmountMinor: typeof input.targetAmount === "number" ? majorToMinor(input.targetAmount) : null,
      currency: normalizeCurrency(input.currency, user.defaultCurrency),
      isProtected: input.isProtected ?? true,
      priority: input.priority ?? 100,
    };
    const [bucket] = existing
      ? await database.update(savingsBuckets).set(values).where(eq(savingsBuckets.id, existing.id)).returning()
      : await database.insert(savingsBuckets).values(values).returning();
    changed.push({ entityType: "savings_bucket", entityId: bucket.id, name: bucket.name, action: existing ? "updated" : "created" });
    await saveEvent({
      userId: user.id,
      entityType: "savings_bucket",
      entityId: bucket.id,
      eventType: existing ? "updated" : "created",
      after: bucket,
      sourceMessageId,
      database,
    });
  }

  for (const input of patch.incomeRules ?? []) {
    const [existing] = await database
      .select()
      .from(incomeRules)
      .where(and(eq(incomeRules.userId, user.id), eq(incomeRules.name, input.name)))
      .limit(1);
    const values = {
      userId: user.id,
      name: input.name,
      amountMinor: majorToMinor(input.amount),
      currency: normalizeCurrency(input.currency, user.defaultCurrency),
      frequency: "monthly" as const,
      expectedDayFrom: input.expectedDayFrom,
      expectedDayTo: input.expectedDayTo,
      defaultDay: input.defaultDay,
      isActive: true,
    };
    const [rule] = existing
      ? await database.update(incomeRules).set(values).where(eq(incomeRules.id, existing.id)).returning()
      : await database.insert(incomeRules).values(values).returning();
    changed.push({ entityType: "income_rule", entityId: rule.id, name: rule.name, action: existing ? "updated" : "created" });
    await saveEvent({
      userId: user.id,
      entityType: "income_rule",
      entityId: rule.id,
      eventType: existing ? "updated" : "created",
      after: rule,
      sourceMessageId,
      database,
    });
  }

  for (const input of patch.recurringExpenses ?? []) {
    const [existing] = await database
      .select()
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.userId, user.id), eq(recurringExpenses.name, input.name)))
      .limit(1);
    const values = {
      userId: user.id,
      name: input.name,
      amountMinor: majorToMinor(input.amount),
      currency: normalizeCurrency(input.currency, user.defaultCurrency),
      frequency: "monthly" as const,
      dayOfMonth: input.dayOfMonth,
      isEssential: input.isEssential ?? false,
      isActive: true,
    };
    const [expense] = existing
      ? await database.update(recurringExpenses).set(values).where(eq(recurringExpenses.id, existing.id)).returning()
      : await database.insert(recurringExpenses).values(values).returning();
    changed.push({ entityType: "recurring_expense", entityId: expense.id, name: expense.name, action: existing ? "updated" : "created" });
    await saveEvent({
      userId: user.id,
      entityType: "recurring_expense",
      entityId: expense.id,
      eventType: existing ? "updated" : "created",
      after: expense,
      sourceMessageId,
      database,
    });
  }

  for (const input of patch.plannedExpenses ?? []) {
    const [existing] = await database
      .select()
      .from(plannedExpenses)
      .where(and(eq(plannedExpenses.userId, user.id), eq(plannedExpenses.name, input.name)))
      .limit(1);
    const values = {
      userId: user.id,
      name: input.name,
      amountMinor: majorToMinor(input.amount),
      currency: normalizeCurrency(input.currency, user.defaultCurrency),
      plannedFor: parseUserDate(input.plannedFor),
      priority: input.priority ?? "should",
      status: "planned" as const,
      fundingSource: "free_cash" as const,
    };
    const [expense] = existing
      ? await database.update(plannedExpenses).set(values).where(eq(plannedExpenses.id, existing.id)).returning()
      : await database.insert(plannedExpenses).values(values).returning();
    changed.push({ entityType: "planned_expense", entityId: expense.id, name: expense.name, action: existing ? "updated" : "created" });
    await saveEvent({
      userId: user.id,
      entityType: "planned_expense",
      entityId: expense.id,
      eventType: existing ? "updated" : "created",
      after: expense,
      sourceMessageId,
      database,
    });
  }

  for (const input of patch.actualExpenses ?? []) {
    const [expense] = await database
      .insert(actualExpenses)
      .values({
        userId: user.id,
        name: input.name,
        amountMinor: majorToMinor(input.amount),
        currency: normalizeCurrency(input.currency, user.defaultCurrency),
        spentAt: input.spentAt ? parseUserDate(input.spentAt) : new Date(),
        note: input.note,
      })
      .returning();
    changed.push({ entityType: "actual_expense", entityId: expense.id, name: expense.name, action: "created" });
    await saveEvent({
      userId: user.id,
      entityType: "actual_expense",
      entityId: expense.id,
      eventType: "created",
      after: expense,
      sourceMessageId,
      database,
    });
  }

  for (const input of patch.savingsRules ?? []) {
    const bucket = input.bucketName
      ? await database
          .select()
          .from(savingsBuckets)
          .where(and(eq(savingsBuckets.userId, user.id), eq(savingsBuckets.name, input.bucketName)))
          .limit(1)
          .then(([row]) => row)
      : undefined;
    const mode = input.mode ?? "create_or_update";
    if (mode === "replace_type" || mode === "reallocate_type") {
      const activeRules = await database
        .select()
        .from(savingsRules)
        .where(and(eq(savingsRules.userId, user.id), eq(savingsRules.type, input.type), eq(savingsRules.isActive, true)));

      for (const activeRule of activeRules) {
        const [updated] = await database
          .update(savingsRules)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(savingsRules.id, activeRule.id))
          .returning();
        changed.push({ entityType: "savings_rule", entityId: updated.id, name: updated.type, action: "deleted" });
        await saveEvent({
          userId: user.id,
          entityType: "savings_rule",
          entityId: updated.id,
          eventType: "deleted",
          before: activeRule,
          after: updated,
          reason: mode === "reallocate_type" ? "Reallocated savings contribution" : "Replaced savings rule",
          sourceMessageId,
          database,
        });
      }
    }

    const values = {
      userId: user.id,
      bucketId: bucket?.id,
      type: input.type,
      amountMinor: typeof input.amount === "number" ? majorToMinor(input.amount) : undefined,
      percentBps: typeof input.percent === "number" ? Math.round(input.percent * 100) : undefined,
      dayOfMonth: input.dayOfMonth,
      isActive: true,
    };
    const [existing] =
      mode === "create_or_update"
        ? await database
            .select()
            .from(savingsRules)
            .where(
              and(
                eq(savingsRules.userId, user.id),
                eq(savingsRules.type, input.type),
                bucket ? eq(savingsRules.bucketId, bucket.id) : isNull(savingsRules.bucketId),
                eq(savingsRules.isActive, true),
              ),
            )
            .limit(1)
        : [];
    const [rule] = existing
      ? await database.update(savingsRules).set({ ...values, updatedAt: new Date() }).where(eq(savingsRules.id, existing.id)).returning()
      : await database.insert(savingsRules).values(values).returning();
    changed.push({ entityType: "savings_rule", entityId: rule.id, name: input.type, action: existing ? "updated" : "created" });
    await saveEvent({
      userId: user.id,
      entityType: "savings_rule",
      entityId: rule.id,
      eventType: existing ? "updated" : "created",
      before: existing,
      after: rule,
      sourceMessageId,
      database,
    });
  }

  return { userId: user.id, changed };
};
