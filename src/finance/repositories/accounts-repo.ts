import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { accountBalances, accounts } from "../../db/schema";

export const listActiveAccountsWithLatestBalance = async (
  database: Database,
  userId: string,
) => {
  const userAccounts = await database
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isActive, true)));

  return Promise.all(
    userAccounts.map(async (account) => {
      const [balance] = await database
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, account.id))
        .orderBy(desc(accountBalances.asOf), desc(accountBalances.createdAt))
        .limit(1);
      return { account, balance };
    }),
  );
};
