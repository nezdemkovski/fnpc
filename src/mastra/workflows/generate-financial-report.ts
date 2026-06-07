import { format } from "date-fns";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { formatMoney } from "../../finance/money";
import { getFinancialSnapshot, runForecast } from "../../finance/profile-service";
import { loadUserContext } from "./shared";

const reportTypeSchema = z.enum(["daily", "weekly", "monthly", "forecast"]);

const reportInputSchema = z.object({
  mastraResourceId: z.string(),
  reportType: reportTypeSchema.default("daily"),
  horizonMonths: z.number().int().min(1).max(24).default(6),
});

const forecastReportRowSchema = z.object({
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

const reportOutputSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  reportType: reportTypeSchema,
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  message: z.string().optional(),
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  totals: z
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
  formattedTotals: z
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
  upcomingPlans: z
    .array(
      z.object({
        name: z.string(),
        amount: z.string(),
        plannedFor: z.string(),
        priority: z.string(),
        status: z.string(),
      }),
    )
    .default([]),
  forecast: z
    .object({
      horizonMonths: z.number(),
      minimumFreeCash: z.string(),
      minimumMonth: z.string(),
      riskMonths: z.array(
        z.object({
          month: z.string(),
          riskLevel: z.enum(["tight", "negative"]),
          closingFreeCash: z.string(),
        }),
      ),
      rows: z.array(forecastReportRowSchema),
    })
    .optional(),
});

const loadReportProfileStep = createStep({
  id: "load-report-profile",
  description: "Loads the profile and verifies settings required for report calculations.",
  inputSchema: reportInputSchema,
  outputSchema: reportOutputSchema,
  execute: async ({ inputData }) => {
    const context = await loadUserContext(inputData.mastraResourceId);

    if (context.missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        reportType: inputData.reportType,
        missingProfileFields: context.missingProfileFields,
        currentDate: context.currentDate,
        currentMonth: context.currentMonth,
        upcomingPlans: [],
        message: "Cannot generate a financial report until defaultCurrency and timezone are known.",
      };
    }

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      reportType: inputData.reportType,
      missingProfileFields: [],
      currentDate: context.currentDate,
      currentMonth: context.currentMonth,
      userId: context.userId,
      currency: context.currency!,
      timezone: context.timezone!,
      upcomingPlans: [],
    };
  },
});

const collectSnapshotStep = createStep({
  id: "collect-report-snapshot",
  description: "Collects current balances, commitments, savings and upcoming plans.",
  inputSchema: reportOutputSchema,
  outputSchema: reportOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return inputData;

    const snapshot = await getFinancialSnapshot(inputData.userId);

    return {
      ...inputData,
      totals: snapshot.totals,
      formattedTotals: {
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
      upcomingPlans: snapshot.upcomingPlannedExpenses.map((plan) => ({
        name: plan.name,
        amount: formatMoney(plan.amountMinor, inputData.currency!),
        plannedFor: format(plan.plannedFor, "yyyy-MM-dd"),
        priority: plan.priority,
        status: plan.status,
      })),
    };
  },
});

const collectForecastStep = createStep({
  id: "collect-report-forecast",
  description: "Runs the deterministic forecast for the requested report horizon.",
  inputSchema: reportOutputSchema,
  outputSchema: reportOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return inputData;

    const initial = getInitData<typeof generateFinancialReport>();
    const forecast = await runForecast({
      userId: inputData.userId,
      horizonMonths: initial.horizonMonths ?? 6,
      persist: false,
    });

    return {
      ...inputData,
      forecast: {
        horizonMonths: forecast.horizonMonths,
        minimumFreeCash: formatMoney(forecast.minimumFreeCashMinor, inputData.currency),
        minimumMonth: forecast.minimumMonth,
        riskMonths: forecast.rows
          .filter((row) => row.riskLevel !== "ok")
          .map((row) => ({
            month: row.month,
            riskLevel: row.riskLevel as "tight" | "negative",
            closingFreeCash: formatMoney(row.closingFreeCashMinor, inputData.currency!),
          })),
        rows: forecast.rows.map((row) => ({
          month: row.month,
          openingFreeCash: formatMoney(row.openingFreeCashMinor, inputData.currency!),
          income: formatMoney(row.incomeMinor, inputData.currency!),
          recurringExpenses: formatMoney(row.recurringExpensesMinor, inputData.currency!),
          plannedExpenses: formatMoney(row.plannedExpensesMinor, inputData.currency!),
          actualExpenses: formatMoney(row.actualExpensesMinor, inputData.currency!),
          savingsContributions: formatMoney(row.savingsContributionsMinor, inputData.currency!),
          closingFreeCash: formatMoney(row.closingFreeCashMinor, inputData.currency!),
          protectedSavings: formatMoney(row.protectedSavingsMinor, inputData.currency!),
          riskLevel: row.riskLevel,
        })),
      },
    };
  },
});

export const generateFinancialReport = createWorkflow({
  id: "generate-financial-report",
  inputSchema: reportInputSchema,
  outputSchema: reportOutputSchema,
})
  .then(loadReportProfileStep)
  .then(collectSnapshotStep)
  .then(collectForecastStep)
  .commit();
