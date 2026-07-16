import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ynabGateway } from "../../../ynab/gateway";
import { executeYnabEndpoint, readOnlyAnnotations } from "./common";

export const getPlanSettingsTool = createTool({
  id: "get-ynab-plan-settings",
  description: "Get the YNAB plan currency and date formats.",
  inputSchema: z.object({}),
  mcp: { annotations: readOnlyAnnotations },
  execute: () =>
    executeYnabEndpoint("plans.getPlanSettingsById", async () => {
      const response = await ynabGateway.getPlanSettings();
      const settings = response.data.settings;
      return {
        currency: settings.currency_format,
        dateFormat: settings.date_format,
      };
    }),
});
