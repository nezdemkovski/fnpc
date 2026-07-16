import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getOrCreateProfile } from "../../profile/service";
import {
  commitPreparedTransaction,
  prepareTransaction,
} from "../../ynab/transaction-service";
import { sourceContext } from "./source-context";

export const prepareTransactionTool = createTool({
  id: "prepare-transaction",
  description:
    "Validate and prepare one YNAB transaction. This does not write to YNAB; it returns a summary and confirmation token.",
  inputSchema: z.object({
    direction: z.enum(["expense", "income"]),
    amount: z.number().positive(),
    accountId: z.string().optional(),
    accountName: z.string().optional(),
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
    payeeName: z.string().trim().min(1),
    date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
    memo: z.string().max(200).optional(),
    mastraResourceId: z.string().optional(),
  }),
  mcp: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async (input, context) => {
    const source = sourceContext(context);
    const mastraResourceId =
      source.mastraResourceId ?? input.mastraResourceId;
    if (!mastraResourceId) {
      return { ok: false, missingInputs: ["mastraResourceId"] };
    }
    const profile = await getOrCreateProfile(mastraResourceId);
    if (!profile.timezone) {
      return { ok: false, missingInputs: ["timezone"] };
    }

    return prepareTransaction({
      mastraResourceId,
      sourceMessageId: source.sourceMessageId,
      timezone: profile.timezone,
      direction: input.direction,
      amount: input.amount,
      accountId: input.accountId,
      accountName: input.accountName,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      payeeName: input.payeeName,
      date: input.date,
      memo: input.memo,
    });
  },
});

export const commitTransactionTool = createTool({
  id: "commit-transaction",
  description:
    "Commit a previously prepared transaction after the user explicitly confirms its exact summary. The resulting YNAB transaction is unapproved.",
  inputSchema: z.object({
    confirmationToken: z.string().min(1),
    mastraResourceId: z.string().optional(),
  }),
  mcp: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  execute: async (input, context) => {
    const source = sourceContext(context);
    const mastraResourceId =
      source.mastraResourceId ?? input.mastraResourceId;
    if (!mastraResourceId) {
      return { ok: false, missingInputs: ["mastraResourceId"] };
    }
    return commitPreparedTransaction({
      mastraResourceId,
      confirmationToken: input.confirmationToken,
    });
  },
});
