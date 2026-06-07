import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { mutateRecurringExpense } from "../workflows/mutate-recurring-expense";
import {
  latestTelegramMessageIdFromContext,
  latestUserMessageFromContext,
  resourceIdFromContext,
} from "./source-context";

export const mutateRecurringExpenseTool = createTool({
  id: "mutate-recurring-expense",
  description:
    "Use this for recurring expense operations: create a recurring expense, update amount/name/day, delete/deactivate it, or record that a saved recurring expense was paid. It matches existing recurring expenses first to avoid duplicates.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "delete", "record_payment"]),
    recurringExpenseId: z.string().optional(),
    name: z.string().optional(),
    newName: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().length(3).optional(),
    frequency: z.enum(["monthly", "weekly", "yearly"]).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    isEssential: z.boolean().optional(),
    spentAt: z.string().optional(),
    note: z.string().optional(),
    confirmedCandidateId: z
      .string()
      .optional()
      .describe(
        "Use a candidate id returned by a previous needsConfirmation result, formatted as recurring_expense:<id>.",
      ),
    horizonMonths: z.number().int().min(1).max(24).default(6),
    reason: z.string().optional(),
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
      context.mastra?.getWorkflow("mutateRecurringExpense") ??
      mutateRecurringExpense;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        action: input.action,
        recurringExpenseId: input.recurringExpenseId,
        name: input.name,
        newName: input.newName,
        amount: input.amount,
        currency: input.currency,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth,
        isEssential: input.isEssential,
        spentAt: input.spentAt,
        note: input.note,
        confirmedCandidateId: input.confirmedCandidateId,
        horizonMonths: input.horizonMonths ?? 6,
        reason: input.reason,
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
          : "Recurring expense mutation did not complete.",
    };
  },
});
