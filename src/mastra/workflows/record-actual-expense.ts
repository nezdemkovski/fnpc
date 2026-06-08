import { and, eq, inArray } from "drizzle-orm";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { db } from "../../db/client";
import {
  plannedExpenses,
  recurringExpenses,
} from "../../db/schema";
import {
  currentDateKey,
  currentMonthKey,
  normalizeCurrency,
  parseUserDate,
} from "../../finance/dates";
import {
  type MatchCandidate,
  rankEntityCandidates,
} from "../../finance/entity-matching";
import { recordDebitedActualExpense, resolveSpendingAccountDebit } from "../../finance/ledger";
import { formatMoney, majorToMinor } from "../../finance/money";
import {
  getFinancialSnapshot,
  getOrCreateUser,
} from "../../finance/profile-service";

const recordActualExpenseInputSchema = z.object({
  mastraResourceId: z.string(),
  name: z.string(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
  spentAt: z.string().optional(),
  note: z.string().optional(),
  confirmedCandidateId: z.string().optional(),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  sourceMessageId: z.string().optional(),
  sourceText: z.string().optional(),
});

type RecordActualExpenseInput = z.infer<typeof recordActualExpenseInputSchema>;

const candidateSchema = z.object({
  id: z.string(),
  type: z.enum(["recurring_expense", "planned_expense"]),
  name: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  status: z.string().optional(),
  score: z.number(),
  reason: z.string(),
});

const resolvedCandidateSchema = candidateSchema.extend({
  score: z.number(),
});

const accountDebitPlanSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  accountType: z.string(),
  currency: z.string(),
  previousBalanceMinor: z.number(),
  adjustedBalanceMinor: z.number(),
});

const recordedExpenseSchema = z.object({
  actualExpenseId: z.string(),
  name: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  plannedExpenseId: z.string().optional(),
  accountDebit: accountDebitPlanSchema.extend({
    accountBalanceId: z.string(),
  }),
});

const recordActualExpenseStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  needsConfirmation: z.boolean().default(false),
  message: z.string().optional(),
  candidates: z.array(candidateSchema).default([]),
  resolvedCandidate: resolvedCandidateSchema.optional(),
  resolvedAmountMinor: z.number().optional(),
  resolvedCurrency: z.string().optional(),
  accountDebit: accountDebitPlanSchema.optional(),
  recordedExpense: recordedExpenseSchema.optional(),
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
      amount: z.string(),
      availableOperatingCash: z.string(),
      totalCash: z.string(),
    })
    .optional(),
});

const recordActualExpenseOutputSchema = recordActualExpenseStateSchema.extend({
  changed: z
    .object({
      entityType: z.literal("actual_expense"),
      entityId: z.string(),
      name: z.string(),
      action: z.literal("created"),
    })
    .optional(),
});

const missingProfileSettings = (user: {
  defaultCurrency?: string | null;
  timezone?: string | null;
}) => {
  const missing: string[] = [];
  if (!user.defaultCurrency) missing.push("defaultCurrency");
  if (!user.timezone) missing.push("timezone");
  return missing;
};

const candidateKey = (candidate: Pick<MatchCandidate, "type" | "id">) =>
  `${candidate.type}:${candidate.id}`;

const formatCandidate = (candidate: z.infer<typeof candidateSchema>) =>
  `${candidate.name} (${formatMoney(candidate.amountMinor, candidate.currency)})`;

const loadActualExpenseProfileStep = createStep({
  id: "load-actual-expense-profile",
  description: "Loads user profile settings required to record an actual expense.",
  inputSchema: recordActualExpenseInputSchema,
  outputSchema: recordActualExpenseStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({
      mastraResourceId: inputData.mastraResourceId,
    });
    const missingProfileFields = missingProfileSettings(user);

    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        userId: user.id,
        currentDate: user.timezone ? currentDateKey(user.timezone) : null,
        currentMonth: user.timezone ? currentMonthKey(user.timezone) : null,
        missingProfileFields,
        needsConfirmation: false,
        candidates: [],
        message:
          "Cannot record an expense until defaultCurrency and timezone are known.",
      };
    }

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      userId: user.id,
      currency: user.defaultCurrency!,
      timezone: user.timezone!,
      currentDate: currentDateKey(user.timezone!),
      currentMonth: currentMonthKey(user.timezone!),
      missingProfileFields: [],
      needsConfirmation: false,
      candidates: [],
    };
  },
});

