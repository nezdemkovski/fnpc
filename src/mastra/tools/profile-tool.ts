import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { updateProfile } from "../../profile/service";
import { resourceIdFromContext } from "./source-context";

export const updateProfileTool = createTool({
  id: "update-profile",
  description:
    "Save durable communication preferences and timezone. YNAB remains the source of truth for all financial data.",
  inputSchema: z.object({
    preferredName: z.string().optional(),
    responseLanguage: z.string().optional(),
    timezone: z.string().optional(),
    minimumComfortableReadyToAssign: z.number().min(0).optional(),
    mastraResourceId: z.string().optional(),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId) {
      return { ok: false, missingInputs: ["mastraResourceId"] };
    }
    const profile = await updateProfile({
      identity: { mastraResourceId },
      patch: {
        preferredName: input.preferredName,
        responseLanguage: input.responseLanguage,
        timezone: input.timezone,
        financialPolicy:
          input.minimumComfortableReadyToAssign === undefined
            ? undefined
            : {
                minimumComfortableReadyToAssignMilliunits: Math.round(
                  input.minimumComfortableReadyToAssign * 1000,
                ),
              },
      },
    });

    return {
      ok: true,
      profile: {
        preferredName: profile.preferredName,
        responseLanguage: profile.responseLanguage,
        timezone: profile.timezone,
        financialPolicy: profile.financialPolicy,
      },
    };
  },
});
