import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  currentMonthKey,
  parseUserDate,
} from "../../finance/dates";
import { formatMoney, majorToMinor } from "../../finance/money";
import {
  runForecast,
  type ForecastResult,
} from "../../finance/profile-service";
import { buildForecastImpact, loadUserContext } from "./shared";

const forecastRowSchema = z.object({
  month: z.string(),
  openingFreeCashMinor: z.number(),
  incomeMinor: z.number(),
  recurringExpensesMinor: z.number(),
  plannedExpensesMinor: z.number(),
  actualExpensesMinor: z.number(),
  savingsContributionsMinor: z.number(),
  closingFreeCashMinor: z.number(),
  protectedSavingsMinor: z.number(),
  riskLevel: z.enum(["ok", "tight", "negative"]),
  remainingObligations: z.array(
    z.object({
      kind: z.enum([
        "recurring_expense",
        "planned_expense",
        "savings_contribution",
        "scenario_expense",
      ]),
      name: z.string(),
      amountMinor: z.number(),
      dueDate: z.date().optional(),
      calculation: z.enum(["full", "prorated"]),
    }),
  ),
});

const forecastSummarySchema = z.object({
  startMonth: z.string(),
  horizonMonths: z.number(),
  minimumFreeCashMinor: z.number(),
  minimumMonth: z.string(),
  rows: z.array(forecastRowSchema),
});

const formattedForecastRowSchema = z.object({
  month: z.string(),
  openingFreeCash: z.string(),
  income: z.string(),
  recurringExpenses: z.string(),
  plannedExpenses: z.string(),
  actualExpenses: z.string(),
  savingsContributions: z.string(),
  closingFreeCash: z.string(),
  protectedSavings: z.string(),
  riskLevel: z.enum(["ok", "tight", "negative"]),
});

const purchaseDecisionDataSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  missingProfileFields: z.array(z.string()).default([]),
  message: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  scenario: z
    .object({
      name: z.string(),
      amountMinor: z.number(),
      amount: z.string(),
      plannedFor: z.string(),
    })
    .optional(),
  baseline: forecastSummarySchema.optional(),
  scenarioForecast: forecastSummarySchema.optional(),
});

const purchaseDecisionOutputSchema = purchaseDecisionDataSchema.extend({
  verdict: z.enum(["safe", "watch", "unsafe", "missing_profile"]),
  reasonCodes: z.array(z.string()),
  impact: z
    .object({
      minimumFreeCashDeltaMinor: z.number(),
      purchaseMonthClosingDeltaMinor: z.number(),
      formattedMinimumFreeCashDelta: z.string(),
      formattedPurchaseMonthClosingDelta: z.string(),
    })
    .optional(),
  formatted: z
    .object({
      baselineMinimumFreeCash: z.string(),
      scenarioMinimumFreeCash: z.string(),
      rows: z.array(
        z.object({
          month: z.string(),
          baselineClosingFreeCash: z.string(),
          scenarioClosingFreeCash: z.string(),
          delta: z.string(),
          scenarioRiskLevel: z.enum(["ok", "tight", "negative"]),
        }),
      ),
      scenarioRows: z.array(formattedForecastRowSchema),
    })
    .optional(),
});

const purchaseDecisionInputSchema = z.object({
  mastraResourceId: z.string(),
  name: z.string(),
  amount: z.number(),
  plannedFor: z
    .string()
    .optional()
    .describe("YYYY-MM or ISO date. Omit when user asks about buying now."),
  horizonMonths: z.number().int().min(1).max(24).default(6),
});

type PurchaseDecisionData = z.infer<typeof purchaseDecisionDataSchema>;
type PurchaseDecisionInput = z.infer<typeof purchaseDecisionInputSchema>;
type PurchaseDecisionOutput = z.infer<typeof purchaseDecisionOutputSchema>;

const summarizeForecast = (forecast: ForecastResult) => ({
  startMonth: forecast.startMonth,
  horizonMonths: forecast.horizonMonths,
  minimumFreeCashMinor: forecast.minimumFreeCashMinor,
  minimumMonth: forecast.minimumMonth,
  rows: forecast.rows,
});