const loadExpenseCandidatesStep = createStep({
  id: "load-expense-candidates",
  description:
    "Loads active recurring and planned expenses that may match the reported payment.",
  inputSchema: recordActualExpenseStateSchema,
  outputSchema: recordActualExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<RecordActualExpenseInput>();
    const [activeRecurring, activePlans] = await Promise.all([
      db
        .select()
        .from(recurringExpenses)
        .where(
          and(
            eq(recurringExpenses.userId, inputData.userId),
            eq(recurringExpenses.isActive, true),
          ),
        ),
      db
        .select()
        .from(plannedExpenses)
        .where(
          and(
            eq(plannedExpenses.userId, inputData.userId),
            inArray(plannedExpenses.status, ["planned", "approved"]),
          ),
        ),
    ]);

    const candidates: MatchCandidate[] = [
      ...activeRecurring.map((expense) => ({
        id: expense.id,
        type: "recurring_expense" as const,
        name: expense.name,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
      })),
      ...activePlans.map((expense) => ({
        id: expense.id,
        type: "planned_expense" as const,
        name: expense.name,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        status: expense.status,
      })),
    ];

    return {
      ...inputData,
      candidates: rankEntityCandidates({
        query: initial.name,
        candidates,
      }).slice(0, 5),
    };
  },
});

const resolveActualExpenseStep = createStep({
  id: "resolve-actual-expense",
  description:
    "Resolves amount and target entity. It refuses to invent a missing amount when there is no strong saved match.",
  inputSchema: recordActualExpenseStateSchema,
  outputSchema: recordActualExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) return inputData;

    const initial = getInitData<RecordActualExpenseInput>();
    const confirmedCandidate = initial.confirmedCandidateId
      ? inputData.candidates.find(
          (candidate) => candidateKey(candidate) === initial.confirmedCandidateId,
        )
      : undefined;
    const bestCandidate = confirmedCandidate ?? inputData.candidates[0];
    const secondCandidate = inputData.candidates[1];
    const hasAmbiguousCandidate =
      bestCandidate &&
      secondCandidate &&
      bestCandidate.score - secondCandidate.score < 0.12;

    if (!initial.amount && !bestCandidate) {
      return {
        ...inputData,
        ok: false,
        message:
          "Expense amount is missing and no matching saved recurring or planned expense was found.",
      };
    }

    if (
      !initial.amount &&
      bestCandidate &&
      bestCandidate.score < 0.72 &&
      !confirmedCandidate
    ) {
      return {
        ...inputData,
        ok: false,
        needsConfirmation: true,
        message: `I found a weak possible match: ${formatCandidate(bestCandidate)}. Confirm it or provide the amount.`,
      };
    }

    if (hasAmbiguousCandidate && !confirmedCandidate) {
      return {
        ...inputData,
        ok: false,
        needsConfirmation: true,
        message:
          "Multiple saved expenses could match this payment. Confirm the correct candidate before recording it.",
      };
    }

    const resolvedAmountMinor =
      typeof initial.amount === "number"
        ? majorToMinor(initial.amount)
        : bestCandidate?.amountMinor;
    const resolvedCurrency = normalizeCurrency(
      initial.currency ?? bestCandidate?.currency,
      inputData.currency,
    );

    if (resolvedAmountMinor === undefined) {
      return {
        ...inputData,
        ok: false,
        message: "Expense amount could not be resolved.",
      };
    }

    return {
      ...inputData,
      resolvedCandidate: bestCandidate,
      resolvedAmountMinor,
      resolvedCurrency,
    };
  },
});

