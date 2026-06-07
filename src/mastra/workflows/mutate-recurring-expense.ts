import { and, eq } from "drizzle-orm";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { db } from "../../db/client";
import {
  actualExpenses,
  financialEvents,
  recurringExpenses,
} from "../../db/schema";
import {
  currentDateKey,
  currentMonthKey,
  normalizeCurrency,
  parseUserDate,
} from "../../finance/dates";
import { rankEntityCandidates } from "../../finance/entity-matching";
import { formatMoney, majorToMinor } from "../../finance/money";
import {
  getFinancialSnapshot,
  getOrCreateUser,
  runForecast,
  type ForecastResult,
} from "../../finance/profile-service";

const actionSchema = z.enum(["create", "update", "delete", "record_payment"]);
const frequencySchema = z.enum(["monthly", "weekly", "yearly"]);

const mutateRecurringExpenseInputSchema = z.object({
  mastraResourceId: z.string(),
  action: actionSchema,
  recurringExpenseId: z.string().optional(),
  name: z.string().optional(),
  newName: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
  frequency: frequencySchema.optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  isEssential: z.boolean().optional(),
  spentAt: z.string().optional(),
  note: z.string().optional(),
  confirmedCandidateId: z.string().optional(),
  horizonMonths: z.number().int().min(1).max(24).default(6),
  reason: z.string().optional(),
  sourceMessageId: z.string().optional(),
  sourceText: z.string().optional(),
});

type MutateRecurringExpenseInput = z.infer<typeof mutateRecurringExpenseInputSchema>;

const recurringExpenseRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  frequency: frequencySchema,
  dayOfMonth: z.number().nullable(),
  isEssential: z.boolean(),
  isActive: z.boolean(),
});

const recurringCandidateSchema = recurringExpenseRecordSchema.extend({
  score: z.number(),
  reason: z.string(),
});

const forecastSummarySchema = z.object({
  minimumFreeCashMinor: z.number(),
  minimumMonth: z.string(),
});

const mutateRecurringExpenseStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  action: actionSchema,
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  needsConfirmation: z.boolean().default(false),
  message: z.string().optional(),
  candidates: z.array(recurringCandidateSchema).default([]),
  beforeExpense: recurringExpenseRecordSchema.optional(),
  afterExpense: recurringExpenseRecordSchema.optional(),
  actualExpenseId: z.string().optional(),
  baseline: forecastSummarySchema.optional(),
  afterForecast: forecastSummarySchema.optional(),
});

const mutateRecurringExpenseOutputSchema = mutateRecurringExpenseStateSchema.extend({
  changed: z
    .object({
      entityType: z.enum(["recurring_expense", "actual_expense"]),
      entityId: z.string(),
      name: z.string(),
      action: z.enum(["created", "updated", "deleted", "paid"]),
    })
    .optional(),
  impact: z
    .object({
      monthlyRecurringExpensesDeltaMinor: z.number(),
      formattedMonthlyRecurringExpensesDelta: z.string(),
      baselineMinimumFreeCash: z.string(),
      afterMinimumFreeCash: z.string(),
    })
    .optional(),
  formattedExpense: z
    .object({
      amount: z.string(),
      frequency: z.string(),
      dayOfMonth: z.number().nullable(),
      isActive: z.boolean(),
    })
    .optional(),
  formattedSnapshot: z
    .object({
      availableOperatingCash: z.string(),
      totalCash: z.string(),
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

const asRecurringRecord = (
  expense: typeof recurringExpenses.$inferSelect,
): z.infer<typeof recurringExpenseRecordSchema> => ({
  id: expense.id,
  name: expense.name,
  amountMinor: expense.amountMinor,
  currency: expense.currency,
  frequency: expense.frequency,
  dayOfMonth: expense.dayOfMonth,
  isEssential: expense.isEssential,
  isActive: expense.isActive,
});

const summarizeForecast = (forecast: ForecastResult) => ({
  minimumFreeCashMinor: forecast.minimumFreeCashMinor,
  minimumMonth: forecast.minimumMonth,
});

const candidateKey = (candidate: Pick<z.infer<typeof recurringCandidateSchema>, "id">) =>
  `recurring_expense:${candidate.id}`;

const saveRecurringExpenseEvent = async ({
  userId,
  entityId,
  eventType,
  before,
  after,
  reason,
  sourceMessageId,
}: {
  userId: string;
  entityId: string;
  eventType: "created" | "updated" | "deleted" | "paid";
  before?: unknown;
  after: unknown;
  reason?: string;
  sourceMessageId?: string;
}) => {
  await db.insert(financialEvents).values({
    userId,
    entityType: "recurring_expense",
    entityId,
    eventType,
    before,
    after,
    reason,
    sourceMessageId,
  });
};

const loadRecurringExpenseProfileStep = createStep({
  id: "load-recurring-expense-profile",
  description:
    "Loads user profile settings required to mutate recurring expenses.",
  inputSchema: mutateRecurringExpenseInputSchema,
  outputSchema: mutateRecurringExpenseStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({
      mastraResourceId: inputData.mastraResourceId,
    });
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
        needsConfirmation: false,
        candidates: [],
        message:
          "Cannot mutate recurring expenses until defaultCurrency and timezone are known.",
      };
    }

    if (inputData.action === "create" && (!inputData.name || inputData.amount === undefined)) {
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
        needsConfirmation: false,
        candidates: [],
        message: "Creating a recurring expense requires name and amount.",
      };
    }

    if (inputData.action !== "create" && !inputData.recurringExpenseId && !inputData.name) {
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
        needsConfirmation: false,
        candidates: [],
        message:
          "Mutating an existing recurring expense requires recurringExpenseId or name.",
      };
    }

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
      needsConfirmation: false,
      candidates: [],
    };
  },
});

