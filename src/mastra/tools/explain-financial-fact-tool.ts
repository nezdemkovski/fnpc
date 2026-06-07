import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { explainFinancialFact } from "../workflows/explain-financial-fact";

const resourceIdFromContext = (context?: ToolExecutionContext) =>
  context?.agent?.resourceId;

export const explainFinancialFactTool = createTool({
  id: "explain-financial-fact",
  description:
    "Search saved financial events, Mastra messages, and workflow snapshots to explain where a fact or number came from. Use for provenance, memory, and 'how did you calculate/why do you think that' questions.",
  inputSchema: z.object({
    query: z.string().optional(),
    entityName: z.string().optional(),
    entityType: z.string().optional(),
    amount: z.number().optional(),
    sourceMessageId: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional(),
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
      context.mastra?.getWorkflow("explainFinancialFact") ??
      explainFinancialFact;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        query: input.query,
        entityName: input.entityName,
        entityType: input.entityType,
        amount: input.amount,
        sourceMessageId: input.sourceMessageId,
        limit: input.limit,
      },
    });

    if (result.status === "success") return result.result;

    return {
      ok: false,
      workflowStatus: result.status,
      message:
        result.status === "failed"
          ? result.error.message
          : "Financial fact explanation workflow did not complete.",
    };
  },
});
