import { describe, expect, test } from "bun:test";
import type { Database } from "../db/client";
import { mutationAudit } from "../db/schema";
import type { YnabGateway } from "./gateway";
import {
  commitPreparedTransaction,
  commitPreparedTransactionDeletion,
  commitPreparedTransactionUpdate,
  prepareTransaction,
  prepareTransactionDeletion,
  prepareTransactionUpdate,
} from "./transaction-service";

type MutationAudit = typeof mutationAudit.$inferSelect;

const account = {
  id: "account-1",
  name: "Checking",
  type: "checking",
  on_budget: true,
  closed: false,
  balance: 100_000,
  cleared_balance: 100_000,
  uncleared_balance: 0,
  transfer_payee_id: "transfer-account-1",
  deleted: false,
};

const category = {
  id: "category-1",
  category_group_id: "group-1",
  category_group_name: "Needs",
  name: "Groceries",
  hidden: false,
  internal: false,
  budgeted: 50_000,
  activity: 0,
  balance: 50_000,
  deleted: false,
};

const currency = {
  iso_code: "EUR",
  example_format: "123.45",
  decimal_digits: 2,
  decimal_separator: ".",
  symbol_first: true,
  group_separator: ",",
  currency_symbol: "€",
  display_symbol: true,
};

const existingTransaction = {
  id: "ynab-transaction-1",
  date: "2026-07-15",
  amount: -12_340,
  memo: "Imported memo",
  cleared: "uncleared" as const,
  approved: false,
  flag_color: null,
  account_id: account.id,
  payee_id: "payee-1",
  category_id: category.id,
  import_id: "YNAB:-12340:2026-07-15:1",
  deleted: false,
  account_name: account.name,
  payee_name: "Market",
  category_name: "Needs / Groceries",
  subtransactions: [],
};

const endpointReads = {
  getAccounts: async () => ({
    data: { accounts: [account], server_knowledge: 1 },
  }),
  getMonth: async () => ({
    data: {
      month: {
        month: "2026-07-01",
        income: 0,
        budgeted: 50_000,
        activity: 0,
        to_be_budgeted: 0,
        deleted: false,
        categories: [category],
      },
    },
  }),
  getPlanSettings: async () => ({
    data: {
      settings: {
        currency_format: currency,
        date_format: { format: "MM/DD/YYYY" },
      },
    },
  }),
  getAccount: async () => ({ data: { account } }),
  getMonthCategory: async () => ({ data: { category } }),
  getTransaction: async () => ({
    data: { transaction: existingTransaction, server_knowledge: 1 },
  }),
};

class FakeDatabase {
  records: MutationAudit[] = [];

  select() {
    const database = this;
    const builder = {
      from: () => builder,
      where: () => builder,
      for: () => builder,
      limit: async () => database.records.slice(0, 1),
    };
    return builder;
  }

  insert() {
    const database = this;
    return {
      values: async (value: Omit<MutationAudit, "id" | "createdAt" | "updatedAt">) => {
        const now = new Date("2026-07-16T12:00:00.000Z");
        database.records.push({
          id: "audit-1",
          createdAt: now,
          updatedAt: now,
          ...value,
          ynabEntityType: null,
          ynabEntityId: null,
          errorCode: null,
        } as MutationAudit);
      },
    };
  }

  update() {
    const database = this;
    return {
      set: (values: Partial<MutationAudit>) => ({
        where: async () => {
          database.records[0] = { ...database.records[0], ...values };
        },
      }),
    };
  }

  async transaction<T>(callback: (transaction: FakeDatabase) => Promise<T>) {
    return callback(this);
  }
}

