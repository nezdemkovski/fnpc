import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway } from "../../../ynab/gateway";
import { presentAccount } from "../../../ynab/presenters";
import { executeYnabEndpoint, readOnlyAnnotations } from "./common";

export const listAccountsTool = createTool({
  id: "list-ynab-accounts",
  description: "List YNAB accounts with current balances and import status.",
  inputSchema: z.object({}),
  mcp: { annotations: readOnlyAnnotations },
  execute: () =>
    executeYnabEndpoint("accounts.getAccounts", async () => {
      const response = await ynabGateway.getAccounts();
      return {
        serverKnowledge: response.data.server_knowledge,
        accounts: response.data.accounts
          .filter((account) => !account.deleted)
          .map(presentAccount),
      };
    }),
});

export const getAccountTool = createTool({
  id: "get-ynab-account",
  description: "Get one YNAB account by account ID.",
  inputSchema: z.object({ accountId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ accountId }) =>
    executeYnabEndpoint("accounts.getAccountById", async () => {
      const response = await ynabGateway.getAccount(accountId);
      return { account: presentAccount(response.data.account) };
    }),
});
