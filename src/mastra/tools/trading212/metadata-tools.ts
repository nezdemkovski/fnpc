import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { trading212Gateway } from "../../../trading212/gateway";
import {
  executeTrading212Endpoint,
  trading212ReadOnlyAnnotations,
} from "./common";

export const searchTrading212InstrumentsTool = createTool({
  id: "search-trading212-instruments",
  description:
    "Search Trading212 instrument metadata by ticker, name, short name, or ISIN.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(100),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: ({ query, limit }) =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/metadata/instruments",
      async () => {
        const normalizedQuery = query.toLocaleLowerCase("en");
        const instruments = await trading212Gateway.getInstruments();
        return {
          instruments: instruments
            .filter((instrument) =>
              [
                instrument.ticker,
                instrument.name,
                instrument.shortName,
                instrument.isin,
              ].some((value) =>
                value.toLocaleLowerCase("en").includes(normalizedQuery),
              ),
            )
            .slice(0, limit),
        };
      },
    ),
});

export const listTrading212ExchangesTool = createTool({
  id: "list-trading212-exchanges",
  description:
    "List Trading212 exchanges and their current working schedules.",
  inputSchema: z.object({}),
  mcp: { annotations: trading212ReadOnlyAnnotations },
  execute: () =>
    executeTrading212Endpoint(
      "GET /api/v0/equity/metadata/exchanges",
      () => trading212Gateway.getExchanges(),
    ),
});
