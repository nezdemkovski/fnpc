import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { currentDateKey, currentMonthKey } from "../../finance/dates";
import { formatMoney } from "../../finance/money";
import { getFinancialSnapshot, getOrCreateUser } from "../../finance/profile-service";
import { saveFinancialFacts } from "../../finance/profile-writer";
import { financialFactsPatchSchema, needsDefaultCurrency, needsTimezone } from "../tools/financial-profile-schemas";

const changedFactSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  name: z.string(),
  action: z.enum(["created", "updated", "deleted"]),
});

const profileMutationInputSchema = financialFactsPatchSchema.extend({
  mastraResourceId: z.string(),
  sourceMessageId: z.string().optional(),
});

const profileMutationStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  message: z.string().optional(),
  requested: z.object({
    accounts: z.number(),
    incomeRules: z.number(),
    recurringExpenses: z.number(),
    plannedExpenses: z.number(),
    actualExpenses: z.number(),
    savingsBuckets: z.number(),
    savingsRules: z.number(),
    deleteFacts: z.number(),
  }),
  changed: z.array(changedFactSchema).default([]),
  snapshot: z
    .object({
      totalCashMinor: z.number(),
      protectedSavingsMinor: z.number(),
      availableOperatingCashMinor: z.number(),
      monthlyIncomeMinor: z.number(),
      monthlyRecurringExpensesMinor: z.number(),
      monthlySavingsContributionsMinor: z.number(),
      monthlySurplusMinor: z.number(),
    })
    .optional(),
  formatted: z
    .object({
      totalCash: z.string(),
      protectedSavings: z.string(),
      availableOperatingCash: z.string(),
      monthlyIncome: z.string(),
      monthlyRecurringExpenses: z.string(),
      monthlySavingsContributions: z.string(),
      monthlySurplus: z.string(),
    })
    .optional(),
});

const requestedCounts = (input: z.infer<typeof profileMutationInputSchema>) => ({
  accounts: input.accounts.length,
  incomeRules: input.incomeRules.length,
  recurringExpenses: input.recurringExpenses.length,
  plannedExpenses: input.plannedExpenses.length,
  actualExpenses: input.actualExpenses.length,
  savingsBuckets: input.savingsBuckets.length,
  savingsRules: input.savingsRules.length,
  deleteFacts: input.deleteFacts.length,
});

const missingProfileSettingsForPatch = (
  user: { defaultCurrency?: string | null; timezone?: string | null },
  input: z.infer<typeof profileMutationInputSchema>,
) => [
  ...(!user.defaultCurrency && needsDefaultCurrency(input) ? ["defaultCurrency"] : []),
  ...(!user.timezone && needsTimezone(input) ? ["timezone"] : []),
];

const loadProfileForMutationStep = createStep({
  id: "load-profile-for-mutation",
  description: "Loads the financial profile and validates settings needed to apply the requested facts.",
  inputSchema: profileMutationInputSchema,
  outputSchema: profileMutationStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({ mastraResourceId: inputData.mastraResourceId });
    const missingProfileFields = missingProfileSettingsForPatch(user, inputData);

    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        userId: user.id,
        currency: user.defaultCurrency ?? undefined,
        timezone: user.timezone ?? undefined,
        currentDate: user.timezone ? currentDateKey(user.timezone) : null,
        currentMonth: user.timezone ? currentMonthKey(user.timezone) : null,
        missingProfileFields,
        requested: requestedCounts(inputData),
        changed: [],
        message:
          "Cannot apply these financial facts yet because they depend on missing profile settings.",
      };
    }

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      userId: user.id,
      currency: user.defaultCurrency ?? undefined,
      timezone: user.timezone ?? undefined,
      currentDate: user.timezone ? currentDateKey(user.timezone) : null,
      currentMonth: user.timezone ? currentMonthKey(user.timezone) : null,
      missingProfileFields,
      requested: requestedCounts(inputData),
      changed: [],
    };
  },
});

const applyFinancialFactsStep = createStep({
  id: "apply-financial-facts",
  description: "Creates, updates, or deletes durable financial facts through the profile writer.",
  inputSchema: profileMutationStateSchema,
  outputSchema: profileMutationStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) return inputData;

    const initial = getInitData<typeof updateFinancialProfile>();
    const result = await saveFinancialFacts({
      identity: { mastraResourceId: inputData.mastraResourceId },
      sourceMessageId: initial.sourceMessageId,
      patch: {
        accounts: initial.accounts,
        incomeRules: initial.incomeRules,
        recurringExpenses: initial.recurringExpenses,
        plannedExpenses: initial.plannedExpenses,
        actualExpenses: initial.actualExpenses,
        savingsBuckets: initial.savingsBuckets,
        savingsRules: initial.savingsRules,
        deleteFacts: initial.deleteFacts,
      },
    });

    return {
      ...inputData,
      userId: result.userId,
      changed: result.changed,
    };
  },
});

const refreshProfileSnapshotStep = createStep({
  id: "refresh-profile-snapshot",
  description: "Calculates the post-change financial snapshot for immediate feedback.",
  inputSchema: profileMutationStateSchema,
  outputSchema: profileMutationStateSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return inputData;

    const snapshot = await getFinancialSnapshot(inputData.userId);

    return {
      ...inputData,
      snapshot: snapshot.totals,
      formatted: {
        totalCash: formatMoney(snapshot.totals.totalCashMinor, inputData.currency),
        protectedSavings: formatMoney(snapshot.totals.protectedSavingsMinor, inputData.currency),
        availableOperatingCash: formatMoney(snapshot.totals.availableOperatingCashMinor, inputData.currency),
        monthlyIncome: formatMoney(snapshot.totals.monthlyIncomeMinor, inputData.currency),
        monthlyRecurringExpenses: formatMoney(snapshot.totals.monthlyRecurringExpensesMinor, inputData.currency),
        monthlySavingsContributions: formatMoney(
          snapshot.totals.monthlySavingsContributionsMinor,
          inputData.currency,
        ),
        monthlySurplus: formatMoney(snapshot.totals.monthlySurplusMinor, inputData.currency),
      },
    };
  },
});

export const updateFinancialProfile = createWorkflow({
  id: "update-financial-profile",
  inputSchema: profileMutationInputSchema,
  outputSchema: profileMutationStateSchema,
})
  .then(loadProfileForMutationStep)
  .then(applyFinancialFactsStep)
  .then(refreshProfileSnapshotStep)
  .commit();
