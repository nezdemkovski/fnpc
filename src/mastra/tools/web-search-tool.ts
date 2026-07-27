import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { env } from "../../config/env";
import { BraveSearchClient, BraveSearchError } from "../../search/brave";

const braveSearchClient = new BraveSearchClient(env.braveSearch);

export const webSearchTool = createTool({
  id: "search-web",
  description:
    "Search the public web for current external information. Never use web results as a source for YNAB balances, budget amounts, transactions, or schedules.",
  inputSchema: z.object({
    query: z.string().min(1).max(400),
  }),
  mcp: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async ({ query }) => {
    try {
      return {
        ok: true as const,
        source: "Brave Search" as const,
        fetchedAt: new Date().toISOString(),
        data: await braveSearchClient.search(query),
      };
    } catch (error) {
      const searchError =
        error instanceof BraveSearchError
          ? error
          : new BraveSearchError("search_unavailable");
      return {
        ok: false as const,
        source: "Brave Search" as const,
        error: searchError.code,
        status: searchError.status,
      };
    }
  },
});
