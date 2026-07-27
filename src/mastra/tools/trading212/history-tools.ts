import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { trading212Gateway } from "../../../trading212/gateway";
import {
  executeTrading212Endpoint,
  trading212ReadOnlyAnnotations,
  trading212ReportAnnotations,
} from "./common";

const cursorSchema = z.number().int().nonnegative();
const limitSchema = z.number().int().min(1).max(50).default(50);
const tickerSchema = z.string().trim().min(1).max(100);
const dateTimeSchema = z.string().datetime({ offset: true });

const historicalPageSchema = z.object({
  cursor: cursorSchema.optional(),
  ticker: tickerSchema.optional(),
  limit: limitSchema,
});

export const listTrading212HistoricalOrdersTool = createTool({
  id: "list-trading212-historical-orders",
  description:
    "List one cursor page of historical Trading212 orders, optionally filtered by ticker.",
  inputSchema: historicalPageSchema,
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: (input) =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/history/orders",
      () => trading212Gateway.getHistoricalOrders(input),
    ),
});

export const listTrading212DividendsTool = createTool({
  id: "list-trading212-dividends",
  description:
    "List one cursor page of paid Trading212 dividends, optionally filtered by ticker.",
  inputSchema: historicalPageSchema,
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: (input) =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/history/dividends",
      () => trading212Gateway.getDividends(input),
    ),
});

export const listTrading212TransactionsTool = createTool({
  id: "list-trading212-transactions",
  description:
    "List one cursor page of Trading212 deposits, withdrawals, fees, and transfers, optionally starting from an ISO timestamp.",
  inputSchema: z.object({
    cursor: z.string().min(1).optional(),
    time: dateTimeSchema.optional(),
    limit: limitSchema,
  }),
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: (input) =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/history/transactions",
      () => trading212Gateway.getTransactions(input),
    ),
});

export const listTrading212ReportsTool = createTool({
  id: "list-trading212-reports",
  description:
    "List requested Trading212 CSV investment reports with status and download links.",
  inputSchema: z.object({}),
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: () =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/history/exports",
      () => trading212Gateway.getReports(),
    ),
});

const reportRequestSchema = z
  .object({
    timeFrom: dateTimeSchema,
    timeTo: dateTimeSchema,
    includeDividends: z.boolean().default(true),
    includeInterest: z.boolean().default(true),
    includeOrders: z.boolean().default(true),
    includeTransactions: z.boolean().default(true),
  })
  .refine(({ timeFrom, timeTo }) => timeFrom <= timeTo, {
    message: "timeFrom must be on or before timeTo",
    path: ["timeFrom"],
  });

export const requestTrading212ReportTool = createTool({
  id: "request-trading212-report",
  description:
    "Request generation of a Trading212 CSV investment report for an explicit time range.",
  inputSchema: reportRequestSchema,
  mcp: { annotations: trading212ReportAnnotations },
  execute: ({
    timeFrom,
    timeTo,
    includeDividends,
    includeInterest,
    includeOrders,
    includeTransactions,
  }) =>
    executeTrading212Endpoint(
      "POST /api/v0/equity/history/exports",
      () =>
        trading212Gateway.requestReport({
          timeFrom,
          timeTo,
          dataIncluded: {
            includeDividends,
            includeInterest,
            includeOrders,
            includeTransactions,
          },
        }),
    ),
});
