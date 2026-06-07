import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordActualExpense } from "../workflows/record-actual-expense";
import {
  latestTelegramMessageIdFromContext,
  latestUserMessageFromContext,
  resourceIdFromContext,
} from "./source-context";

export const recordActualExpenseTool = createTool({
  id: "record-actual-expense",
  description:
    "Record a real payment that already happened. It matches saved recurring/planned expenses first, reuses their amount when the user omitted it, and refuses to invent missing amounts.",
  inputSchema: z.object({
    name: z.string(),
    amount: z.number().optional(),
    currency: z.string().length(3).optional(),
    spentAt: z.string().optional(),
    note: z.string().optional(),
    confirmedCandidateId: z
      .string()
      .optional()
      .describe(
        "Use a candidate id returned by a previous needsConfirmation result, formatted as recurring_expense:<id> or planned_expense:<id>.",
      ),
    accountId: z
      .string()
      .optional()
      .describe("Use only when the user explicitly identified the account to debit."),
    accountName: z
      .string()
      .optional()
      .describe("Use only when the user explicitly identified the account to debit."),
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
    sourceMessageId: z
      .string()
      .optional()
      .describe("Only use when runtime message id is unavailable"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const workflow =
      context.mastra?.getWorkflow("recordActualExpense") ??
      recordActualExpense;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        name: input.name,
        amount: input.amount,
        currency: input.currency,
        spentAt: input.spentAt,
        note: input.note,
        confirmedCandidateId: input.confirmedCandidateId,
        accountId: input.accountId,
        accountName: input.accountName,
        sourceMessageId:
          input.sourceMessageId ?? latestTelegramMessageIdFromContext(context),
        sourceText: latestUserMessageFromContext(context),
      },
    });

    if (result.status === "success") return result.result;

    return {
      ok: false,
      workflowStatus: result.status,
      message:
        result.status === "failed"
          ? result.error.message
          : "Actual expense workflow did not complete.",
    };
  },
});
