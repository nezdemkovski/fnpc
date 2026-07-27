import { z } from "zod";
import { env } from "../config/env";
import {
  accountSummarySchema,
  dividendsSchema,
  exchangesSchema,
  historicalOrdersSchema,
  instrumentsSchema,
  orderResponseSchema,
  ordersSchema,
  positionsSchema,
  reportsSchema,
  requestedReportSchema,
  transactionsSchema,
  type ReportRequest,
} from "./schemas";

export type Trading212Environment = "live" | "demo";

type Trading212ErrorCode =
  | "authentication_failed"
  | "access_denied"
  | "not_found"
  | "rate_limited"
  | "trading212_unavailable"
  | "invalid_request"
  | "invalid_response";

export class Trading212GatewayError extends Error {
  constructor(
    readonly code: Trading212ErrorCode,
    readonly status?: number,
  ) {
    super(`Trading212 request failed: ${code}`);
    this.name = "Trading212GatewayError";
  }
}

export const toTrading212GatewayError = (
  error: unknown,
): Trading212GatewayError => {
  if (error instanceof Trading212GatewayError) return error;
  if (error instanceof z.ZodError) {
    return new Trading212GatewayError("invalid_response");
  }
  return new Trading212GatewayError("trading212_unavailable");
};

type QueryValue = string | number | undefined;
export type Trading212Fetch = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

export class Trading212Gateway {
  constructor(
    private readonly options: {
      apiKeyId?: string;
      secretKey?: string;
      environment?: Trading212Environment;
      fetch?: Trading212Fetch;
    },
  ) {}

  private configuration() {
    const apiKeyId = this.options.apiKeyId?.trim();
    const secretKey = this.options.secretKey?.trim();
    if (!apiKeyId) throw new Error("TRADING212_API_KEY_ID is required");
    if (!secretKey) throw new Error("TRADING212_SECRET_KEY is required");

    const environment = this.options.environment ?? "live";
    return {
      baseUrl:
        environment === "demo"
          ? "https://demo.trading212.com"
          : "https://live.trading212.com",
      authorization: `Basic ${Buffer.from(`${apiKeyId}:${secretKey}`).toString("base64")}`,
      fetch: this.options.fetch ?? fetch,
    };
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: {
      method?: "GET" | "POST";
      query?: Record<string, QueryValue>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const configuration = this.configuration();
    const url = new URL(path, configuration.baseUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    let response: Response;
    try {
      response = await configuration.fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          Authorization: configuration.authorization,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Trading212GatewayError("trading212_unavailable");
    }

    if (!response.ok) {
      const code: Trading212ErrorCode =
        response.status === 401
          ? "authentication_failed"
          : response.status === 403
            ? "access_denied"
            : response.status === 404
              ? "not_found"
              : response.status === 429
                ? "rate_limited"
                : response.status >= 500 || response.status === 408
                  ? "trading212_unavailable"
                  : "invalid_request";
      throw new Trading212GatewayError(code, response.status);
    }

    try {
      return schema.parse(await response.json());
    } catch (error) {
      throw toTrading212GatewayError(error);
    }
  }

  getAccountSummary() {
    return this.request(
      "/api/v0/equity/account/summary",
      accountSummarySchema,
    );
  }

  getPositions(ticker?: string) {
    return this.request("/api/v0/equity/positions", positionsSchema, {
      query: { ticker },
    });
  }

  getPendingOrders() {
    return this.request("/api/v0/equity/orders", ordersSchema);
  }

  getPendingOrder(orderId: number) {
    return this.request(
      `/api/v0/equity/orders/${orderId}`,
      orderResponseSchema,
    );
  }

  getHistoricalOrders(query: {
    cursor?: number;
    ticker?: string;
    limit?: number;
  }) {
    return this.request(
      "/api/v0/equity/history/orders",
      historicalOrdersSchema,
      { query },
    );
  }

  getDividends(query: {
    cursor?: number;
    ticker?: string;
    limit?: number;
  }) {
    return this.request(
      "/api/v0/equity/history/dividends",
      dividendsSchema,
      { query },
    );
  }

  getTransactions(query: {
    cursor?: string;
    time?: string;
    limit?: number;
  }) {
    return this.request(
      "/api/v0/equity/history/transactions",
      transactionsSchema,
      { query },
    );
  }

  getReports() {
    return this.request("/api/v0/equity/history/exports", reportsSchema);
  }

  requestReport(report: ReportRequest) {
    return this.request(
      "/api/v0/equity/history/exports",
      requestedReportSchema,
      { method: "POST", body: report },
    );
  }

  getInstruments() {
    return this.request(
      "/api/v0/equity/metadata/instruments",
      instrumentsSchema,
    );
  }

  getExchanges() {
    return this.request(
      "/api/v0/equity/metadata/exchanges",
      exchangesSchema,
    );
  }
}

export const trading212Gateway = new Trading212Gateway(env.trading212);
