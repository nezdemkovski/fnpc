import type { MastraDBMessage } from "@mastra/core/agent";
import { currentDateKey, currentMonthKey } from "../finance/dates";
import { getOrCreateProfile } from "../profile/service";
import { getBudgetOverview, listBudgetIssues } from "../ynab/analysis";
import {
  toYnabGatewayError,
  ynabGateway,
  type YnabGateway,
} from "../ynab/gateway";

type CurrentFinancialState = {
  month: string;
  readyToAssign: string;
  issueCount: number;
  issues: ReturnType<typeof listBudgetIssues>["issues"];
  categoriesWithAvailableMoney: Array<{
    group: string;
    name: string;
    available: string;
  }>;
  scheduledNext31Days: ReturnType<
    typeof getBudgetOverview
  >["scheduledNext31Days"];
};

export type RuntimeProfile = {
  resourceId?: string;
  preferredName?: string | null;
  responseLanguage?: string | null;
  timezone?: string | null;
  financialPolicy?: Record<string, unknown>;
  ynab?: {
    status: "fresh" | "unavailable";
    connected: boolean;
    planName?: string;
    currency?: string;
    fetchedAt?: string;
    serverKnowledge?: number;
    errorCode?: string;
    currentState?: CurrentFinancialState;
  };
};

type RuntimeProfileDependencies = {
  getOrCreateProfile: typeof getOrCreateProfile;
  ynabGateway: Pick<YnabGateway, "getSnapshot">;
};

const defaultDependencies: RuntimeProfileDependencies = {
  getOrCreateProfile,
  ynabGateway,
};

export const resourceIdFromMessages = (messages: MastraDBMessage[]) =>
  [...messages].reverse().find((message) => message.resourceId)?.resourceId;

export const missingRuntimeFields = (profile: RuntimeProfile): string[] => {
  const missing: string[] = [];
  if (!profile.resourceId) missing.push("resourceId");
  if (!profile.responseLanguage) missing.push("responseLanguage");
  if (!profile.timezone) missing.push("timezone");
  if (!profile.ynab) missing.push("ynabConnection");
  return missing;
};

export const getRuntimeProfile = async (
  resourceId?: string,
  dependencies: RuntimeProfileDependencies = defaultDependencies,
): Promise<RuntimeProfile> => {
  if (!resourceId) return {};

  const profile = await dependencies.getOrCreateProfile({
    mastraResourceId: resourceId,
  });
  const timezone = profile.timezone ?? "UTC";
  const baseProfile = {
    resourceId,
    preferredName: profile.preferredName,
    responseLanguage: profile.responseLanguage,
    timezone: profile.timezone,
    financialPolicy: profile.financialPolicy,
  };

  try {
    // Refresh once before the model runs. Tools in the same turn reuse this snapshot
    // through the gateway cache instead of making duplicate YNAB requests.
    const snapshot = await dependencies.ynabGateway.getSnapshot({ force: true });
    const overview = getBudgetOverview(snapshot, { timezone });
    const issues = listBudgetIssues(snapshot, { timezone });

    return {
      ...baseProfile,
      ynab: {
        status: "fresh",
        connected: true,
        planName: snapshot.planName,
        currency: snapshot.currency.iso_code,
        fetchedAt: snapshot.fetchedAt,
        serverKnowledge: snapshot.serverKnowledge,
        currentState: {
          month: overview.month,
          readyToAssign: overview.readyToAssign.formatted,
          issueCount: issues.issueCount,
          issues: issues.issues,
          categoriesWithAvailableMoney: overview.categories
            .filter((category) => category.availableMilliunits !== 0)
            .map((category) => ({
              group: category.group,
              name: category.name,
              available: category.available,
            })),
          scheduledNext31Days: overview.scheduledNext31Days,
        },
      },
    };
  } catch (error) {
    const ynabError = toYnabGatewayError(error);
    return {
      ...baseProfile,
      ynab: {
        status: "unavailable",
        connected: false,
        errorCode: ynabError.code,
      },
    };
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
- YNAB snapshot status: ${profile.ynab?.status ?? "unknown"}
- YNAB connected: ${profile.ynab?.connected ? "yes" : "no"}
- YNAB plan: ${profile.ynab?.planName ?? "unknown"}
- YNAB currency: ${profile.ynab?.currency ?? "unknown"}
- YNAB fetched at: ${profile.ynab?.fetchedAt ?? "unavailable"}
- YNAB server knowledge: ${profile.ynab?.serverKnowledge ?? "unavailable"}
- Current financial state (authoritative for this turn): ${JSON.stringify(profile.ynab?.currentState ?? null)}
- YNAB refresh error: ${profile.ynab?.errorCode ?? "none"}
- Financial policy: ${JSON.stringify(profile.financialPolicy ?? {})}
- Missing runtime fields: ${missingFields.length > 0 ? missingFields.join(", ") : "none"}
- Onboarding complete: ${missingFields.length === 0 ? "yes" : "no"}
- Freshness rule: current financial state supersedes all numbers in conversation memory. If snapshot status is unavailable, never answer current financial questions from memory.`;
};
