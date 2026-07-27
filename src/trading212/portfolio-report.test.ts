import { describe, expect, test } from "bun:test";
import {
  buildTrading212PortfolioReport,
  Trading212PortfolioReportService,
} from "./portfolio-report";
import type {
  Trading212AccountSummary,
  Trading212Position,
} from "./schemas";

const accountSummary: Trading212AccountSummary = {
  cash: {
    availableToTrade: 100,
    inPies: 25,
    reservedForOrders: 10,
  },
  currency: "EUR",
  id: 123,
  investments: {
    currentValue: 325,
    realizedProfitLoss: 15,
    totalCost: 260,
    unrealizedProfitLoss: 40,
  },
  totalValue: 435,
};

const positions: Trading212Position[] = [
  {
    averagePricePaid: 100,
    createdAt: "2025-01-02T03:04:05Z",
    currentPrice: 120,
    instrument: {
      currency: "USD",
      isin: "US0378331005",
      name: "Apple",
      ticker: "AAPL_US_EQ",
    },
    quantity: 2,
    quantityAvailableForTrading: 1.5,
    quantityInPies: 0.5,
    walletImpact: {
      currency: "EUR",
      currentValue: 200,
      fxImpact: 4,
      totalCost: 170,
      unrealizedProfitLoss: 30,
    },
  },
  {
    averagePricePaid: 50,
    createdAt: "2025-02-03T04:05:06Z",
    currentPrice: 60,
    instrument: {
      currency: "EUR",
      isin: "IE00B4L5Y983",
      name: "Core MSCI World",
      ticker: "SWDA_EQ",
    },
    quantity: 2,
    quantityAvailableForTrading: 2,
    quantityInPies: 0,
    walletImpact: {
      currency: "EUR",
      currentValue: 100,
      fxImpact: 0,
      totalCost: 90,
      unrealizedProfitLoss: 10,
    },
  },
];

describe("Trading212 portfolio report parity", () => {
  test("matches the folio212 portfolio JSON contract and calculations", () => {
    const report = buildTrading212PortfolioReport({
      accountSummary,
      positions: [...positions].reverse(),
      period: { from: null, to: null },
      generatedAt: new Date("2026-07-27T20:15:16Z"),
      includeRaw: false,
    });

    expect(report).toEqual({
      schemaVersion: 1,
      report: {
        reportDate: "2026-07-27",
        generatedAt: "2026-07-27T20:15:16Z",
        period: { from: null, to: null },
      },
      summary: {
        currency: "EUR",
        derived: {
          holdingsValue: 300,
          pieCash: 25,
          allocated: 325,
          freeCash: 110,
          accountTotal: 435,
          holdingsCost: 260,
          holdingsPnL: 40,
          holdingsFxImpact: 4,
          holdingsPnLExclFx: 36,
          holdingsReturnPct: 15.3846,
          holdingsReturnBps: 1538,
          twrPctEst: 15.3846,
          twrBpsEst: 1538,
          twrMethod: "holdings-only-no-flows",
          twrDescription:
            "Estimated TWR based on holdings only; excludes cash flows and pie allocations.",
        },
        snapshot: {
          apiInvestmentsValue: 325,
          apiCashInPies: 25,
          apiCashAvailable: 100,
          apiCashReserved: 10,
          apiRealizedPnL: 15,
          apiTotalCost: 260,
          apiTotalValue: 435,
        },
        reconcile: {
          allocatedDiff: 0,
          accountTotalDiff: 0,
        },
      },
      allocation: [
        {
          ticker: "AAPL_US_EQ",
          marketValue: 200,
          holdingsPct: 66.67,
          holdingsBps: 6667,
        },
        {
          ticker: "SWDA_EQ",
          marketValue: 100,
          holdingsPct: 33.33,
          holdingsBps: 3333,
        },
      ],
      holdings: [
        {
          ticker: "AAPL_US_EQ",
          name: "Apple",
          isin: "US0378331005",
          openedAt: "2025-01-02T03:04:05Z",
          qty: 2,
          tradableQty: 1.5,
          qtyInPies: 0.5,
          instrumentCurrency: "USD",
          avgPricePaid: 100,
          currentPrice: 120,
          accountCurrency: "EUR",
          invested: 170,
          marketValue: 200,
          unrealizedPnL: 30,
          fxImpact: 4,
          fxPair: "USD/EUR",
          holdingsPct: 66.67,
          holdingsBps: 6667,
        },
        {
          ticker: "SWDA_EQ",
          name: "Core MSCI World",
          isin: "IE00B4L5Y983",
          openedAt: "2025-02-03T04:05:06Z",
          qty: 2,
          tradableQty: 2,
          qtyInPies: 0,
          instrumentCurrency: "EUR",
          avgPricePaid: 50,
          currentPrice: 60,
          accountCurrency: "EUR",
          invested: 90,
          marketValue: 100,
          unrealizedPnL: 10,
          fxImpact: 0,
          holdingsPct: 33.33,
          holdingsBps: 3333,
        },
      ],
    });
  });

  test("fetches the same two sources and preserves period and raw output", async () => {
    const calls: string[] = [];
    const service = new Trading212PortfolioReportService(
      {
        getAccountSummary: async () => {
          calls.push("account");
          return accountSummary;
        },
        getPositions: async () => {
          calls.push("positions");
          return positions;
        },
      },
      () => new Date("2026-07-27T20:15:16Z"),
    );

    const report = await service.getReport({
      from: "2026-01-01",
      to: "2026-07-27",
      includeRaw: true,
    });

    expect(calls).toEqual(["account", "positions"]);
    expect(report.report.period).toEqual({
      from: "2026-01-01",
      to: "2026-07-27",
    });
    expect(report.raw).toEqual({ accountSummary, positions });
  });

  test("matches folio212 reconciliation and incomplete FX behavior", () => {
    const report = buildTrading212PortfolioReport({
      accountSummary: {
        ...accountSummary,
        investments: {
          ...accountSummary.investments,
          currentValue: 330,
        },
        totalValue: 450,
      },
      positions: [
        {
          ...positions[0],
          walletImpact: {
            ...positions[0].walletImpact,
            fxImpact: undefined,
          },
        },
      ],
      period: { from: null, to: null },
      generatedAt: new Date("2026-07-27T20:15:16Z"),
      includeRaw: false,
    });

    expect(report.summary.derived).not.toHaveProperty("holdingsFxImpact");
    expect(report.summary.derived).not.toHaveProperty("holdingsPnLExclFx");
    expect(report.summary.reconcile).toEqual({
      allocatedDiff: 105,
      accountTotalDiff: 115,
      warnings: [
        "account total does not reconcile (diff: 115.00 EUR)",
        "investments allocated does not reconcile (diff: 105.00 EUR)",
      ],
    });
  });

  test("checks reconciliation before rounding the reported difference", () => {
    const report = buildTrading212PortfolioReport({
      accountSummary: {
        ...accountSummary,
        investments: {
          ...accountSummary.investments,
          currentValue: 325.014,
        },
      },
      positions,
      period: { from: null, to: null },
      generatedAt: new Date("2026-07-27T20:15:16Z"),
      includeRaw: false,
    });

    expect(report.summary.reconcile).toEqual({
      allocatedDiff: 0.01,
      accountTotalDiff: 0,
      warnings: [
        "investments allocated does not reconcile (diff: 0.01 EUR)",
      ],
    });
  });
});
