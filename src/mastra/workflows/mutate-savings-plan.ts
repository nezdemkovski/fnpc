import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { currentDateKey, currentMonthKey, normalizeCurrency } from "../../finance/dates";
import { formatMoney } from "../../finance/money";
import { getFinancialSnapshot, getOrCreateUser } from "../../finance/profile-service";
import { saveFinancialFacts } from "../../finance/profile-writer";

const savingsPlanActionSchema = z.enum([
  "create_bucket",
  "set_bucket_contribution",
  "reallocate_monthly_fixed",
  "set_general_contribution",
]);

const mutateSavingsPlanInputSchema = z.object({
  mastraResourceId: z.string(),
  action: savingsPlanActionSchema,
  bucketName: z.string().optional(),
  targetAmount: z.number().optional(),
  currentAmount: z.number().optional(),
  monthlyAmount: z.number().optional(),
  generalMonthlyAmount: z.number().optional(),
  currency: z.string().length(3).optional(),
  isProtected: z.boolean().optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  sourceMessageId: z.string().optional(),
});

type MutateSavingsPlanInput = z.infer<typeof mutateSavingsPlanInputSchema>;

const savingsRuleSummarySchema = z.object({
  type: z.enum(["monthly_fixed", "percentage_of_income", "leftover"]),
  amountMinor: z.number().nullable(),
  bucketName: z.string().nullable(),
});

const savingsPlanStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  action: savingsPlanActionSchema,
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  message: z.string().optional(),
  existingMonthlyFixedSavingsMinor: z.number().optional(),
  beforeMonthlySavingsContributionsMinor: z.number().optional(),
  afterMonthlySavingsContributionsMinor: z.number().optional(),
  beforeRules: z.array(savingsRuleSummarySchema).default([]),
  afterRules: z.array(savingsRuleSummarySchema).default([]),
});

const mutateSavingsPlanOutputSchema = savingsPlanStateSchema.extend({
  changed: z
    .array(
      z.object({
        entityType: z.string(),
        entityId: z.string(),
        name: z.string(),
        action: z.enum(["created", "updated", "deleted"]),
      }),
    )
    .default([]),
  formatted: z
    .object({
      existingMonthlyFixedSavings: z.string(),
      beforeMonthlySavingsContributions: z.string(),
      afterMonthlySavingsContributions: z.string(),
      bucketContribution: z.string().optional(),
      generalContribution: z.string().optional(),
    })
    .optional(),
});

const missingProfileSettings = (user: { defaultCurrency?: string | null; timezone?: string | null }) => {
  const missing: string[] = [];
  if (!user.defaultCurrency) missing.push("defaultCurrency");
  if (!user.timezone) missing.push("timezone");
  return missing;
};

const summarizeSavingsRules = (snapshot: Awaited<ReturnType<typeof getFinancialSnapshot>>) =>
  snapshot.savingsRules.map((rule) => ({
    type: rule.type,
    amountMinor: rule.amountMinor,
    bucketName: snapshot.savingsBuckets.find((bucket) => bucket.id === rule.bucketId)?.name ?? null,
  }));

const monthlyFixedTotalMinor = (snapshot: Awaited<ReturnType<typeof getFinancialSnapshot>>) =>
  snapshot.savingsRules
    .filter((rule) => rule.type === "monthly_fixed")
    .reduce((total, rule) => total + (rule.amountMinor ?? 0), 0);

const loadSavingsPlanProfileStep = createStep({
  id: "load-savings-plan-profile",
  description: "Loads profile settings and current savings rules before mutating savings plans.",
  inputSchema: mutateSavingsPlanInputSchema,
  outputSchema: savingsPlanStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({ mastraResourceId: inputData.mastraResourceId });
    const missingProfileFields = missingProfileSettings(user);

    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        action: inputData.action,
        userId: user.id,
        currentDate: user.timezone ? currentDateKey(user.timezone) : null,
        currentMonth: user.timezone ? currentMonthKey(user.timezone) : null,
        missingProfileFields,
        beforeRules: [],
        afterRules: [],
        message: "Cannot mutate savings plans until defaultCurrency and timezone are known.",
      };
    }

    if (
      (inputData.action === "create_bucket" ||
        inputData.action === "set_bucket_contribution" ||
        inputData.action === "reallocate_monthly_fixed") &&
      !inputData.bucketName
    ) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        action: inputData.action,
        userId: user.id,
        currency: user.defaultCurrency!,
        timezone: user.timezone!,
        currentDate: currentDateKey(user.timezone!),
        currentMonth: currentMonthKey(user.timezone!),
        missingProfileFields: [],
        beforeRules: [],
        afterRules: [],
        message: "This savings action requires bucketName.",
      };
    }

    if (
      (inputData.action === "set_bucket_contribution" ||
        inputData.action === "reallocate_monthly_fixed" ||
        inputData.action === "set_general_contribution") &&
      inputData.monthlyAmount === undefined
    ) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        action: inputData.action,
        userId: user.id,
        currency: user.defaultCurrency!,
        timezone: user.timezone!,
        currentDate: currentDateKey(user.timezone!),
        currentMonth: currentMonthKey(user.timezone!),
        missingProfileFields: [],
        beforeRules: [],
        afterRules: [],
        message: "This savings action requires monthlyAmount.",
      };
    }

    const snapshot = await getFinancialSnapshot(user.id);

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      action: inputData.action,
      userId: user.id,
      currency: user.defaultCurrency!,
      timezone: user.timezone!,
      currentDate: currentDateKey(user.timezone!),
      currentMonth: currentMonthKey(user.timezone!),
      missingProfileFields: [],
      existingMonthlyFixedSavingsMinor: monthlyFixedTotalMinor(snapshot),
      beforeMonthlySavingsContributionsMinor: snapshot.totals.monthlySavingsContributionsMinor,
      beforeRules: summarizeSavingsRules(snapshot),
      afterRules: [],
    };
  },
});