const loadRecurringExpenseCandidatesStep = createStep({
  id: "load-recurring-expense-candidates",
  description: "Loads active recurring expenses and ranks likely matches.",
  inputSchema: mutateRecurringExpenseStateSchema,
  outputSchema: mutateRecurringExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<MutateRecurringExpenseInput>();
    const activeExpenses = await db
      .select()
      .from(recurringExpenses)
      .where(
        and(
          eq(recurringExpenses.userId, inputData.userId),
          eq(recurringExpenses.isActive, true),
        ),
      );

    const query = initial.name ?? initial.newName;
    const ranked = query
      ? rankEntityCandidates({
          query,
          candidates: activeExpenses.map((expense) => ({
            id: expense.id,
            type: "recurring_expense" as const,
            name: expense.name,
            amountMinor: expense.amountMinor,
            currency: expense.currency,
          })),
        })
      : [];

    const activeById = new Map(activeExpenses.map((expense) => [expense.id, expense]));
    const candidates = ranked
      .map((candidate) => {
        const expense = activeById.get(candidate.id);
        if (!expense) return undefined;
        return {
          ...asRecurringRecord(expense),
          score: candidate.score,
          reason: candidate.reason,
        };
      })
      .filter((candidate): candidate is z.infer<typeof recurringCandidateSchema> =>
        Boolean(candidate),
      )
      .slice(0, 5);

    return {
      ...inputData,
      candidates,
    };
  },
});

const resolveRecurringExpenseStep = createStep({
  id: "resolve-recurring-expense",
  description:
    "Resolves a recurring expense target and prevents duplicate creation when a saved expense likely already exists.",
  inputSchema: mutateRecurringExpenseStateSchema,
  outputSchema: mutateRecurringExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<MutateRecurringExpenseInput>();
    const confirmedCandidate = initial.confirmedCandidateId
      ? inputData.candidates.find(
          (candidate) => candidateKey(candidate) === initial.confirmedCandidateId,
        )
      : undefined;
    const bestCandidate = confirmedCandidate ?? inputData.candidates[0];
    const secondCandidate = inputData.candidates[1];
    const ambiguous =
      bestCandidate && secondCandidate && bestCandidate.score - secondCandidate.score < 0.12;

    if (initial.recurringExpenseId) {
      const [byId] = await db
        .select()
        .from(recurringExpenses)
        .where(
          and(
            eq(recurringExpenses.userId, inputData.userId),
            eq(recurringExpenses.id, initial.recurringExpenseId),
          ),
        )
        .limit(1);
      if (!byId) return { ...inputData, ok: false, message: "Recurring expense not found." };
      return { ...inputData, beforeExpense: asRecurringRecord(byId) };
    }

    if (initial.action === "create") {
      if (bestCandidate && bestCandidate.score >= 0.86 && !confirmedCandidate) {
        return {
          ...inputData,
          ok: false,
          needsConfirmation: true,
          message:
            "A similar active recurring expense already exists. Confirm whether to update it instead of creating a duplicate.",
        };
      }
      return inputData;
    }

    if (!bestCandidate) {
      return { ...inputData, ok: false, message: "Recurring expense not found." };
    }

    const minimumScore = initial.action === "record_payment" ? 0.45 : 0.72;
    if ((bestCandidate.score < minimumScore || ambiguous) && !confirmedCandidate) {
      return {
        ...inputData,
        ok: false,
        needsConfirmation: true,
        message:
          "Multiple or weak recurring expense matches were found. Confirm the correct candidate before mutating it.",
      };
    }

    return {
      ...inputData,
      beforeExpense: bestCandidate,
    };
  },
});

