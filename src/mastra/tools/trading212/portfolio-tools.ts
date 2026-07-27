import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { trading212Gateway } from "../../../trading212/gateway";
import { Trading212PortfolioReportService } from "../../../trading212/portfolio-report";
import {
  executeTrading212Endpoint,
  trading212ReadOnlyAnnotations,
} from "./common";

const portfolioReportService = new Trading212PortfolioReportService(
  trading212Gateway,
);

const reportDateSchema = z.iso.date();

const portfolioReportSchema = z
  .object({
    from: reportDateSchema.optional(),
    to: reportDateSchema.optional(),
    includeRaw: z.boolean().default(false),
  })
  .refine(
    ({ from, to }) =>
      (from === undefined && to === undefined) ||
      (from !== undefined && to !== undefined && from <= to),
    {
      message:
        "from and to must both be provided, and from must be on or before to",
      path: ["from"],
    },
  );

export const getTrading212PortfolioReportTool = createTool({
  id: "get-trading212-portfolio-report",
  description:
    "Get the complete schema-versioned Trading212 portfolio report produced by the same domain calculations as `folio212 portfolio --json`: holdings, allocation, cost basis, profit and loss, FX impact, return estimates, account totals, and reconciliation.",
  inputSchema: portfolioReportSchema,
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: (input) => portfolioReportService.getReport(input),
});

export const listTrading212PendingOrdersTool = createTool({
  id: "list-trading212-pending-orders",
  description: "List all currently active Trading212 orders.",
  inputSchema: z.object({}),
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: () =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/orders",
      () => trading212Gateway.getPendingOrders(),
    ),
});

export const getTrading212PendingOrderTool = createTool({
  id: "get-trading212-pending-order",
  description: "Get one currently active Trading212 order by order ID.",
  inputSchema: z.object({ orderId: z.number().int().positive() }),
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: ({ orderId }) =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/orders/{id}",
      () => trading212Gateway.getPendingOrder(orderId),
    ),
});
