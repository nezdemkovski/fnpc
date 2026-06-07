import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { evaluatePurchase } from "../workflows/evaluate-purchase";
import { resourceIdFromContext } from "./source-context";

export const evaluatePurchaseTool = createTool({
  id: "evaluate-purchase",
  description:
    "Use this for purchase decisions and what-if questions. It runs a Mastra workflow that compares the baseline forecast with a candidate purchase scenario and returns verdict, impact, and month-by-month calculations.",
  inputSchema: z.object({
    name: z.string(),
    amount: z.number(),
    plannedFor: z
      .string()
      .optional()
      .describe("YYYY-MM or ISO date. Omit when user asks about buying now."),
    horizonMonths: z.number().int().min(1).max(24).default(6),
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
      context.mastra?.getWorkflow("evaluatePurchase") ?? evaluatePurchase;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        name: input.name,
        amount: input.amount,
        plannedFor: input.plannedFor,
        horizonMonths: input.horizonMonths ?? 6,
      },
    });

    if (result.status === "success") return result.result;

    return {
      ok: false,
      workflowStatus: result.status,
      message:
        result.status === "failed"
          ? result.error.message
          : "Purchase decision workflow did not complete.",
    };
  },
});
