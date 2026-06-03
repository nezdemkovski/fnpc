import type { MastraDBMessage } from "@mastra/core/agent";

import { currentDateKey, currentMonthKey } from "../finance/dates";
import { getOrCreateUser } from "../finance/profile-service";
import { getUserProfile } from "../finance/user-preferences";

export type RuntimeProfile = {
  resourceId?: string;
  preferredName?: string | null;
  responseLanguage?: string | null;
  defaultCurrency?: string | null;
  timezone?: string | null;
};

export const resourceIdFromMessages = (messages: MastraDBMessage[]) =>
  [...messages].reverse().find((message) => message.resourceId)?.resourceId;

export const missingRuntimeFields = (profile: RuntimeProfile): string[] => {
  const missing: string[] = [];
  if (!profile.resourceId) missing.push("resourceId");
  if (!profile.responseLanguage) missing.push("responseLanguage");
  if (!profile.defaultCurrency) missing.push("defaultCurrency");
  if (!profile.timezone) missing.push("timezone");
  return missing;
};

export const getRuntimeProfile = async (resourceId?: string) => {
  if (!resourceId) return {};

  try {
    const user = await getOrCreateUser({ mastraResourceId: resourceId });
    const profile = await getUserProfile(user.id);

    return {
      resourceId,
      preferredName: profile.preferences.preferredName,
      responseLanguage: profile.preferences.responseLanguage,
      defaultCurrency: profile.user.defaultCurrency,
      timezone: profile.user.timezone,
    };
  } catch {
    return { resourceId };
  }
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
- Default currency: ${profile.defaultCurrency ?? "unknown"}
- Timezone: ${profile.timezone ?? "unknown"}
- Today in user timezone: ${today}
- Current month in user timezone: ${currentMonth}
- Missing profile fields: ${missingFields.length > 0 ? missingFields.join(", ") : "none"}
- Onboarding complete: ${missingFields.length === 0 ? "yes" : "no"}`;
};