const formatForecastRows = (forecast: ForecastResult, currency: string) =>
  forecast.rows.map((row) => ({
    month: row.month,
    openingFreeCash: formatMoney(row.openingFreeCashMinor, currency),
    income: formatMoney(row.incomeMinor, currency),
    recurringExpenses: formatMoney(row.recurringExpensesMinor, currency),
    plannedExpenses: formatMoney(row.plannedExpensesMinor, currency),
    actualExpenses: formatMoney(row.actualExpensesMinor, currency),
    savingsContributions: formatMoney(row.savingsContributionsMinor, currency),
    closingFreeCash: formatMoney(row.closingFreeCashMinor, currency),
    protectedSavings: formatMoney(row.protectedSavingsMinor, currency),
    riskLevel: row.riskLevel,
  }));

const loadPurchaseProfileStep = createStep({
  id: "load-purchase-profile",
  description:
    "Loads the user's durable profile and verifies settings required for financial calculations.",
  inputSchema: purchaseDecisionInputSchema,
  outputSchema: purchaseDecisionDataSchema,
  execute: async ({ inputData }) => {
    const context = await loadUserContext(inputData.mastraResourceId);

    if (context.missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        missingProfileFields: context.missingProfileFields,
        currentDate: context.currentDate,
        currentMonth: context.currentMonth,
        message:
          "Cannot evaluate a purchase until defaultCurrency and timezone are known.",
      };
    }

    const currency = context.currency;
    const timezone = context.timezone;
    if (!currency || !timezone)
      throw new Error("Profile settings guard failed");

    const plannedFor = inputData.plannedFor ?? currentMonthKey(timezone);
    const amountMinor = majorToMinor(inputData.amount);

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      missingProfileFields: [],
      currentDate: context.currentDate,
      currentMonth: currentMonthKey(timezone),
      userId: context.userId,
      currency,
      timezone,
      scenario: {
        name: inputData.name,
        amountMinor,
        amount: formatMoney(amountMinor, currency),
        plannedFor,
      },
    };
  },
});

const runBaselineForecastStep = createStep({
  id: "run-baseline-forecast",
  description:
    "Runs the saved-plan baseline forecast without the candidate purchase.",
  inputSchema: purchaseDecisionDataSchema,
  outputSchema: purchaseDecisionDataSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<PurchaseDecisionInput>();
    const baseline = await runForecast({
      userId: inputData.userId,
      horizonMonths: initial.horizonMonths ?? 6,
      persist: false,
    });

    return {
      ...inputData,
      baseline: summarizeForecast(baseline),
    };
  },
});

const runPurchaseScenarioForecastStep = createStep({
  id: "run-purchase-scenario-forecast",
  description:
    "Runs a what-if forecast with the candidate purchase included, without saving it.",
  inputSchema: purchaseDecisionDataSchema,
  outputSchema: purchaseDecisionDataSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.scenario)
      return inputData;

    const initial = getInitData<PurchaseDecisionInput>();
    const scenarioForecast = await runForecast({
      userId: inputData.userId,
      horizonMonths: initial.horizonMonths ?? 6,
      persist: false,
      scenarioExpenses: [
        {
          name: inputData.scenario.name,
          amountMinor: inputData.scenario.amountMinor,
          plannedFor: parseUserDate(inputData.scenario.plannedFor),
        },
      ],
    });

    return {
      ...inputData,
      scenarioForecast: summarizeForecast(scenarioForecast),
    };
  },
});

