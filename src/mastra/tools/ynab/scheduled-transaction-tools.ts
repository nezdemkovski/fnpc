import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway } from "../../../ynab/gateway";
import { presentScheduledTransaction } from "../../../ynab/presenters";
import { executeYnabEndpoint, readOnlyAnnotations } from "./common";

export const listScheduledTransactionsTool = createTool({
  id: "list-ynab-scheduled-transactions",
  description: "List recurring and future scheduled YNAB transactions.",
  inputSchema: z.object({}),
  mcp: { annotations: readOnlyAnnotations },
  execute: () =>
    executeYnabEndpoint("scheduledTransactions.getScheduledTransactions", async () => {
      const response = await ynabGateway.getScheduledTransactions();
      return {
        serverKnowledge: response.data.server_knowledge,
        scheduledTransactions: response.data.scheduled_transactions
          .filter((transaction) => !transaction.deleted)
          .map(presentScheduledTransaction),
      };
    }),
});

export const getScheduledTransactionTool = createTool({
  id: "get-ynab-scheduled-transaction",
  description: "Get one scheduled YNAB transaction by ID.",
  inputSchema: z.object({ scheduledTransactionId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ scheduledTransactionId }) =>
    executeYnabEndpoint(
      "scheduledTransactions.getScheduledTransactionById",
      async () => {
        const response = await ynabGateway.getScheduledTransaction(
          scheduledTransactionId,
        );
        return {
          scheduledTransaction: presentScheduledTransaction(
            response.data.scheduled_transaction,
          ),
        };
      },
    ),
});
