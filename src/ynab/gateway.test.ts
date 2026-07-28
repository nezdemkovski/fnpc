import { describe, expect, test } from "bun:test";
import { ResponseError } from "ynab";
import { majorToMilliunits } from "../finance/money";
import { toYnabGatewayError, YnabGateway } from "./gateway";

describe("YNAB money", () => {
  test("converts major units to milliunits without cent assumptions", () => {
    expect(Number(majorToMilliunits(12.34))).toBe(12_340);
  });
});

describe("YnabGateway endpoint mapping", () => {
  test("performs fresh reads and forwards transaction filters exactly", async () => {
    const calls: Array<{ endpoint: string; args: unknown[] }> = [];
    const client = {
      plans: {},
      accounts: {
        getAccounts: async (...args: unknown[]) => {
          calls.push({ endpoint: "getAccounts", args });
          return { data: { accounts: [], server_knowledge: 1 } };
        },
      },
      categories: {},
      months: {},
      payees: {},
      scheduledTransactions: {},
      transactions: {
        getTransactions: async (...args: unknown[]) => {
          calls.push({ endpoint: "getTransactions", args });
          return { data: { transactions: [], server_knowledge: 2 } };
        },
        getTransactionsByCategory: async (...args: unknown[]) => {
          calls.push({ endpoint: "getTransactionsByCategory", args });
          return { data: { transactions: [], server_knowledge: 3 } };
        },
      },
    };
    const gateway = new YnabGateway({
      planId: "plan-1",
      client: client as never,
    });

    await gateway.getAccounts();
    await gateway.getAccounts();
    await gateway.getTransactions({
      sinceDate: "2026-07-01",
      untilDate: "2026-07-17",
      type: "unapproved",
    });
    await gateway.getCategoryTransactions("category-1", {
      sinceDate: "2026-06-01",
    });

    expect(calls).toEqual([
      { endpoint: "getAccounts", args: ["plan-1"] },
      { endpoint: "getAccounts", args: ["plan-1"] },
      {
        endpoint: "getTransactions",
        args: [
          "plan-1",
          "2026-07-01",
          "2026-07-17",
          "unapproved",
        ],
      },
      {
        endpoint: "getTransactionsByCategory",
        args: ["plan-1", "category-1", "2026-06-01", undefined, undefined],
      },
    ]);
  });

  test("maps guarded updates and deletions to the matching transaction endpoints", async () => {
    const calls: Array<{ endpoint: string; args: unknown[] }> = [];
    const client = {
      plans: {},
      accounts: {},
      categories: {},
      months: {},
      payees: {},
      scheduledTransactions: {},
      transactions: {
        updateTransaction: async (...args: unknown[]) => {
          calls.push({ endpoint: "updateTransaction", args });
          return {
            data: {
              transaction: { id: "transaction-1" },
              server_knowledge: 2,
            },
          };
        },
        deleteTransaction: async (...args: unknown[]) => {
          calls.push({ endpoint: "deleteTransaction", args });
          return {
            data: {
              transaction: { id: "transaction-1", deleted: true },
              server_knowledge: 3,
            },
          };
        },
      },
    };
    const gateway = new YnabGateway({
      planId: "plan-1",
      client: client as never,
    });

    await gateway.updateTransaction("transaction-1", {
      account_id: "account-1",
      amount: -12_340,
      payee_id: null,
      payee_name: null,
      memo: null,
    });
    await gateway.deleteTransaction("transaction-1");

    expect(calls).toEqual([
      {
        endpoint: "updateTransaction",
        args: [
          "plan-1",
          "transaction-1",
          {
            transaction: {
              account_id: "account-1",
              amount: -12_340,
              payee_id: null,
              payee_name: null,
              memo: null,
            },
          },
        ],
      },
      {
        endpoint: "deleteTransaction",
        args: ["plan-1", "transaction-1"],
      },
    ]);
  });

  test("maps SDK failures without exposing response bodies or credentials", () => {
    const error = toYnabGatewayError(
      new ResponseError(
        new Response('{"detail":"token abc123"}', { status: 401 }),
      ),
    );
    expect(error).toMatchObject({
      code: "authentication_failed",
      status: 401,
      message: "YNAB request failed: authentication_failed",
    });
    expect(error.message).not.toContain("abc123");
  });
});