const collectRecurringExpenseBaselineStep = createStep({
  id: "collect-recurring-expense-baseline",
  description: "Runs the forecast before applying a recurring expense mutation.",
  inputSchema: mutateRecurringExpenseStateSchema,
  outputSchema: mutateRecurringExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<MutateRecurringExpenseInput>();
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

const applyRecurringExpenseMutationStep = createStep({
  id: "apply-recurring-expense-mutation",
  description:
    "Creates, updates, deletes, or records payment for a recurring expense.",
  inputSchema: mutateRecurringExpenseStateSchema,
  outputSchema: mutateRecurringExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return inputData;

    const initial = getInitData<MutateRecurringExpenseInput>();
    const now = new Date();

    if (initial.action === "create") {
      const [created] = await db
        .insert(recurringExpenses)
        .values({
          userId: inputData.userId,
          name: initial.name!,
          amountMinor: majorToMinor(initial.amount!),
          currency: normalizeCurrency(initial.currency, inputData.currency),
          frequency: initial.frequency ?? "monthly",
          dayOfMonth: initial.dayOfMonth,
          isEssential: initial.isEssential ?? false,
          isActive: true,
        })
        .returning();

      await saveRecurringExpenseEvent({
        userId: inputData.userId,
        entityId: created.id,
        eventType: "created",
        after: created,
        reason: initial.reason,
        sourceMessageId: initial.sourceMessageId,
      });

      return {
        ...inputData,
        afterExpense: asRecurringRecord(created),
      };
    }

    if (!inputData.beforeExpense) return inputData;

    if (initial.action === "record_payment") {
      const spentAt = initial.spentAt
        ? parseUserDate(initial.spentAt)
        : inputData.timezone
          ? parseUserDate(currentDateKey(inputData.timezone))
          : now;
      const provenance = {
        source: "mutate-recurring-expense",
        action: "record_payment",
        sourceText: initial.sourceText,
        recurringExpenseId: inputData.beforeExpense.id,
        recurringExpenseName: inputData.beforeExpense.name,
        amountSource:
          typeof initial.amount === "number" ? "user_provided" : "matched_saved_fact",
      };
      const amountMinor =
        typeof initial.amount === "number"
          ? majorToMinor(initial.amount)
          : inputData.beforeExpense.amountMinor;
      const currency = normalizeCurrency(initial.currency, inputData.beforeExpense.currency);

      const [actualExpense] = await db
        .insert(actualExpenses)
        .values({
          userId: inputData.userId,
          name: inputData.beforeExpense.name,
          amountMinor,
          currency,
          spentAt,
          source: "telegram",
          note: [initial.note, JSON.stringify(provenance)].filter(Boolean).join("\n"),
        })
        .returning();

      await db.insert(financialEvents).values({
        userId: inputData.userId,
        entityType: "actual_expense",
        entityId: actualExpense.id,
        eventType: "created",
        after: actualExpense,
        reason: JSON.stringify(provenance),
        sourceMessageId: initial.sourceMessageId,
      });

      await saveRecurringExpenseEvent({
        userId: inputData.userId,
        entityId: inputData.beforeExpense.id,
        eventType: "paid",
        before: inputData.beforeExpense,
        after: inputData.beforeExpense,
        reason: JSON.stringify(provenance),
        sourceMessageId: initial.sourceMessageId,
      });

      return {
        ...inputData,
        afterExpense: inputData.beforeExpense,
        actualExpenseId: actualExpense.id,
      };
    }

    const values: Partial<typeof recurringExpenses.$inferInsert> = {
      updatedAt: now,
    };
    let eventType: "updated" | "deleted" = "updated";

    if (initial.action === "delete") {
      values.isActive = false;
      eventType = "deleted";
    }

    if (initial.action === "update") {
      if (initial.newName !== undefined) values.name = initial.newName;
      if (initial.amount !== undefined) values.amountMinor = majorToMinor(initial.amount);
      if (initial.currency !== undefined) {
        values.currency = normalizeCurrency(initial.currency, inputData.currency);
      }
      if (initial.frequency !== undefined) values.frequency = initial.frequency;
      if (initial.dayOfMonth !== undefined) values.dayOfMonth = initial.dayOfMonth;
      if (initial.isEssential !== undefined) values.isEssential = initial.isEssential;
    }

    const [updated] = await db
      .update(recurringExpenses)
      .set(values)
      .where(eq(recurringExpenses.id, inputData.beforeExpense.id))
      .returning();

    await saveRecurringExpenseEvent({
      userId: inputData.userId,
      entityId: updated.id,
      eventType,
      before: inputData.beforeExpense,
      after: updated,
      reason: initial.reason,
      sourceMessageId: initial.sourceMessageId,
    });

    return {
      ...inputData,
      afterExpense: asRecurringRecord(updated),
    };
  },
});

const collectRecurringExpenseAfterForecastStep = createStep({
  id: "collect-recurring-expense-after-forecast",
  description: "Runs the forecast after applying a recurring expense mutation.",
  inputSchema: mutateRecurringExpenseStateSchema,
  outputSchema: mutateRecurringExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.afterExpense) return inputData;

    const initial = getInitData<MutateRecurringExpenseInput>();
    const afterForecast = await runForecast({
      userId: inputData.userId,
      horizonMonths: initial.horizonMonths ?? 6,
      persist: false,
    });

    return {
      ...inputData,
      afterForecast: summarizeForecast(afterForecast),
    };
  },
});

