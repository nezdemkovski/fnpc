import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { updateAccountBalance } from "../workflows/update-account-balance";
import {
  latestTelegramMessageIdFromContext,
  latestUserMessageFromContext,
  resourceIdFromContext,
} from "./source-context";

export const updateAccountBalanceTool = createTool({
  id: "update-account-balance",
  description:
    "Set a reported account balance or protected savings bucket amount. Use targetType account for checking/cash/bank account balances and targetType savings_bucket for protected savings/envelopes that must be excluded from free operating cash.",
  inputSchema: z.object({
    targetType: z.enum(["account", "savings_bucket"]),
    accountId: z.string().optional(),
    accountName: z.string().optional(),
    accountType: z
      .enum(["checking", "cash", "savings", "brokerage", "crypto", "other"])
      .optional(),
    bucketId: z.string().optional(),
    bucketName: z.string().optional(),
    amount: z.number(),
    currency: z.string().length(3).optional(),
    asOf: z.string().optional(),
    isProtected: z.boolean().optional(),
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
      context.mastra?.getWorkflow("updateAccountBalance") ??
      updateAccountBalance;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        targetType: input.targetType,
        accountId: input.accountId,
        accountName: input.accountName,
        accountType: input.accountType,
        bucketId: input.bucketId,
        bucketName: input.bucketName,
        amount: input.amount,
        currency: input.currency,
        asOf: input.asOf,
        isProtected: input.isProtected,
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
          : "Account balance update did not complete.",
    };
  },
});