const applySavingsPlanMutationStep = createStep({
  id: "apply-savings-plan-mutation",
  description: "Applies a bucket or savings rule mutation with explicit replacement/reallocation semantics.",
  inputSchema: savingsPlanStateSchema,
  outputSchema: mutateSavingsPlanOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return { ...inputData, changed: [] };

    const initial = getInitData<MutateSavingsPlanInput>();
    const currency = normalizeCurrency(initial.currency, inputData.currency);
    const savingsBuckets =
      initial.bucketName && (initial.action === "create_bucket" || initial.targetAmount !== undefined || initial.currentAmount !== undefined)
        ? [
            {
              name: initial.bucketName,
              targetAmount: initial.targetAmount,
              currentAmount: initial.currentAmount,
              currency,
              isProtected: initial.isProtected ?? true,
            },
          ]
        : [];

    const savingsRules: Array<{
      type: "monthly_fixed";
      amount: number;
      bucketName?: string;
      dayOfMonth?: number;
      mode: "create_or_update" | "replace_type" | "reallocate_type";
    }> = [];

    if (initial.action === "set_bucket_contribution") {
      savingsRules.push({
        type: "monthly_fixed",
        amount: initial.monthlyAmount!,
        bucketName: initial.bucketName,
        dayOfMonth: initial.dayOfMonth,
        mode: "create_or_update",
      });
    }

    if (initial.action === "set_general_contribution") {
      savingsRules.push({
        type: "monthly_fixed",
        amount: initial.monthlyAmount!,
        dayOfMonth: initial.dayOfMonth,
        mode: "create_or_update",
      });
    }

    if (initial.action === "reallocate_monthly_fixed") {
      const existingMonthlyFixed = (inputData.existingMonthlyFixedSavingsMinor ?? 0) / 100;
      const generalMonthlyAmount = initial.generalMonthlyAmount ?? existingMonthlyFixed - initial.monthlyAmount!;

      if (generalMonthlyAmount < 0) {
        return {
          ...inputData,
          ok: false,
          changed: [],
          message:
            "Requested bucket contribution is larger than the existing monthly fixed savings contribution. Ask whether this is extra money.",
        };
      }

      savingsRules.push({
        type: "monthly_fixed",
        amount: initial.monthlyAmount!,
        bucketName: initial.bucketName,
        dayOfMonth: initial.dayOfMonth,
        mode: "reallocate_type",
      });

      if (generalMonthlyAmount > 0) {
        savingsRules.push({
          type: "monthly_fixed",
          amount: generalMonthlyAmount,
          dayOfMonth: initial.dayOfMonth,
          mode: "create_or_update",
        });
      }
    }

    const result = await saveFinancialFacts({
      identity: { mastraResourceId: inputData.mastraResourceId },
      sourceMessageId: initial.sourceMessageId,
      patch: {
        savingsBuckets,
        savingsRules,
      },
    });

    const afterSnapshot = await getFinancialSnapshot(result.userId);

    return {
      ...inputData,
      changed: result.changed,
      afterMonthlySavingsContributionsMinor: afterSnapshot.totals.monthlySavingsContributionsMinor,
      afterRules: summarizeSavingsRules(afterSnapshot),
    };
  },
});

const buildSavingsPlanMutationResultStep = createStep({
  id: "build-savings-plan-mutation-result",
  description: "Formats savings mutation result and contribution totals.",
  inputSchema: mutateSavingsPlanOutputSchema,
  outputSchema: mutateSavingsPlanOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.currency) return inputData;

    const initial = getInitData<MutateSavingsPlanInput>();
    const generalContributionMinor =
      inputData.action === "reallocate_monthly_fixed" && inputData.existingMonthlyFixedSavingsMinor !== undefined
        ? inputData.afterRules
            .filter((rule) => rule.type === "monthly_fixed" && !rule.bucketName)
            .reduce((total, rule) => total + (rule.amountMinor ?? 0), 0)
        : undefined;

    return {
      ...inputData,
      formatted: {
        existingMonthlyFixedSavings: formatMoney(inputData.existingMonthlyFixedSavingsMinor ?? 0, inputData.currency),
        beforeMonthlySavingsContributions: formatMoney(
          inputData.beforeMonthlySavingsContributionsMinor ?? 0,
          inputData.currency,
        ),
        afterMonthlySavingsContributions: formatMoney(
          inputData.afterMonthlySavingsContributionsMinor ?? 0,
          inputData.currency,
        ),
        bucketContribution:
          initial.monthlyAmount !== undefined ? formatMoney(initial.monthlyAmount * 100, inputData.currency) : undefined,
        generalContribution:
          generalContributionMinor !== undefined ? formatMoney(generalContributionMinor, inputData.currency) : undefined,
      },
    };
  },
});

export const mutateSavingsPlan = createWorkflow({
  id: "mutate-savings-plan",
  inputSchema: mutateSavingsPlanInputSchema,
  outputSchema: mutateSavingsPlanOutputSchema,
})
  .then(loadSavingsPlanProfileStep)
  .then(applySavingsPlanMutationStep)
  .then(buildSavingsPlanMutationResultStep)
  .commit();
