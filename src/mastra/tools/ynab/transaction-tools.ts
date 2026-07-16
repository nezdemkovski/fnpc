import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway, type TransactionQuery } from "../../../ynab/gateway";
import {
  presentTransaction,
  presentTransactionPage,
} from "../../../ynab/presenters";
import type { HybridTransaction, TransactionDetail } from "ynab";
import {
  executeYnabEndpoint,
  monthSchema,
  readOnlyAnnotations,
} from "./common";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const transactionTypeSchema = z.enum(["uncategorized", "unapproved"]);
const limitSchema = z.number().int().min(1).max(100).default(50);
const queryShape = {
  sinceDate: dateSchema.optional().describe("Inclusive YYYY-MM-DD"),
  untilDate: dateSchema.optional().describe("Inclusive YYYY-MM-DD"),
  type: transactionTypeSchema.optional(),
  limit: limitSchema,
};
const queryObject = z.object(queryShape);
const hasValidDateRange = (input: object) => {
  const sinceDate = Reflect.get(input, "sinceDate");
  const untilDate = Reflect.get(input, "untilDate");
  return (
    typeof sinceDate !== "string" ||
    typeof untilDate !== "string" ||
    sinceDate <= untilDate
  );
};
const transactionQuerySchema = <T extends z.ZodRawShape>(scope: T) =>
  queryObject.extend(scope).refine(
    hasValidDateRange,
    { message: "sinceDate must be on or before untilDate", path: ["sinceDate"] },
  );

const querySchema = transactionQuerySchema({});

const queryFrom = (input: {
  sinceDate?: string;
  untilDate?: string;
  type?: "uncategorized" | "unapproved";
}): TransactionQuery => ({
  sinceDate: input.sinceDate,
  untilDate: input.untilDate,
  type: input.type,
});

const presentResponse = (
  response: {
    data: {
      transactions: Array<TransactionDetail | HybridTransaction>;
      server_knowledge?: number;
    };
  },
  limit: number,
) => ({
  serverKnowledge: response.data.server_knowledge,
  ...presentTransactionPage(response.data.transactions, limit),
});

export const listTransactionsTool = createTool({
  id: "list-ynab-transactions",
  description: "List YNAB transactions for a date range or YNAB review state.",
  inputSchema: querySchema,
  mcp: { annotations: readOnlyAnnotations },
  execute: (input) =>
    executeYnabEndpoint("transactions.getTransactions", async () =>
      presentResponse(
        await ynabGateway.getTransactions(queryFrom(input)),
        input.limit ?? 50,
      ),
    ),
});

export const listAccountTransactionsTool = createTool({
  id: "list-ynab-account-transactions",
  description: "List YNAB transactions for one account ID.",
  inputSchema: transactionQuerySchema({ accountId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: (input) =>
    executeYnabEndpoint("transactions.getTransactionsByAccount", async () =>
      presentResponse(
        await ynabGateway.getAccountTransactions(
          input.accountId,
          queryFrom(input),
        ),
        input.limit ?? 50,
      ),
    ),
});

export const listCategoryTransactionsTool = createTool({
  id: "list-ynab-category-transactions",
  description: "List YNAB transactions for one category ID.",
  inputSchema: transactionQuerySchema({ categoryId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: (input) =>
    executeYnabEndpoint("transactions.getTransactionsByCategory", async () =>
      presentResponse(
        await ynabGateway.getCategoryTransactions(
          input.categoryId,
          queryFrom(input),
        ),
        input.limit ?? 50,
      ),
    ),
});

export const listMonthTransactionsTool = createTool({
  id: "list-ynab-month-transactions",
  description: "List YNAB transactions for one budget month.",
  inputSchema: transactionQuerySchema({ month: monthSchema }),
  mcp: { annotations: readOnlyAnnotations },
  execute: (input) =>
    executeYnabEndpoint("transactions.getTransactionsByMonth", async () =>
      presentResponse(
        await ynabGateway.getMonthTransactions(input.month, queryFrom(input)),
        input.limit ?? 50,
      ),
    ),
});

export const listPayeeTransactionsTool = createTool({
  id: "list-ynab-payee-transactions",
  description: "List YNAB transactions for one payee ID.",
  inputSchema: transactionQuerySchema({ payeeId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: (input) =>
    executeYnabEndpoint("transactions.getTransactionsByPayee", async () =>
      presentResponse(
        await ynabGateway.getPayeeTransactions(input.payeeId, queryFrom(input)),
        input.limit ?? 50,
      ),
    ),
});

export const getTransactionTool = createTool({
  id: "get-ynab-transaction",
  description: "Get one YNAB transaction by transaction ID.",
  inputSchema: z.object({ transactionId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ transactionId }) =>
    executeYnabEndpoint("transactions.getTransactionById", async () => {
      const response = await ynabGateway.getTransaction(transactionId);
      return { transaction: presentTransaction(response.data.transaction) };
    }),
});
