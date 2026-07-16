import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { majorToMilliunits } from "../../finance/money";
import { getOrCreateProfile } from "../../profile/service";
import {
  evaluatePurchase,
  getBudgetOverview,
  getSpendingAnalysis,
  listBudgetIssues,
} from "../../ynab/analysis";
import { ynabGateway } from "../../ynab/gateway";
import { resourceIdFromContext } from "./source-context";

const runtime = async (
  context: Parameters<typeof resourceIdFromContext>[0],
  explicitResourceId?: string,
) => {
  const mastraResourceId = resourceIdFromContext(context) ?? explicitResourceId;
  if (!mastraResourceId) return undefined;
  const profile = await getOrCreateProfile({ mastraResourceId });
  return {
    mastraResourceId,
    timezone: profile.timezone ?? "UTC",
    minimumReadyToAssignMilliunits:
      profile.financialPolicy.minimumComfortableReadyToAssignMilliunits ?? 0,
  };
};

const resourceInput = {
  mastraResourceId: z
    .string()
    .optional()
    .describe("Only use when runtime resourceId is unavailable in Studio"),
};

export const getBudgetOverviewTool = createTool({
  id: "get-budget-overview",
  description:
    "Read the current YNAB plan: Ready to Assign, accounts, category availability, goals, activity, and upcoming scheduled transactions.",
  inputSchema: z.object(resourceInput),
  mcp: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async (input, context) => {
    const profile = await runtime(context, input.mastraResourceId);
    if (!profile) return { ok: false, missingInputs: ["mastraResourceId"] };
    const snapshot = await ynabGateway.getSnapshot();
    return { ok: true, ...getBudgetOverview(snapshot, profile) };
  },
});

export const listBudgetIssuesTool = createTool({
  id: "list-budget-issues",
  description:
    "Find deterministic YNAB problems: overspending, underfunded goals, uncategorized or unapproved transactions, overdue scheduled transactions, and import errors.",
  inputSchema: z.object(resourceInput),
  mcp: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async (input, context) => {
    const profile = await runtime(context, input.mastraResourceId);
    if (!profile) return { ok: false, missingInputs: ["mastraResourceId"] };
    const snapshot = await ynabGateway.getSnapshot();
    return { ok: true, ...listBudgetIssues(snapshot, profile) };
  },
});

export const getSpendingAnalysisTool = createTool({
  id: "get-spending-analysis",
  description:
    "Analyze actual YNAB outflows over a selected range and group them by category, category group, and payee.",
  inputSchema: z.object({
    ...resourceInput,
    days: z.number().int().min(1).max(365).default(30),
  }),
  mcp: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async (input, context) => {
    const profile = await runtime(context, input.mastraResourceId);
    if (!profile) return { ok: false, missingInputs: ["mastraResourceId"] };
    const snapshot = await ynabGateway.getSnapshot();
    return {
      ok: true,
      ...getSpendingAnalysis(snapshot, {
        timezone: profile.timezone,
        days: input.days ?? 30,
      }),
    };
  },
});

export const evaluatePurchaseTool = createTool({
  id: "evaluate-purchase",
  description:
    "Evaluate a purchase against the selected YNAB category. Never treats account balances or Ready to Assign as automatically spendable.",
  inputSchema: z.object({
    ...resourceInput,
    amount: z.number().positive(),
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
  }),
  mcp: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async (input, context) => {
    const profile = await runtime(context, input.mastraResourceId);
    if (!profile) return { ok: false, missingInputs: ["mastraResourceId"] };
    const snapshot = await ynabGateway.getSnapshot();
    return {
      ok: true,
      ...evaluatePurchase(snapshot, {
        timezone: profile.timezone,
        amountMilliunits: majorToMilliunits(input.amount),
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        minimumReadyToAssignMilliunits:
          profile.minimumReadyToAssignMilliunits,
      }),
    };
  },
});
