import { describe, expect, test } from "bun:test";
import {
  toTrading212GatewayError,
  Trading212Gateway,
  type Trading212Fetch,
} from "./gateway";

const accountSummary = {
  cash: {
    availableToTrade: 100,
    inPies: 20,
    reservedForOrders: 10,
  },
  currency: "EUR",
  id: 123,
  investments: {
    currentValue: 500,
    realizedProfitLoss: 15,
    totalCost: 450,
    unrealizedProfitLoss: 50,
  },
  totalValue: 630,
};

describe("Trading212Gateway endpoint mapping", () => {
  test("maps every investment read to one official endpoint", async () => {
    const calls: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: string;
    }> = [];
    const responses = new Map<string, unknown>([
      ["/api/v0/equity/account/summary", accountSummary],
      ["/api/v0/equity/positions?ticker=AAPL_US_EQ", []],
      ["/api/v0/equity/orders", []],
      ["/api/v0/equity/orders/42", {
        createdAt: "2026-07-01T10:00:00Z",
        currency: "EUR",
        extendedHours: false,
        id: 42,
        initiatedFrom: "WEB",
        instrument: {
          currency: "USD",
          isin: "US0378331005",
          name: "Apple",
          ticker: "AAPL_US_EQ",
        },
        side: "BUY",
        status: "NEW",
        strategy: "QUANTITY",
        ticker: "AAPL_US_EQ",
        type: "MARKET",
      }],
      ["/api/v0/equity/history/orders?cursor=10&ticker=AAPL_US_EQ&limit=50", {
        items: [],
        nextPagePath: null,
      }],
      ["/api/v0/equity/history/dividends?cursor=20&limit=25", {
        items: [],
        nextPagePath: null,
      }],
      ["/api/v0/equity/history/transactions?cursor=next&time=2026-01-01T00%3A00%3A00Z&limit=30", {
        items: [],
        nextPagePath: null,
      }],
      ["/api/v0/equity/history/exports", []],
      ["/api/v0/equity/metadata/instruments", []],
      ["/api/v0/equity/metadata/exchanges", []],
    ]);
    const fetchMock: Trading212Fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({
        method: init?.method ?? "GET",
        url: `${url.pathname}${url.search}`,
        authorization: new Headers(init?.headers).get("Authorization"),
        body,
      });
      const response =
        init?.method === "POST"
          ? { reportId: 99 }
          : responses.get(`${url.pathname}${url.search}`);
      return Response.json(response);
    };
    const gateway = new Trading212Gateway({
      apiKeyId: "key-id",
      secretKey: "secret-key",
      environment: "live",
      fetch: fetchMock,
    });

    await gateway.getAccountSummary();
    await gateway.getPositions("AAPL_US_EQ");
    await gateway.getPendingOrders();
    await gateway.getPendingOrder(42);
    await gateway.getHistoricalOrders({
      cursor: 10,
      ticker: "AAPL_US_EQ",
      limit: 50,
    });
    await gateway.getDividends({ cursor: 20, limit: 25 });
    await gateway.getTransactions({
      cursor: "next",
      time: "2026-01-01T00:00:00Z",
      limit: 30,
    });
    await gateway.getReports();
    await gateway.requestReport({
      timeFrom: "2026-01-01T00:00:00Z",
      timeTo: "2026-07-01T00:00:00Z",
      dataIncluded: {
        includeDividends: true,
        includeInterest: true,
        includeOrders: true,
        includeTransactions: true,
      },
    });
    await gateway.getInstruments();
    await gateway.getExchanges();

    expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: "/api/v0/equity/account/summary" },
      {
        method: "GET",
        url: "/api/v0/equity/positions?ticker=AAPL_US_EQ",
      },
      { method: "GET", url: "/api/v0/equity/orders" },
      { method: "GET", url: "/api/v0/equity/orders/42" },
      {
        method: "GET",
        url: "/api/v0/equity/history/orders?cursor=10&ticker=AAPL_US_EQ&limit=50",
      },
      {
        method: "GET",
        url: "/api/v0/equity/history/dividends?cursor=20&limit=25",
      },
      {
        method: "GET",
        url: "/api/v0/equity/history/transactions?cursor=next&time=2026-01-01T00%3A00%3A00Z&limit=30",
      },
      { method: "GET", url: "/api/v0/equity/history/exports" },
      { method: "POST", url: "/api/v0/equity/history/exports" },
      { method: "GET", url: "/api/v0/equity/metadata/instruments" },
      { method: "GET", url: "/api/v0/equity/metadata/exchanges" },
    ]);
    expect(
      calls.every(
        ({ authorization }) =>
          authorization ===
          `Basic ${Buffer.from("key-id:secret-key").toString("base64")}`,
      ),
    ).toBe(true);
    expect(JSON.parse(calls[8]?.body ?? "{}")).toEqual({
      timeFrom: "2026-01-01T00:00:00Z",
      timeTo: "2026-07-01T00:00:00Z",
      dataIncluded: {
        includeDividends: true,
        includeInterest: true,
        includeOrders: true,
        includeTransactions: true,
      },
    });
  });

  test("normalizes provider failures without exposing response data", async () => {
    const gateway = new Trading212Gateway({
      apiKeyId: "key-id",
      secretKey: "secret-key",
      fetch: async () =>
        new Response('{"error":"secret-key is invalid"}', { status: 401 }),
    });

    const error = await gateway.getAccountSummary().catch(
      toTrading212GatewayError,
    );
    expect(error).toMatchObject({
      code: "authentication_failed",
      status: 401,
      message: "Trading212 request failed: authentication_failed",
    });
    expect(error.message).not.toContain("secret-key");
  });
});
