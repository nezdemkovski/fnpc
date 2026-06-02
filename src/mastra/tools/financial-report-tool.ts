import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { generateFinancialReport } from "../workflows/generate-financial-report";

const resourceIdFromContext = (context?: ToolExecutionContext): string | undefined => context?.agent?.resourceId;

export const generateFinancialReportTool = createTool({
  id: "generate-financial-report",
  description:
    "Use this for daily, weekly, monthly, and forecast reports. It returns current balances, operating cash, protected savings, upcoming plans, forecast rows, and risk months.",
  inputSchema: z.object({
    reportType: z.enum(["daily", "weekly", "monthly", "forecast"]).default("daily"),
    horizonMonths: z.number().int().min(1).max(24).default(6),
    mastraResourceId: z.string().optional().describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId = resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId) return { ok: false, missingInputs: ["mastraResourceId"] };

    const workflow = context.mastra?.getWorkflow("generateFinancialReport") ?? generateFinancialReport;
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
      message: result.status === "failed" ? result.error.message : "Financial report generation did not complete.",
    };
  },
});
