import { describe, expect, test } from "bun:test";
import type { Database } from "../db/client";
import { mutationAudit } from "../db/schema";
import type { YnabGateway } from "./gateway";
import {
  commitPreparedTransaction,
  prepareTransaction,
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
    expect(database.records[0]?.request.amountMilliunits).toBe(-12_340);
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
});
