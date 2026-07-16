import type { MastraDBMessage } from "@mastra/core/agent";
import { currentDateKey, currentMonthKey } from "../finance/dates";
import { getOrCreateProfile } from "../profile/service";
import { ynabGateway } from "../ynab/gateway";

export type RuntimeProfile = {
  resourceId?: string;
  preferredName?: string | null;
  responseLanguage?: string | null;
  timezone?: string | null;
  financialPolicy?: Record<string, unknown>;
  ynab?: {
    connected: boolean;
    planName?: string;
    currency?: string;
    fetchedAt?: string;
  };
};

export const resourceIdFromMessages = (messages: MastraDBMessage[]) =>
  [...messages].reverse().find((message) => message.resourceId)?.resourceId;

export const missingRuntimeFields = (profile: RuntimeProfile): string[] => {
  const missing: string[] = [];
  if (!profile.resourceId) missing.push("resourceId");
  if (!profile.responseLanguage) missing.push("responseLanguage");
  if (!profile.timezone) missing.push("timezone");
  if (!profile.ynab?.connected) missing.push("ynabConnection");
  return missing;
};

export const getRuntimeProfile = async (
  resourceId?: string,
): Promise<RuntimeProfile> => {
  if (!resourceId) return {};

  const profilePromise = getOrCreateProfile({ mastraResourceId: resourceId });
  const ynabPromise = ynabGateway.getSnapshot().catch(() => undefined);
  try {
    const [profile, snapshot] = await Promise.all([profilePromise, ynabPromise]);
    return {
      resourceId,
      preferredName: profile.preferredName,
      responseLanguage: profile.responseLanguage,
      timezone: profile.timezone,
      financialPolicy: profile.financialPolicy,
      ynab: snapshot
        ? {
            connected: true,
            planName: snapshot.planName,
            currency: snapshot.currency.iso_code,
            fetchedAt: snapshot.fetchedAt,
          }
        : { connected: false },
    };
  } catch {
    return { resourceId, ynab: { connected: false } };
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
- Timezone: ${profile.timezone ?? "unknown"}
- Today in user timezone: ${today}
- Current month in user timezone: ${currentMonth}
- YNAB connected: ${profile.ynab?.connected ? "yes" : "no"}
- YNAB plan: ${profile.ynab?.planName ?? "unknown"}
- YNAB currency: ${profile.ynab?.currency ?? "unknown"}
- Financial policy: ${JSON.stringify(profile.financialPolicy ?? {})}
- Missing runtime fields: ${missingFields.length > 0 ? missingFields.join(", ") : "none"}
- Onboarding complete: ${missingFields.length === 0 ? "yes" : "no"}`;
};
