import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { transferToSavings } from "../workflows/transfer-to-savings";

const resourceIdFromContext = (context?: ToolExecutionContext) =>
  context?.agent?.resourceId;

const latestUserMessageFromContext = (context?: ToolExecutionContext) => {
  const messages = context?.agent?.messages;
  if (!Array.isArray(messages)) return undefined;

  for (const message of [...messages].reverse()) {
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((part) => (part?.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text.length > 0) return text;
  }

  return undefined;
};

const latestTelegramMessageIdFromContext = (context?: ToolExecutionContext) => {
  const messages = context?.agent?.messages;
  if (!Array.isArray(messages)) return undefined;

  for (const message of [...messages].reverse()) {
    const metadata = message?.providerMetadata ?? message?.experimental_providerMetadata;
    const telegram = metadata?.mastra?.channels?.telegram;
    if (typeof telegram?.messageId === "string") return telegram.messageId;
  }

  return undefined;
};

export const transferToSavingsTool = createTool({
  id: "transfer-to-savings",
  description:
    "Move money into or out of protected savings buckets, spend from a bucket, or close a bucket. Use this for 'moved to savings', 'took from savings', 'bought from the envelope', and 'bucket is done' events.",
  inputSchema: z.object({
    action: z.enum([
      "transfer_to_bucket",
      "transfer_from_bucket",
      "spend_from_bucket",
      "close_bucket",
    ]),
    amount: z.number().optional(),
    currency: z.string().length(3).optional(),
    bucketId: z.string().optional(),
    bucketName: z.string().optional(),
    accountId: z.string().optional(),
    accountName: z.string().optional(),
    expenseName: z.string().optional(),
    plannedExpenseId: z.string().optional(),
    spentAt: z.string().optional(),
    asOf: z.string().optional(),
    closeBucket: z.boolean().optional(),
    confirmedBucketId: z.string().optional(),
    confirmedAccountId: z.string().optional(),
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
      context.mastra?.getWorkflow("transferToSavings") ?? transferToSavings;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        action: input.action,
        amount: input.amount,
        currency: input.currency,
        bucketId: input.bucketId,
        bucketName: input.bucketName,
        accountId: input.accountId,
        accountName: input.accountName,
        expenseName: input.expenseName,
        plannedExpenseId: input.plannedExpenseId,
        spentAt: input.spentAt,
        asOf: input.asOf,
        closeBucket: input.closeBucket,
        confirmedBucketId: input.confirmedBucketId,
        confirmedAccountId: input.confirmedAccountId,
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
          : "Savings transfer workflow did not complete.",
    };
  },
});
