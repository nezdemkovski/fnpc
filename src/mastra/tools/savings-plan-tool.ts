import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { mutateSavingsPlan } from "../workflows/mutate-savings-plan";
import { resourceIdFromContext } from "./source-context";

export const mutateSavingsPlanTool = createTool({
  id: "mutate-savings-plan",
  description:
    "Use this for savings buckets/envelopes and monthly savings contribution changes. It can create buckets, set bucket contributions, set general contributions, or reallocate an existing monthly fixed savings rule so new bucket savings do not get added on top by mistake.",
  inputSchema: z.object({
    action: z.enum([
      "create_bucket",
      "set_bucket_contribution",
      "reallocate_monthly_fixed",
      "set_general_contribution",
    ]),
    bucketName: z.string().optional(),
    targetAmount: z.number().optional(),
    currentAmount: z.number().optional(),
    monthlyAmount: z.number().optional(),
    generalMonthlyAmount: z.number().optional(),
    currency: z.string().length(3).optional(),
    isProtected: z.boolean().optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
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
      context.mastra?.getWorkflow("mutateSavingsPlan") ?? mutateSavingsPlan;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        action: input.action,
        bucketName: input.bucketName,
        targetAmount: input.targetAmount,
        currentAmount: input.currentAmount,
        monthlyAmount: input.monthlyAmount,
        generalMonthlyAmount: input.generalMonthlyAmount,
        currency: input.currency,
        isProtected: input.isProtected,
        dayOfMonth: input.dayOfMonth,
      },
    });

    if (result.status === "success") return result.result;

    return {
      ok: false,
      workflowStatus: result.status,
      message:
        result.status === "failed"
          ? result.error.message
          : "Savings plan mutation did not complete.",
    };
  },
});
