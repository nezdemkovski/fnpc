import { describe, expect, test } from "bun:test";
import type { PlanDetail } from "ynab";
import { ResponseError } from "ynab";
import { majorToMilliunits, milliunitsToMajor } from "../finance/money";
import {
  evaluatePurchase,
  getBudgetOverview,
  getSpendingAnalysis,
  listBudgetIssues,
} from "./analysis";
import { toYnabGatewayError, YnabGateway } from "./gateway";
import { buildYnabSnapshot } from "./snapshot";

const plan: PlanDetail = {
  id: "plan-1",
  name: "Personal",
  currency_format: {
    iso_code: "EUR",
    example_format: "123.45",
    decimal_digits: 2,
    decimal_separator: ".",
    symbol_first: true,
    group_separator: ",",
    currency_symbol: "€",
    display_symbol: true,
  },
  accounts: [
    {
      id: "account-checking",
      name: "Checking",
      type: "checking",
      on_budget: true,
      closed: false,
      balance: 250_000,
      cleared_balance: 240_000,
      uncleared_balance: 10_000,
      transfer_payee_id: "transfer-checking",
      direct_import_linked: true,
      direct_import_in_error: false,
      deleted: false,
    },
    {
      id: "account-brokerage",
      name: "Brokerage",
      type: "otherAsset",
      on_budget: false,
      closed: false,
      balance: 1_000_000,
      cleared_balance: 1_000_000,
      uncleared_balance: 0,
      transfer_payee_id: "transfer-brokerage",
      deleted: false,
    },
  ],
  category_groups: [
    {
      id: "group-needs",
      name: "Needs",
      hidden: false,
      internal: false,
      deleted: false,
    },
    {
      id: "group-fun",
      name: "Fun",
      hidden: false,
      internal: false,
      deleted: false,
    },
  ],
  categories: [],
  payees: [
    { id: "payee-shop", name: "Shop", transfer_account_id: null, deleted: false },
  ],
  months: [
    {
      month: "2026-07-01",
      income: 300_000,
      budgeted: 250_000,
      activity: -145_000,
      to_be_budgeted: 20_000,
      age_of_money: 21,
      deleted: false,
      categories: [
        {
          id: "category-rent",
          category_group_id: "group-needs",
          category_group_name: "Needs",
          name: "Rent",
          hidden: false,
          internal: false,
          budgeted: 100_000,
          activity: -100_000,
          balance: 0,
          goal_type: "NEED",
          goal_under_funded: 50_000,
          deleted: false,
        },
        {
          id: "category-fun",
          category_group_id: "group-fun",
          category_group_name: "Fun",
          name: "Games",
          hidden: false,
          internal: false,
          budgeted: 50_000,
          activity: -45_000,
          balance: 5_000,
          deleted: false,
        },
        {
          id: "category-over",
          category_group_id: "group-fun",
          category_group_name: "Fun",
          name: "Eating out",
          hidden: false,
          internal: false,
          budgeted: 20_000,
          activity: -30_000,
          balance: -10_000,
          deleted: false,
        },
      ],
    },
  ],
  transactions: [
    {
      id: "transaction-1",
      date: "2026-07-10",
      amount: -45_000,
      cleared: "cleared",
      approved: true,
      account_id: "account-checking",
      payee_id: "payee-shop",
      category_id: "category-fun",
      deleted: false,
    },
    {
      id: "transaction-2",
      date: "2026-07-12",
      amount: -10_000,
      cleared: "uncleared",
      approved: false,
      account_id: "account-checking",
      payee_id: "payee-shop",
      deleted: false,
    },
  ],
  scheduled_transactions: [
    {
      id: "scheduled-rent",
      date_first: "2026-01-20",
      date_next: "2026-07-20",
      frequency: "monthly",
      amount: -100_000,
      account_id: "account-checking",
      payee_id: "payee-shop",
      category_id: "category-rent",
      deleted: false,
    },
  ],
};

const now = new Date("2026-07-16T12:00:00Z");
const snapshot = buildYnabSnapshot({ plan, serverKnowledge: 42, now });

describe("YNAB money", () => {
  test("converts major units to milliunits without cent assumptions", () => {
    expect(Number(majorToMilliunits(12.34))).toBe(12_340);
    expect(milliunitsToMajor(12_340)).toBe(12.34);
  });
});

describe("YNAB deterministic analysis", () => {
  test("keeps account location separate from category purpose", () => {
    const overview = getBudgetOverview(snapshot, {
      timezone: "Europe/Prague",
      now,
    });
    expect(overview.readyToAssign.milliunits).toBe(20_000);
    expect(overview.totals.onBudgetBalance).toBe("€250.00");
    expect(overview.totals.trackingBalance).toBe("€1,000.00");
    expect(overview.categories.find((item) => item.name === "Games")?.available).toBe(
      "€5.00",
    );
  });

  test("finds overspending, underfunding, uncategorized, and unapproved work", () => {
    const result = listBudgetIssues(snapshot, {
      timezone: "Europe/Prague",
      now,
    });
    expect(result.issues.map((issue) => issue.type)).toEqual(
      expect.arrayContaining([
        "overspent_category",
        "underfunded_goal",
        "uncategorized_transactions",
        "unapproved_transactions",
      ]),
    );
  });

  test("aggregates spending from real outflow transactions", () => {
    const result = getSpendingAnalysis(snapshot, {
      timezone: "Europe/Prague",
      days: 30,
      now,
    });
    expect(result.totalMilliunits).toBe(55_000);
    expect(result.byPayee[0]).toMatchObject({ name: "Shop", amount: "€55.00" });
  });

  test("requires category funding rather than treating bank balance as free cash", () => {
    expect(
      evaluatePurchase(snapshot, {
        timezone: "Europe/Prague",
        amountMilliunits: 6_000,
        categoryName: "Games",
        now,
      }).verdict,
    ).toBe("fund_category_first");
    expect(
      evaluatePurchase(snapshot, {
        timezone: "Europe/Prague",
        amountMilliunits: 30_000,
        categoryName: "Games",
        now,
      }).verdict,
    ).toBe("not_affordable");
    expect(
      evaluatePurchase(snapshot, {
        timezone: "Europe/Prague",
        amountMilliunits: 1_000,
        now,
      }).verdict,
    ).toBe("needs_category");
  });
});

describe("YnabGateway", () => {
  test("caches plan reads and invalidates after a mutation", async () => {
    let reads = 0;
    let writes = 0;
    const client = {
      plans: {
        getPlanById: async () => {
          reads += 1;
          return { data: { plan, server_knowledge: reads } };
        },
      },
      transactions: {
        createTransaction: async () => {
          writes += 1;
          return {
            data: {
              transaction_ids: ["created-1"],
              server_knowledge: 99,
            },
          };
        },
      },
    };
    const gateway = new YnabGateway({
      planId: "plan-1",
      cacheTtlMs: 60_000,
      client: client as never,
    });

    await gateway.getSnapshot();
    await gateway.getSnapshot();
    expect(reads).toBe(1);
    await gateway.createTransaction({
      account_id: "account-checking",
      date: "2026-07-16",
      amount: -1_000,
    });
    expect(writes).toBe(1);
    await gateway.getSnapshot();
    expect(reads).toBe(2);
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