const resolveSpendingAccountStep = createStep({
  id: "resolve-spending-account",
  description:
    "Resolves the account to debit for a real payment. Refuses ambiguous account changes.",
  inputSchema: recordActualExpenseStateSchema,
  outputSchema: recordActualExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.resolvedCurrency) {
      return inputData;
    }

    const initial = getInitData<RecordActualExpenseInput>();
    const debitResult = await resolveSpendingAccountDebit({
      database: db,
      userId: inputData.userId,
      currency: inputData.resolvedCurrency,
      amountMinor: inputData.resolvedAmountMinor!,
      accountId: initial.accountId,
      accountName: initial.accountName,
    });

    if (!debitResult.ok) {
      return {
        ...inputData,
        ok: false,
        needsConfirmation: true,
        message: debitResult.message,
      };
    }

    return {
      ...inputData,
      accountDebit: debitResult.debit,
    };
  },
});

const applyActualExpenseStep = createStep({
  id: "apply-actual-expense",
  description:
    "Records the actual expense and stores provenance for the matched saved fact.",
  inputSchema: recordActualExpenseStateSchema,
  outputSchema: recordActualExpenseOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (
      !inputData.ok ||
      !inputData.userId ||
      inputData.resolvedAmountMinor === undefined ||
      !inputData.resolvedCurrency ||
      !inputData.accountDebit
    ) {
      return inputData;
    }

    const initial = getInitData<RecordActualExpenseInput>();
    const matchedPlan =
      inputData.resolvedCandidate?.type === "planned_expense"
        ? inputData.resolvedCandidate
        : undefined;
    const spentAt = initial.spentAt
      ? parseUserDate(initial.spentAt)
      : inputData.timezone
        ? parseUserDate(currentDateKey(inputData.timezone))
        : new Date();
    const provenance = {
      source: "record-actual-expense",
      sourceText: initial.sourceText,
      matchedCandidate: inputData.resolvedCandidate
        ? {
            id: inputData.resolvedCandidate.id,
            type: inputData.resolvedCandidate.type,
            name: inputData.resolvedCandidate.name,
            score: inputData.resolvedCandidate.score,
          }
        : null,
      amountSource:
        typeof initial.amount === "number" ? "user_provided" : "matched_saved_fact",
    };

    const recordedExpense = await recordDebitedActualExpense({
      database: db,
      userId: inputData.userId,
      name: inputData.resolvedCandidate?.name ?? initial.name,
      amountMinor: inputData.resolvedAmountMinor,
      currency: inputData.resolvedCurrency,
      spentAt,
      note: initial.note,
      sourceMessageId: initial.sourceMessageId,
      provenance,
      accountDebit: inputData.accountDebit,
      plannedExpenseId: matchedPlan?.id,
    });

    const snapshot = await getFinancialSnapshot(inputData.userId);

    return {
      ...inputData,
      recordedExpense,
      snapshot: snapshot.totals,
      formatted: {
        amount: formatMoney(recordedExpense.amountMinor, recordedExpense.currency),
        availableOperatingCash: formatMoney(
          snapshot.totals.availableOperatingCashMinor,
          inputData.currency!,
        ),
        totalCash: formatMoney(snapshot.totals.totalCashMinor, inputData.currency!),
      },
      changed: {
        entityType: "actual_expense" as const,
        entityId: recordedExpense.actualExpenseId,
        name: recordedExpense.name,
        action: "created" as const,
      },
    };
  },
});

export const recordActualExpense = createWorkflow({
  id: "record-actual-expense",
  inputSchema: recordActualExpenseInputSchema,
  outputSchema: recordActualExpenseOutputSchema,
})
  .then(loadActualExpenseProfileStep)
  .then(loadExpenseCandidatesStep)
  .then(resolveActualExpenseStep)
  .then(resolveSpendingAccountStep)
  .then(applyActualExpenseStep)
  .commit();
