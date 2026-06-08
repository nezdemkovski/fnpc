import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateFinancialReport } from "../workflows/generate-financial-report";
import { resourceIdFromContext } from "./source-context";

export const generateFinancialReportTool = createTool({
  id: "generate-financial-report",
  description:
    "Use this for daily, weekly, monthly, forecast, remaining-obligations, and end-of-month situation reports. It returns current balances, operating cash, protected savings, upcoming plans, forecast rows, risk months, and a per-row remaining obligation breakdown.",
  inputSchema: z.object({
    reportType: z
      .enum(["daily", "weekly", "monthly", "forecast"])
      .default("daily")
      .describe(
        'Use "monthly" for end-of-month, remaining obligations, and "what is left" questions. Use "forecast" for multi-month outlooks.',
      ),
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
      context.mastra?.getWorkflow("generateFinancialReport") ??
      generateFinancialReport;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        reportType: input.reportType ?? "daily",
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
          : "Financial report generation did not complete.",
    };
  },
});
