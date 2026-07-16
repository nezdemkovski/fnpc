import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway } from "../../../ynab/gateway";
import { presentMonth } from "../../../ynab/presenters";
import {
  executeYnabEndpoint,
  monthSchema,
  readOnlyAnnotations,
} from "./common";

export const listMonthsTool = createTool({
  id: "list-ynab-months",
  description: "List YNAB budget months with monthly totals.",
  inputSchema: z.object({}),
  mcp: { annotations: readOnlyAnnotations },
  execute: () =>
    executeYnabEndpoint("months.getPlanMonths", async () => {
      const response = await ynabGateway.getMonths();
      return {
        serverKnowledge: response.data.server_knowledge,
        months: response.data.months
          .filter((month) => !month.deleted)
          .map(presentMonth),
      };
    }),
});

export const getMonthTool = createTool({
  id: "get-ynab-month",
  description: "Get one YNAB budget month with all category amounts.",
  inputSchema: z.object({ month: monthSchema }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ month }) =>
    executeYnabEndpoint("months.getPlanMonth", async () => {
      const response = await ynabGateway.getMonth(month);
      return { month: presentMonth(response.data.month) };
    }),
});
