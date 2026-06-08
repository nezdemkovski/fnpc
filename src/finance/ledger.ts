import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { accountBalances, accounts } from "../db/schema";

export type AccountDebit = {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  previousBalanceMinor: number;
  adjustedBalanceMinor: number;
};

export type ResolveAccountDebitResult =
  | { ok: true; debit: AccountDebit }
  | { ok: false; needsConfirmation: true; message: string };

export const resolveSingleSpendingAccountDebit = async ({
  database,
  userId,
  currency,
  amountMinor,
}: {
  database: Database;
  userId: string;
  currency: string;
  amountMinor: number;
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
  const selectedAccount = spendingAccounts.length === 1 ? spendingAccounts[0] : undefined;

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
