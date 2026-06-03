import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import {
  currentDateKey,
  currentMonthKey,
  parseUserDate,
} from "../../finance/dates";
import { formatMoney, majorToMinor } from "../../finance/money";
import {
  getFinancialSnapshot,
  getOrCreateUser,
  runForecast,
} from "../../finance/profile-service";
import {
  getUserProfile,
  updateUserPreferences,
} from "../../finance/user-preferences";
import { updateFinancialProfile } from "../workflows/update-financial-profile";
import { financialFactsPatchSchema } from "./financial-profile-schemas";

const resourceIdFromContext = (context?: ToolExecutionContext) =>
  context?.agent?.resourceId;

type ProfileSettings = {
  defaultCurrency?: string | null;
  timezone?: string | null;
};

const missingProfileSettings = (user: ProfileSettings) => {
  const missing: string[] = [];
  if (!user.defaultCurrency) missing.push("defaultCurrency");
  if (!user.timezone) missing.push("timezone");
  return missing;
};

const currentContext = (settings: ProfileSettings) => ({
  currentDate: settings.timezone ? currentDateKey(settings.timezone) : null,
  currentMonth: settings.timezone ? currentMonthKey(settings.timezone) : null,
  missingProfileFields: missingProfileSettings(settings),
});

const userPreferencesSchema = z.object({
  preferredName: z.string().optional(),
  responseLanguage: z
    .string()
    .optional()
    .describe("BCP-47 or short language code, for example en, es, de"),
  defaultCurrency: z.string().length(3).optional(),
  timezone: z.string().optional().describe("IANA timezone"),
});

