import { describe, expect, test } from "bun:test";
import type { Category, TransactionDetail } from "ynab";
import {
  presentCategory,
  presentTransactionPage,
} from "./presenters";

const transaction = (id: string): TransactionDetail => ({
  id,
  date: "2026-07-17",
  amount: -12_340,
  amount_formatted: "-€12.34",
  amount_currency: -12.34,
  cleared: "cleared",
  approved: true,
  account_id: "account-1",
  account_name: "Checking",
  payee_id: "payee-1",
  payee_name: "Market",
  category_id: "category-1",
  category_name: "Groceries",
  subtransactions: [],
  deleted: false,
});

describe("YNAB presenters", () => {
  test("keeps provider-formatted and exact milliunit amounts", () => {
    const result = presentTransactionPage(
      [transaction("transaction-1"), transaction("transaction-2")],
      1,
    );

    expect(result).toMatchObject({
      totalCount: 2,
      returnedCount: 1,
      truncated: true,
      transactions: [
        {
          id: "transaction-1",
          amount: {
            milliunits: -12_340,
            formatted: "-€12.34",
            currency: -12.34,
          },
        },
      ],
    });
  });

  test("preserves category funding and goal semantics", () => {
    const category: Category = {
      id: "category-1",
      category_group_id: "group-1",
      category_group_name: "Needs",
      name: "Groceries",
      hidden: false,
      internal: false,
      budgeted: 50_000,
      activity: -20_000,
      balance: 30_000,
      balance_formatted: "€30.00",
      goal_type: "NEED",
      goal_target: 60_000,
      goal_under_funded: 10_000,
      deleted: false,
    };

    expect(presentCategory(category)).toMatchObject({
      groupName: "Needs",
      available: { milliunits: 30_000, formatted: "€30.00" },
      goal: {
        type: "NEED",
        target: { milliunits: 60_000 },
        underfunded: { milliunits: 10_000 },
      },
    });
  });
});