describe("guarded YNAB transaction writes", () => {
  test("prepares from endpoint reads, confirms, and writes unapproved once", async () => {
    const database = new FakeDatabase();
    const writes: Array<Record<string, unknown>> = [];
    const gateway = {
      ...endpointReads,
      createTransaction: async (transaction: Record<string, unknown>) => {
        writes.push(transaction);
        return {
          data: {
            transaction_ids: ["ynab-transaction-1"],
            transaction: { id: "ynab-transaction-1" },
            server_knowledge: 2,
          },
        };
      },
    };
    const now = new Date("2026-07-16T12:00:00.000Z");

    const prepared = await prepareTransaction(
      {
        mastraResourceId: "telegram:user-1",
        sourceMessageId: "message-1",
        timezone: "Europe/Prague",
        direction: "expense",
        amount: 12.34,
        accountName: "Checking",
        categoryName: "Groceries",
        payeeName: "Market",
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || !prepared.confirmationToken) throw new Error("not prepared");
    expect(database.records[0]?.request).toMatchObject({
      kind: "create",
      amountMilliunits: -12_340,
    });
    expect(database.records[0]?.safeSummary).toMatchObject({
      accountName: "Checking",
      categoryName: "Needs / Groceries",
      amount: "€12.34",
      direction: "expense",
    });

    const committed = await commitPreparedTransaction(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    expect(committed).toMatchObject({
      ok: true,
      approved: false,
      ynabTransactionId: "ynab-transaction-1",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      amount: -12_340,
      approved: false,
      account_id: "account-1",
      category_id: "category-1",
      payee_name: "Market",
    });

    const repeated = await commitPreparedTransaction(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    expect(repeated).toMatchObject({ ok: true, alreadyCommitted: true });
    expect(writes).toHaveLength(1);
  });

  test("refuses an expense without an exact category", async () => {
    const database = new FakeDatabase();
    const result = await prepareTransaction(
      {
        mastraResourceId: "telegram:user-1",
        timezone: "Europe/Prague",
        direction: "expense",
        amount: 10,
        accountName: "Checking",
        categoryName: "Made up",
        payeeName: "Market",
      },
      {
        database: database as unknown as Database,
        gateway: endpointReads as unknown as YnabGateway,
        now: new Date("2026-07-16T12:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: "expense_category_not_found_or_ambiguous",
    });
    expect(database.records).toHaveLength(0);
  });

  test("previews payee and memo removal before updating exactly once", async () => {
    const database = new FakeDatabase();
    const updates: Array<{
      transactionId: string;
      transaction: Record<string, unknown>;
    }> = [];
    const gateway = {
      ...endpointReads,
      updateTransaction: async (
        transactionId: string,
        transaction: Record<string, unknown>,
      ) => {
        updates.push({ transactionId, transaction });
        return {
          data: {
            transaction: {
              ...existingTransaction,
              payee_id: undefined,
              payee_name: null,
              memo: undefined,
            },
            server_knowledge: 2,
          },
        };
      },
    };
    const now = new Date("2026-07-16T12:00:00.000Z");

    const prepared = await prepareTransactionUpdate(
      {
        mastraResourceId: "telegram:user-1",
        sourceMessageId: "message-update-1",
        timezone: "Europe/Prague",
        transactionId: existingTransaction.id,
        clearPayee: true,
        clearMemo: true,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );

    expect(prepared).toMatchObject({
      ok: true,
      requiresConfirmation: true,
      summary: {
        action: "update_transaction",
        transactionId: existingTransaction.id,
        changes: ["payee", "memo"],
        before: {
          payeeName: "Market",
          memo: "Imported memo",
          amount: "€12.34",
        },
        after: {
          amount: "€12.34",
        },
      },
    });
    expect(updates).toHaveLength(0);
    if (!prepared.ok || !prepared.confirmationToken) {
      throw new Error("update was not prepared");
    }

    const committed = await commitPreparedTransactionUpdate(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );

    expect(committed).toMatchObject({
      ok: true,
      alreadyCommitted: false,
      ynabTransactionId: existingTransaction.id,
    });
    expect(updates).toEqual([
      {
        transactionId: existingTransaction.id,
        transaction: expect.objectContaining({
          account_id: account.id,
          category_id: category.id,
          payee_id: null,
          payee_name: null,
          memo: null,
          amount: -12_340,
          approved: false,
        }),
      },
    ]);

    const repeated = await commitPreparedTransactionUpdate(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    expect(repeated).toMatchObject({ ok: true, alreadyCommitted: true });
    expect(updates).toHaveLength(1);
  });

  test("previews a deletion before deleting exactly once", async () => {
    const database = new FakeDatabase();
    const deletions: string[] = [];
    const gateway = {
      ...endpointReads,
      deleteTransaction: async (transactionId: string) => {
        deletions.push(transactionId);
        return {
          data: {
            transaction: { ...existingTransaction, deleted: true },
            server_knowledge: 2,
          },
        };
      },
    };
    const now = new Date("2026-07-16T12:00:00.000Z");

    const prepared = await prepareTransactionDeletion(
      {
        mastraResourceId: "telegram:user-1",
        sourceMessageId: "message-delete-1",
        transactionId: existingTransaction.id,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );

    expect(prepared).toMatchObject({
      ok: true,
      requiresConfirmation: true,
      summary: {
        action: "delete_transaction",
        transactionId: existingTransaction.id,
        transaction: {
          accountName: "Checking",
          payeeName: "Market",
          memo: "Imported memo",
          amount: "€12.34",
        },
      },
    });
    expect(deletions).toHaveLength(0);
    if (!prepared.ok || !prepared.confirmationToken) {
      throw new Error("deletion was not prepared");
    }

    const committed = await commitPreparedTransactionDeletion(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    expect(committed).toMatchObject({
      ok: true,
      alreadyCommitted: false,
      ynabTransactionId: existingTransaction.id,
    });
    expect(deletions).toEqual([existingTransaction.id]);

    const repeated = await commitPreparedTransactionDeletion(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    expect(repeated).toMatchObject({ ok: true, alreadyCommitted: true });
    expect(deletions).toHaveLength(1);
  });

  test("does not update when YNAB changed after the preview", async () => {
    const database = new FakeDatabase();
    let current = existingTransaction;
    let updateCalls = 0;
    const gateway = {
      ...endpointReads,
      getTransaction: async () => ({
        data: { transaction: current, server_knowledge: 1 },
      }),
      updateTransaction: async () => {
        updateCalls += 1;
        throw new Error("must not be called");
      },
    };
    const now = new Date("2026-07-16T12:00:00.000Z");
    const prepared = await prepareTransactionUpdate(
      {
        mastraResourceId: "telegram:user-1",
        sourceMessageId: "message-update-stale",
        timezone: "Europe/Prague",
        transactionId: existingTransaction.id,
        clearMemo: true,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );
    if (!prepared.ok || !prepared.confirmationToken) {
      throw new Error("update was not prepared");
    }
    current = { ...existingTransaction, amount: -15_000 };

    const committed = await commitPreparedTransactionUpdate(
      {
        mastraResourceId: "telegram:user-1",
        confirmationToken: prepared.confirmationToken,
      },
      {
        database: database as unknown as Database,
        gateway: gateway as unknown as YnabGateway,
        now,
      },
    );

    expect(committed).toEqual({
      ok: false,
      error: "ynab_transaction_changed",
    });
    expect(updateCalls).toBe(0);
  });
});
