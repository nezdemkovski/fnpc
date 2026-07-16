import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway } from "../../../ynab/gateway";
import {
  presentCategory,
  presentCategoryGroup,
} from "../../../ynab/presenters";
import {
  executeYnabEndpoint,
  monthSchema,
  readOnlyAnnotations,
} from "./common";

export const listCategoriesTool = createTool({
  id: "list-ynab-categories",
  description: "List YNAB category groups and current-month category amounts.",
  inputSchema: z.object({}),
  mcp: { annotations: readOnlyAnnotations },
  execute: () =>
    executeYnabEndpoint("categories.getCategories", async () => {
      const response = await ynabGateway.getCategories();
      return {
        serverKnowledge: response.data.server_knowledge,
        groups: response.data.category_groups
          .filter((group) => !group.deleted)
          .map(presentCategoryGroup),
      };
    }),
});

export const getCategoryTool = createTool({
  id: "get-ynab-category",
  description: "Get one YNAB category by category ID for the current month.",
  inputSchema: z.object({ categoryId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ categoryId }) =>
    executeYnabEndpoint("categories.getCategoryById", async () => {
      const response = await ynabGateway.getCategory(categoryId);
      return { category: presentCategory(response.data.category) };
    }),
});

export const getMonthCategoryTool = createTool({
  id: "get-ynab-month-category",
  description: "Get one YNAB category by ID for a specific budget month.",
  inputSchema: z.object({
    month: monthSchema,
    categoryId: z.string().min(1),
  }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ month, categoryId }) =>
    executeYnabEndpoint("categories.getMonthCategoryById", async () => {
      const response = await ynabGateway.getMonthCategory(month, categoryId);
      return { category: presentCategory(response.data.category) };
    }),
});
