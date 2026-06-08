import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  accountBalances,
  accounts,
  actualExpenses,
  financialEvents,
  plannedExpenses,
} from "../db/schema";

export type AccountDebitPlan = {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  previousBalanceMinor: number;
  adjustedBalanceMinor: number;
};

export type RecordedAccountDebit = AccountDebitPlan & {
  accountBalanceId: string;
};

export type RecordedDebitedExpense = {
  actualExpenseId: string;
  name: string;
  amountMinor: number;
  currency: string;
  plannedExpenseId?: string;
  accountDebit: RecordedAccountDebit;
};

export type ResolveAccountDebitResult =
  | { ok: true; debit: AccountDebitPlan }
  | { ok: false; needsConfirmation: true; message: string };

export const resolveSpendingAccountDebit = async ({
  database,
  userId,
  currency,
  amountMinor,
  accountId,
  accountName,
}: {
  database: Database;
  userId: string;
  currency: string;
  amountMinor: number;
  accountId?: string;
  accountName?: string;
}): Promise<ResolveAccountDebitResult> => {
  const activeAccounts = await database
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.isActive, true),
        eq(accounts.currency, currency),
      ),
    );

  const spendingAccounts = activeAccounts.filter(
    (account) => account.type === "checking" || account.type === "cash",
  );
  const explicitAccount = accountId
    ? spendingAccounts.find((account) => account.id === accountId)
    : accountName
      ? spendingAccounts.find(
          (account) => account.name.toLowerCase() === accountName.toLowerCase(),
        )
      : undefined;

  if ((accountId || accountName) && !explicitAccount) {
    return {
      ok: false,
      needsConfirmation: true,
      message:
        "The requested account was not found among active checking/cash accounts for this currency.",
    };
  }

  const selectedAccount =
    explicitAccount ?? (spendingAccounts.length === 1 ? spendingAccounts[0] : undefined);

  if (!selectedAccount) {
    return {
      ok: false,
      needsConfirmation: true,
      message:
        spendingAccounts.length === 0
          ? "No active checking or cash account exists for this currency. Add or identify the account before recording the payment."
          : "Multiple checking/cash accounts could be debited. Confirm the account before recording the payment.",
    };
  }

  const [latestBalance] = await database
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, selectedAccount.id))
    .orderBy(desc(accountBalances.asOf), desc(accountBalances.createdAt))
    .limit(1);

  if (!latestBalance) {
    return {
      ok: false,
      needsConfirmation: true,
      message:
        "The selected account has no known balance. Set the account balance before recording payments from it.",
    };
  }

  return {
    ok: true,
    debit: {
      accountId: selectedAccount.id,
      accountName: selectedAccount.name,
      accountType: selectedAccount.type,
      currency: selectedAccount.currency,
      previousBalanceMinor: latestBalance.amountMinor,
      adjustedBalanceMinor: latestBalance.amountMinor - amountMinor,
    },
  };
};

export const resolveSingleSpendingAccountDebit = (input: {
  database: Database;
  userId: string;
  currency: string;
  amountMinor: number;
}) => resolveSpendingAccountDebit(input);

export const recordDebitedActualExpense = async ({
  database,
  userId,
  name,
  amountMinor,
  currency,
  spentAt,
  note,
  sourceMessageId,
  provenance,
  accountDebit,
  plannedExpenseId,
  relatedEvents = [],
}: {
  database: Database;
  userId: string;
  name: string;
  amountMinor: number;
  currency: string;
  spentAt: Date;
  note?: string;
  sourceMessageId?: string;
  provenance: unknown;
  accountDebit: AccountDebitPlan;
  plannedExpenseId?: string;
  relatedEvents?: Array<{
    entityType: "recurring_expense";
    entityId: string;
    eventType: "paid";
    before?: unknown;
    after: unknown;
    reason?: string;
  }>;
}): Promise<RecordedDebitedExpense> => {
  const reason = JSON.stringify(provenance);
  const { expense, balance } = await database.transaction(async (tx) => {
    const [createdExpense] = await tx
      .insert(actualExpenses)
      .values({
        userId,
        plannedExpenseId,
        accountId: accountDebit.accountId,
        name,
        amountMinor,
        currency,
        spentAt,
        source: "telegram",
        note: [note, reason].filter(Boolean).join("\n"),
      })
      .returning();

    if (plannedExpenseId) {
      await tx
        .update(plannedExpenses)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(plannedExpenses.id, plannedExpenseId));
    }

    const [createdBalance] = await tx
      .insert(accountBalances)
      .values({
        accountId: accountDebit.accountId,
        amountMinor: accountDebit.adjustedBalanceMinor,
        asOf: spentAt,
        source: "adjusted",
      })
      .returning();

    await tx.insert(financialEvents).values([
      {
        userId,
        entityType: "actual_expense",
        entityId: createdExpense.id,
        eventType: "created",
        after: createdExpense,
        reason,
        sourceMessageId,
      },
      {
        userId,
        entityType: "account_balance",
        entityId: createdBalance.id,
        eventType: "created",
        before: {
          accountId: accountDebit.accountId,
          amountMinor: accountDebit.previousBalanceMinor,
        },
        after: createdBalance,
        reason: JSON.stringify({
          source: "record-debited-actual-expense",
          actualExpenseId: createdExpense.id,
          accountName: accountDebit.accountName,
        }),
        sourceMessageId,
      },
      ...relatedEvents.map((event) => ({
        userId,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        before: event.before,
        after: event.after,
        reason: event.reason,
        sourceMessageId,
      })),
    ]);

    return { expense: createdExpense, balance: createdBalance };
  });

  return {
    actualExpenseId: expense.id,
    name: expense.name,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    plannedExpenseId,
    accountDebit: {
      ...accountDebit,
      accountBalanceId: balance.id,
    },
  };
};