const buildRecurringExpenseMutationResultStep = createStep({
  id: "build-recurring-expense-mutation-result",
  description:
    "Builds a structured recurring expense mutation result with forecast impact.",
  inputSchema: mutateRecurringExpenseStateSchema,
  outputSchema: mutateRecurringExpenseOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok || !inputData.afterExpense || !inputData.currency) return inputData;

    const snapshot = inputData.userId
      ? await getFinancialSnapshot(inputData.userId)
      : undefined;
    const monthlyRecurringExpensesDeltaMinor =
      inputData.action === "record_payment" || !inputData.beforeExpense
        ? 0
        : inputData.afterExpense.isActive
          ? inputData.afterExpense.amountMinor - inputData.beforeExpense.amountMinor
          : -inputData.beforeExpense.amountMinor;
    const changedAction =
      inputData.action === "create"
        ? ("created" as const)
        : inputData.action === "delete"
          ? ("deleted" as const)
          : inputData.action === "record_payment"
            ? ("paid" as const)
            : ("updated" as const);

    return {
      ...inputData,
      changed: {
        entityType:
          inputData.action === "record_payment"
            ? ("actual_expense" as const)
            : ("recurring_expense" as const),
        entityId:
          inputData.action === "record_payment"
            ? inputData.actualExpenseId!
            : inputData.afterExpense.id,
        name: inputData.afterExpense.name,
        action: changedAction,
      },
      impact:
        inputData.baseline && inputData.afterForecast
          ? {
              monthlyRecurringExpensesDeltaMinor,
              formattedMonthlyRecurringExpensesDelta: formatMoney(
                monthlyRecurringExpensesDeltaMinor,
                inputData.currency,
              ),
              baselineMinimumFreeCash: formatMoney(
                inputData.baseline.minimumFreeCashMinor,
                inputData.currency,
              ),
              afterMinimumFreeCash: formatMoney(
                inputData.afterForecast.minimumFreeCashMinor,
                inputData.currency,
              ),
            }
          : undefined,
      formattedExpense: {
        amount: formatMoney(inputData.afterExpense.amountMinor, inputData.afterExpense.currency),
        frequency: inputData.afterExpense.frequency,
        dayOfMonth: inputData.afterExpense.dayOfMonth,
        isActive: inputData.afterExpense.isActive,
      },
      formattedSnapshot: snapshot
        ? {
            availableOperatingCash: formatMoney(
              snapshot.totals.availableOperatingCashMinor,
              inputData.currency,
            ),
            totalCash: formatMoney(snapshot.totals.totalCashMinor, inputData.currency),
          }
        : undefined,
    };
  },
});

export const mutateRecurringExpense = createWorkflow({
  id: "mutate-recurring-expense",
  inputSchema: mutateRecurringExpenseInputSchema,
  outputSchema: mutateRecurringExpenseOutputSchema,
})
  .then(loadRecurringExpenseProfileStep)
  .then(loadRecurringExpenseCandidatesStep)
  .then(resolveRecurringExpenseStep)
  .then(collectRecurringExpenseBaselineStep)
  .then(applyRecurringExpenseMutationStep)
  .then(collectRecurringExpenseAfterForecastStep)
  .then(buildRecurringExpenseMutationResultStep)
  .commit();
