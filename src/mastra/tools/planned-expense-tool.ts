import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { mutatePlannedExpense } from "../workflows/mutate-planned-expense";

const resourceIdFromContext = (context?: ToolExecutionContext) =>
  context?.agent?.resourceId;

export const mutatePlannedExpenseTool = createTool({
  id: "mutate-planned-expense",
  description:
    "Use this for planned expense operations: create a plan, update it, move it to another date/month, cancel it, approve it, or mark it as paid. Returns the changed plan and forecast impact.",
  inputSchema: z.object({
    action: z.enum([
      "create",
      "update",
      "move",
      "cancel",
      "approve",
      "mark_paid",
    ]),
    plannedExpenseId: z.string().optional(),
    name: z.string().optional(),
    newName: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().length(3).optional(),
    plannedFor: z.string().optional().describe("YYYY-MM or ISO date"),
    priority: z.enum(["must", "should", "nice_to_have"]).optional(),
    horizonMonths: z.number().int().min(1).max(24).default(6),
    reason: z.string().optional(),
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const workflow =
      context.mastra?.getWorkflow("mutatePlannedExpense") ??
      mutatePlannedExpense;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        action: input.action,
        plannedExpenseId: input.plannedExpenseId,
        name: input.name,
        newName: input.newName,
        amount: input.amount,
        currency: input.currency,
        plannedFor: input.plannedFor,
        priority: input.priority,
        horizonMonths: input.horizonMonths ?? 6,
        reason: input.reason,
      },
    });

    if (result.status === "success") return result.result;

    return {
      ok: false,
      workflowStatus: result.status,
      message:
        result.status === "failed"
          ? result.error.message
          : "Planned expense mutation did not complete.",
    };
  },
});