const buildPurchaseDecisionStep = createStep({
  id: "build-purchase-decision",
  description:
    "Compares baseline and what-if forecasts and returns a structured purchase decision.",
  inputSchema: purchaseDecisionDataSchema,
  outputSchema: purchaseDecisionOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok) {
      return {
        ...inputData,
        verdict: "missing_profile" as const,
        reasonCodes: ["missing_profile_settings"],
      };
    }

    if (
      !inputData.currency ||
      !inputData.baseline ||
      !inputData.scenarioForecast ||
      !inputData.scenario
    ) {
      throw new Error(
        "Purchase decision workflow reached decision step without required forecast data",
      );
    }
    const currency = inputData.currency;

    const impact = buildForecastImpact({
      before: inputData.baseline,
      after: inputData.scenarioForecast,
      currency,
    });
    const baselineByMonth = new Map(
      inputData.baseline.rows.map((row) => [row.month, row]),
    );
    const purchaseMonthScenarioRow = inputData.scenarioForecast.rows.find(
      (row) => row.month === inputData.scenario?.plannedFor.slice(0, 7),
    );
    const purchaseMonthBaselineRow = purchaseMonthScenarioRow
      ? baselineByMonth.get(purchaseMonthScenarioRow.month)
      : undefined;

    const minimumFreeCashDeltaMinor =
      impact.minimumFreeCashDeltaMinor;
    const purchaseMonthClosingDeltaMinor =
      purchaseMonthBaselineRow && purchaseMonthScenarioRow
        ? purchaseMonthScenarioRow.closingFreeCashMinor -
          purchaseMonthBaselineRow.closingFreeCashMinor
        : minimumFreeCashDeltaMinor;

    const reasonCodes: string[] = [];
    if (inputData.scenarioForecast.minimumFreeCashMinor < 0)
      reasonCodes.push("scenario_goes_negative");
    if (
      inputData.scenarioForecast.rows.some((row) => row.riskLevel === "tight")
    )
      reasonCodes.push("tight_month_exists");
    if (
      inputData.scenarioForecast.minimumFreeCashMinor <
      inputData.baseline.minimumFreeCashMinor
    ) {
      reasonCodes.push("free_cash_buffer_reduced");
    }
    if (inputData.baseline.minimumFreeCashMinor < 0)
      reasonCodes.push("baseline_already_negative");

    const verdict: PurchaseDecisionOutput["verdict"] =
      inputData.scenarioForecast.minimumFreeCashMinor < 0
        ? "unsafe"
        : reasonCodes.includes("tight_month_exists") ||
            reasonCodes.includes("baseline_already_negative")
          ? "watch"
          : "safe";

    const rows = inputData.scenarioForecast.rows.map((scenarioRow) => {
      const baselineRow = baselineByMonth.get(scenarioRow.month);
      const deltaMinor = baselineRow
        ? scenarioRow.closingFreeCashMinor - baselineRow.closingFreeCashMinor
        : scenarioRow.closingFreeCashMinor;

      return {
        month: scenarioRow.month,
        baselineClosingFreeCash: baselineRow
          ? formatMoney(baselineRow.closingFreeCashMinor, currency)
          : "n/a",
        scenarioClosingFreeCash: formatMoney(
          scenarioRow.closingFreeCashMinor,
          currency,
        ),
        delta: formatMoney(deltaMinor, currency),
        scenarioRiskLevel: scenarioRow.riskLevel,
      };
    });

    return {
      ...inputData,
      verdict,
      reasonCodes,
      impact: {
        minimumFreeCashDeltaMinor,
        purchaseMonthClosingDeltaMinor,
        formattedMinimumFreeCashDelta: impact.formattedMinimumFreeCashDelta,
        formattedPurchaseMonthClosingDelta: formatMoney(
          purchaseMonthClosingDeltaMinor,
          currency,
        ),
      },
      formatted: {
        baselineMinimumFreeCash: formatMoney(
          inputData.baseline.minimumFreeCashMinor,
          currency,
        ),
        scenarioMinimumFreeCash: formatMoney(
          inputData.scenarioForecast.minimumFreeCashMinor,
          currency,
        ),
        rows,
        scenarioRows: formatForecastRows(
          {
            userId: inputData.userId ?? "",
            ...inputData.scenarioForecast,
          },
          currency,
        ),
      },
    };
  },
});

export const evaluatePurchase = createWorkflow({
  id: "evaluate-purchase",
  inputSchema: purchaseDecisionInputSchema,
  outputSchema: purchaseDecisionOutputSchema,
})
  .then(loadPurchaseProfileStep)
  .then(runBaselineForecastStep)
  .then(runPurchaseScenarioForecastStep)
  .then(buildPurchaseDecisionStep)
  .commit();
