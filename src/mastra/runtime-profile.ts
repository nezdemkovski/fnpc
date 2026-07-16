import type { MastraDBMessage } from "@mastra/core/agent";
import { currentDateKey, currentMonthKey } from "../finance/dates";
import { getOrCreateProfile } from "../profile/service";

type RuntimeProfile = {
  resourceId?: string;
  preferredName?: string | null;
  responseLanguage?: string | null;
  timezone?: string | null;
};

type RuntimeProfileDependencies = {
  getOrCreateProfile: typeof getOrCreateProfile;
};

const defaultDependencies: RuntimeProfileDependencies = { getOrCreateProfile };

export const resourceIdFromMessages = (messages: MastraDBMessage[]) =>
  [...messages].reverse().find((message) => message.resourceId)?.resourceId;

export const missingRuntimeFields = (profile: RuntimeProfile): string[] => {
  const missing: string[] = [];
  if (!profile.resourceId) missing.push("resourceId");
  if (!profile.responseLanguage) missing.push("responseLanguage");
  if (!profile.timezone) missing.push("timezone");
  return missing;
};

export const getRuntimeProfile = async (
  resourceId?: string,
  dependencies: RuntimeProfileDependencies = defaultDependencies,
): Promise<RuntimeProfile> => {
  if (!resourceId) return {};

  const profile = await dependencies.getOrCreateProfile(resourceId);

  return {
    resourceId,
    preferredName: profile.preferredName,
    responseLanguage: profile.responseLanguage,
    timezone: profile.timezone,
  };
};

export const buildRuntimeContextMessage = (profile: RuntimeProfile) => {
  const missingFields = missingRuntimeFields(profile);
  const today = profile.timezone ? currentDateKey(profile.timezone) : "unknown";
  const currentMonth = profile.timezone
    ? currentMonthKey(profile.timezone)
    : "unknown";

  return `Runtime context:
- Resource ID: ${profile.resourceId ?? "unknown"}
- Preferred name: ${profile.preferredName ?? "unknown"}
- Response language: ${profile.responseLanguage ?? "unknown"}
- Timezone: ${profile.timezone ?? "unknown"}
- Today in user timezone: ${today}
- Current month in user timezone: ${currentMonth}
- Missing runtime fields: ${missingFields.length > 0 ? missingFields.join(", ") : "none"}
- Onboarding complete: ${missingFields.length === 0 ? "yes" : "no"}
- Data contract: no current YNAB data is preloaded. Every current financial fact must come from a YNAB endpoint tool in this turn. Conversation and long-term memory are never financial sources of truth.`;
};