export const saveFinancialFactsTool = createTool({
  id: "save-financial-facts",
  description:
    "Create, update, or deactivate the user's durable financial profile from explicit user-provided facts.",
  inputSchema: financialFactsPatchSchema.extend({
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const workflow =
      context.mastra?.getWorkflow("updateFinancialProfile") ??
      updateFinancialProfile;
    const run = await workflow.createRun({ resourceId: mastraResourceId });
    const result = await run.start({
      inputData: {
        mastraResourceId,
        accounts: input.accounts,
        incomeRules: input.incomeRules,
        recurringExpenses: input.recurringExpenses,
        plannedExpenses: input.plannedExpenses,
        actualExpenses: input.actualExpenses,
        savingsBuckets: input.savingsBuckets,
        savingsRules: input.savingsRules,
        deleteFacts: input.deleteFacts,
      },
    });

    if (result.status === "success") return result.result;

    return {
      ok: false,
      workflowStatus: result.status,
      message:
        result.status === "failed"
          ? result.error.message
          : "Financial profile update did not complete.",
    };
  },
});

export const updateUserPreferencesTool = createTool({
  id: "update-user-preferences",
  description:
    "Update durable user preferences like name, response language, default currency, and timezone.",
  inputSchema: userPreferencesSchema.extend({
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const result = await updateUserPreferences({
      identity: { mastraResourceId },
      patch: {
        preferredName: input.preferredName,
        responseLanguage: input.responseLanguage,
        defaultCurrency: input.defaultCurrency,
        timezone: input.timezone,
      },
    });

    return {
      ok: true,
      ...currentContext(result.user),
      profile: {
        displayName: result.user.displayName,
        defaultCurrency: result.user.defaultCurrency,
        timezone: result.user.timezone,
        preferences: result.preferences,
      },
    };
  },
});

export const getFinancialSnapshotTool = createTool({
  id: "get-financial-snapshot",
  description:
    "Read the user's durable financial profile and calculate current cash, protected savings, monthly income, monthly commitments, and monthly surplus.",
  inputSchema: z.object({
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const user = await getOrCreateUser({ mastraResourceId });
    const missingProfileFields = missingProfileSettings(user);
    if (missingProfileFields.length > 0) {
      const profile = await getUserProfile(user.id);
      return {
        ok: false,
        ...currentContext(user),
        missingProfileFields,
        profile: {
          displayName: profile.user.displayName,
          defaultCurrency: profile.user.defaultCurrency,
          timezone: profile.user.timezone,
          preferences: profile.preferences,
        },
        message:
          "Cannot calculate a financial snapshot until defaultCurrency and timezone are known.",
      };
    }
    const currency = user.defaultCurrency;
    const timezone = user.timezone;
    if (!currency || !timezone)
      throw new Error("Profile settings guard failed");

    const [snapshot, profile] = await Promise.all([
      getFinancialSnapshot(user.id),
      getUserProfile(user.id),
    ]);

    return {
      ok: true,
      ...currentContext(user),
      userId: user.id,
      profile: {
        displayName: profile.user.displayName,
        defaultCurrency: profile.user.defaultCurrency,
        timezone: profile.user.timezone,
        preferences: profile.preferences,
      },
      totals: snapshot.totals,
      formatted: {
        totalCash: formatMoney(snapshot.totals.totalCashMinor, currency),
        protectedSavings: formatMoney(
          snapshot.totals.protectedSavingsMinor,
          currency,
        ),
        availableOperatingCash: formatMoney(
          snapshot.totals.availableOperatingCashMinor,
          currency,
        ),
        monthlyIncome: formatMoney(
          snapshot.totals.monthlyIncomeMinor,
          currency,
        ),
        monthlyRecurringExpenses: formatMoney(
          snapshot.totals.monthlyRecurringExpensesMinor,
          currency,
        ),
        monthlySavingsContributions: formatMoney(
          snapshot.totals.monthlySavingsContributionsMinor,
          currency,
        ),
        monthlySurplus: formatMoney(
          snapshot.totals.monthlySurplusMinor,
          currency,
        ),
      },
      counts: {
        accounts: snapshot.accounts.length,
        savingsBuckets: snapshot.savingsBuckets.length,
        incomeRules: snapshot.incomeRules.length,
        recurringExpenses: snapshot.recurringExpenses.length,
        savingsRules: snapshot.savingsRules.length,
        upcomingPlannedExpenses: snapshot.upcomingPlannedExpenses.length,
      },
    };
  },
});

export const runFinancialForecastTool = createTool({
  id: "run-financial-forecast",
  description:
    "Run a deterministic forecast from the user's saved profile. Use for purchase decisions, free cash questions, and future month projections.",
  inputSchema: z.object({
    horizonMonths: z.number().int().min(1).max(24).default(6),
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const user = await getOrCreateUser({ mastraResourceId });
    const missingProfileFields = missingProfileSettings(user);
    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        ...currentContext(user),
        missingProfileFields,
        message:
          "Cannot run a forecast until defaultCurrency and timezone are known.",
      };
    }
    const currency = user.defaultCurrency;
    const timezone = user.timezone;
    if (!currency || !timezone)
      throw new Error("Profile settings guard failed");

    const forecast = await runForecast({
      userId: user.id,
      horizonMonths: input.horizonMonths ?? 6,
    });

    return {
      ok: true,
      ...currentContext(user),
      ...forecast,
      formatted: {
        minimumFreeCash: formatMoney(forecast.minimumFreeCashMinor, currency),
        rows: forecast.rows.map((row) => ({
          month: row.month,
          openingFreeCash: formatMoney(row.openingFreeCashMinor, currency),
          income: formatMoney(row.incomeMinor, currency),
          recurringExpenses: formatMoney(row.recurringExpensesMinor, currency),
          plannedExpenses: formatMoney(row.plannedExpensesMinor, currency),
          actualExpenses: formatMoney(row.actualExpensesMinor, currency),
          savingsContributions: formatMoney(
            row.savingsContributionsMinor,
            currency,
          ),
          closingFreeCash: formatMoney(row.closingFreeCashMinor, currency),
          protectedSavings: formatMoney(row.protectedSavingsMinor, currency),
          riskLevel: row.riskLevel,
        })),
      },
    };
  },
});

export const runPurchaseScenarioTool = createTool({
  id: "run-purchase-scenario",
  description:
    "Run a deterministic what-if forecast for a possible purchase without saving the purchase as a planned expense.",
  inputSchema: z.object({
    name: z.string(),
    amount: z.number(),
    plannedFor: z
      .string()
      .optional()
      .describe("YYYY-MM or ISO date. Omit when user asks about buying now."),
    horizonMonths: z.number().int().min(1).max(24).default(6),
    mastraResourceId: z
      .string()
      .optional()
      .describe("Only use when runtime resourceId is unavailable in Studio"),
  }),
  execute: async (input, context) => {
    const mastraResourceId =
      resourceIdFromContext(context) ?? input.mastraResourceId;
    if (!mastraResourceId)
      return { ok: false, missingInputs: ["mastraResourceId"] };

    const user = await getOrCreateUser({ mastraResourceId });
    const missingProfileFields = missingProfileSettings(user);
    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        ...currentContext(user),
        missingProfileFields,
        message:
          "Cannot run a purchase scenario until defaultCurrency and timezone are known.",
      };
    }
    const currency = user.defaultCurrency;
    const timezone = user.timezone;
    if (!currency || !timezone)
      throw new Error("Profile settings guard failed");

    const plannedFor = input.plannedFor ?? currentMonthKey(timezone);
    const scenarioExpense = {
      name: input.name,
      amountMinor: majorToMinor(input.amount),
      plannedFor: parseUserDate(plannedFor),
    };
    const forecast = await runForecast({
      userId: user.id,
      horizonMonths: input.horizonMonths ?? 6,
      persist: false,
      scenarioExpenses: [scenarioExpense],
    });

    return {
      ok: true,
      ...currentContext(user),
      scenario: {
        name: scenarioExpense.name,
        amount: formatMoney(scenarioExpense.amountMinor, currency),
        plannedFor,
      },
      ...forecast,
      formatted: {
        minimumFreeCash: formatMoney(forecast.minimumFreeCashMinor, currency),
        rows: forecast.rows.map((row) => ({
          month: row.month,
          openingFreeCash: formatMoney(row.openingFreeCashMinor, currency),
          income: formatMoney(row.incomeMinor, currency),
          recurringExpenses: formatMoney(row.recurringExpensesMinor, currency),
          plannedAndScenarioExpenses: formatMoney(
            row.plannedExpensesMinor,
            currency,
          ),
          actualExpenses: formatMoney(row.actualExpensesMinor, currency),
          savingsContributions: formatMoney(
            row.savingsContributionsMinor,
            currency,
          ),
          closingFreeCash: formatMoney(row.closingFreeCashMinor, currency),
          protectedSavings: formatMoney(row.protectedSavingsMinor, currency),
          riskLevel: row.riskLevel,
        })),
      },
    };
  },
});
