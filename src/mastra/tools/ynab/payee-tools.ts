import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway } from "../../../ynab/gateway";
import { presentPayee } from "../../../ynab/presenters";
import { executeYnabEndpoint, readOnlyAnnotations } from "./common";

export const listPayeesTool = createTool({
  id: "list-ynab-payees",
  description: "List YNAB payees and transfer-account links.",
  inputSchema: z.object({}),
  mcp: { annotations: readOnlyAnnotations },
  execute: () =>
    executeYnabEndpoint("payees.getPayees", async () => {
      const response = await ynabGateway.getPayees();
      return {
        serverKnowledge: response.data.server_knowledge,
        payees: response.data.payees
          .filter((payee) => !payee.deleted)
          .map(presentPayee),
      };
    }),
});

export const getPayeeTool = createTool({
  id: "get-ynab-payee",
  description: "Get one YNAB payee by payee ID.",
  inputSchema: z.object({ payeeId: z.string().min(1) }),
  mcp: { annotations: readOnlyAnnotations },
  execute: ({ payeeId }) =>
    executeYnabEndpoint("payees.getPayeeById", async () => {
      const response = await ynabGateway.getPayee(payeeId);
      return { payee: presentPayee(response.data.payee) };
    }),
});
