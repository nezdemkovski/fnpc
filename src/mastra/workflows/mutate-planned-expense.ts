import { and, eq, inArray } from "drizzle-orm";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { db } from "../../db/client";
import { financialEvents, plannedExpenses } from "../../db/schema";
import { currentDateKey, currentMonthKey, normalizeCurrency, parseUserDate } from "../../finance/dates";
import { formatMoney, majorToMinor } from "../../finance/money";
import { getOrCreateUser, runForecast, type ForecastResult } from "../../finance/profile-service";

const prioritySchema = z.enum(["must", "should", "nice_to_have"]);
const actionSchema = z.enum(["create", "update", "move", "cancel", "approve", "mark_paid"]);

const mutatePlannedExpenseInputSchema = z.object({
  mastraResourceId: z.string(),
  action: actionSchema,
  plannedExpenseId: z.string().optional(),
  name: z.string().optional(),
  newName: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
  plannedFor: z.string().optional().describe("YYYY-MM or ISO date"),
  priority: prioritySchema.optional(),
  horizonMonths: z.number().int().min(1).max(24).default(6),
  reason: z.string().optional(),
  sourceMessageId: z.string().optional(),
});

type MutatePlannedExpenseInput = z.infer<typeof mutatePlannedExpenseInputSchema>;

const forecastRowSchema = z.object({
  month: z.string(),
  closingFreeCashMinor: z.number(),
  riskLevel: z.enum(["ok", "tight", "negative"]),
});

const forecastSummarySchema = z.object({
  minimumFreeCashMinor: z.number(),
  minimumMonth: z.string(),
  rows: z.array(forecastRowSchema),
});

const plannedExpenseRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  plannedFor: z.date(),
  status: z.enum(["planned", "approved", "paid", "cancelled", "moved"]),
  priority: prioritySchema,
});

const mutatePlannedExpenseStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  action: actionSchema,
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  message: z.string().optional(),
  beforePlan: plannedExpenseRecordSchema.optional(),
  afterPlan: plannedExpenseRecordSchema.optional(),
  baseline: forecastSummarySchema.optional(),
  afterForecast: forecastSummarySchema.optional(),
});

const mutatePlannedExpenseOutputSchema = mutatePlannedExpenseStateSchema.extend({
  changed: z
    .object({
      entityType: z.literal("planned_expense"),
      entityId: z.string(),
      name: z.string(),
      action: z.enum(["created", "updated", "moved", "cancelled", "approved", "paid"]),
    })
    .optional(),
  impact: z
    .object({
      minimumFreeCashDeltaMinor: z.number(),
      formattedMinimumFreeCashDelta: z.string(),
      baselineMinimumFreeCash: z.string(),
      afterMinimumFreeCash: z.string(),
      riskMonths: z.array(
        z.object({
          month: z.string(),
          riskLevel: z.enum(["tight", "negative"]),
          closingFreeCash: z.string(),
        }),
      ),
    })
    .optional(),
  formattedPlan: z
    .object({
      amount: z.string(),
      plannedFor: z.string(),
      status: z.string(),
      priority: z.string(),
    })
    .optional(),
});

const missingProfileSettings = (user: { defaultCurrency?: string | null; timezone?: string | null }) => {
  const missing: string[] = [];
  if (!user.defaultCurrency) missing.push("defaultCurrency");
  if (!user.timezone) missing.push("timezone");
  return missing;
};

const summarizeForecast = (forecast: ForecastResult) => ({
  minimumFreeCashMinor: forecast.minimumFreeCashMinor,
  minimumMonth: forecast.minimumMonth,
  rows: forecast.rows.map((row) => ({
    month: row.month,
    closingFreeCashMinor: row.closingFreeCashMinor,
    riskLevel: row.riskLevel,
  })),
});

const formatPlanDate = (date: Date) => {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const paddedMonth = month.toString().padStart(2, "0");
  const paddedDay = day.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${paddedMonth}-${paddedDay}`;
};

const findPlannedExpense = async ({
  userId,
  plannedExpenseId,
  name,
}: {
  userId: string;
  plannedExpenseId?: string;
  name?: string;
}) => {
  if (plannedExpenseId) {
    const [byId] = await db
      .select()
      .from(plannedExpenses)
      .where(and(eq(plannedExpenses.userId, userId), eq(plannedExpenses.id, plannedExpenseId)))
      .limit(1);
    return byId;
  }

  if (!name) return undefined;
  const [byName] = await db
    .select()
    .from(plannedExpenses)
    .where(and(eq(plannedExpenses.userId, userId), eq(plannedExpenses.name, name)))
    .limit(1);
  return byName;
};

const savePlannedExpenseEvent = async ({
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
  eventType: "created" | "updated" | "moved" | "cancelled" | "paid";
  before?: unknown;
  after: unknown;
  reason?: string;
  sourceMessageId?: string;
}) => {
  await db.insert(financialEvents).values({
    userId,
    entityType: "planned_expense",
    entityId,
    eventType,
    before,
    after,
    reason,
    sourceMessageId,
  });
};

type ChangedAction = "created" | "updated" | "moved" | "cancelled" | "approved" | "paid";

const changedAction = (action: z.infer<typeof actionSchema>): ChangedAction => {
  if (action === "create") return "created";
  if (action === "move") return "moved";
  if (action === "cancel") return "cancelled";
  if (action === "approve") return "approved";
  if (action === "mark_paid") return "paid";
  return "updated";
};

const loadPlannedExpenseProfileStep = createStep({
  id: "load-planned-expense-profile",
  description: "Loads the profile and validates inputs for planned expense mutation.",
  inputSchema: mutatePlannedExpenseInputSchema,
  outputSchema: mutatePlannedExpenseStateSchema,
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
        message: "Cannot mutate planned expenses until defaultCurrency and timezone are known.",
      };
    }

    if (inputData.action === "create" && (!inputData.name || inputData.amount === undefined || !inputData.plannedFor)) {
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
        message: "Creating a planned expense requires name, amount, and plannedFor.",
      };
    }

    if (inputData.action !== "create" && !inputData.plannedExpenseId && !inputData.name) {
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
        message: "Mutating an existing planned expense requires plannedExpenseId or name.",
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
    };
  },
});

const loadExistingPlannedExpenseStep = createStep({
  id: "load-existing-planned-expense",
  description: "Loads the existing planned expense when the action targets one.",
  inputSchema: mutatePlannedExpenseStateSchema,
  outputSchema: mutatePlannedExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || inputData.action === "create") return inputData;

    const initial = getInitData<MutatePlannedExpenseInput>();
    const existing = await findPlannedExpense({
      userId: inputData.userId,
      plannedExpenseId: initial.plannedExpenseId,
      name: initial.name,
    });

    if (!existing) {
      return {
        ...inputData,
        ok: false,
        message: "Planned expense not found.",
      };
    }

    return {
      ...inputData,
      beforePlan: {
        id: existing.id,
        name: existing.name,
        amountMinor: existing.amountMinor,
        currency: existing.currency,
        plannedFor: existing.plannedFor,
        status: existing.status,
        priority: existing.priority,
      },
    };
  },
});

const collectPlannedExpenseBaselineStep = createStep({
  id: "collect-planned-expense-baseline",
  description: "Runs the forecast before applying the planned expense mutation.",
  inputSchema: mutatePlannedExpenseStateSchema,
  outputSchema: mutatePlannedExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<MutatePlannedExpenseInput>();
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

const applyPlannedExpenseMutationStep = createStep({
  id: "apply-planned-expense-mutation",
  description: "Applies create, update, move, cancel, approve, or mark_paid to the planned expense.",
  inputSchema: mutatePlannedExpenseStateSchema,
  outputSchema: mutatePlannedExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return inputData;

    const initial = getInitData<MutatePlannedExpenseInput>();
    const now = new Date();

    if (initial.action === "create") {
      const [duplicate] = await db
        .select()
        .from(plannedExpenses)
        .where(
          and(
            eq(plannedExpenses.userId, inputData.userId),
            eq(plannedExpenses.name, initial.name!),
            inArray(plannedExpenses.status, ["planned", "approved"]),
          ),
        )
        .limit(1);

      if (duplicate) {
        return {
          ...inputData,
          ok: false,
          message: "Active planned expense with this name already exists.",
          beforePlan: {
            id: duplicate.id,
            name: duplicate.name,
            amountMinor: duplicate.amountMinor,
            currency: duplicate.currency,
            plannedFor: duplicate.plannedFor,
            status: duplicate.status,
            priority: duplicate.priority,
          },
        };
      }

      const [created] = await db
        .insert(plannedExpenses)
        .values({
          userId: inputData.userId,
          name: initial.name!,
          amountMinor: majorToMinor(initial.amount!),
          currency: normalizeCurrency(initial.currency, inputData.currency),
          plannedFor: parseUserDate(initial.plannedFor!),
          priority: initial.priority ?? "should",
          status: "planned",
          fundingSource: "free_cash",
        })
        .returning();

      await savePlannedExpenseEvent({
        userId: inputData.userId,
        entityId: created.id,
        eventType: "created",
        after: created,
        reason: initial.reason,
        sourceMessageId: initial.sourceMessageId,
      });

      return {
        ...inputData,
        afterPlan: {
          id: created.id,
          name: created.name,
          amountMinor: created.amountMinor,
          currency: created.currency,
          plannedFor: created.plannedFor,
          status: created.status,
          priority: created.priority,
        },
      };
    }

    if (!inputData.beforePlan) return inputData;

    const values: Partial<typeof plannedExpenses.$inferInsert> = {
      updatedAt: now,
    };
    let eventType: "updated" | "moved" | "cancelled" | "paid" = "updated";

    if (initial.action === "move") {
      if (!initial.plannedFor) {
        return { ...inputData, ok: false, message: "Moving a planned expense requires plannedFor." };
      }
      values.plannedFor = parseUserDate(initial.plannedFor);
      eventType = "moved";
    }

    if (initial.action === "cancel") {
      values.status = "cancelled";
      eventType = "cancelled";
    }

    if (initial.action === "approve") {
      values.status = "approved";
      eventType = "updated";
    }

    if (initial.action === "mark_paid") {
      values.status = "paid";
      eventType = "paid";
    }

    if (initial.action === "update") {
      if (initial.newName !== undefined) values.name = initial.newName;
      if (initial.amount !== undefined) values.amountMinor = majorToMinor(initial.amount);
      if (initial.currency !== undefined) values.currency = normalizeCurrency(initial.currency, inputData.currency);
      if (initial.plannedFor !== undefined) values.plannedFor = parseUserDate(initial.plannedFor);
      if (initial.priority !== undefined) values.priority = initial.priority;
    }

    const [updated] = await db
      .update(plannedExpenses)
      .set(values)
      .where(eq(plannedExpenses.id, inputData.beforePlan.id))
      .returning();

    await savePlannedExpenseEvent({
      userId: inputData.userId,
      entityId: updated.id,
      eventType,
      before: inputData.beforePlan,
      after: updated,
      reason: initial.reason,
      sourceMessageId: initial.sourceMessageId,
    });

    return {
      ...inputData,
      afterPlan: {
        id: updated.id,
        name: updated.name,
        amountMinor: updated.amountMinor,
        currency: updated.currency,
        plannedFor: updated.plannedFor,
        status: updated.status,
        priority: updated.priority,
      },
    };
  },
});

const collectPlannedExpenseAfterForecastStep = createStep({
  id: "collect-planned-expense-after-forecast",
  description: "Runs the forecast after applying the planned expense mutation.",
  inputSchema: mutatePlannedExpenseStateSchema,
  outputSchema: mutatePlannedExpenseStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.afterPlan) return inputData;

    const initial = getInitData<MutatePlannedExpenseInput>();
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

const buildPlannedExpenseMutationResultStep = createStep({
  id: "build-planned-expense-mutation-result",
  description: "Builds a structured mutation result with forecast impact.",
  inputSchema: mutatePlannedExpenseStateSchema,
  outputSchema: mutatePlannedExpenseOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok || !inputData.afterPlan || !inputData.currency) {
      return {
        ...inputData,
      };
    }

    const currency = inputData.currency;
    const minimumFreeCashDeltaMinor =
      inputData.afterForecast && inputData.baseline
        ? inputData.afterForecast.minimumFreeCashMinor - inputData.baseline.minimumFreeCashMinor
        : 0;
    return {
      ...inputData,
      changed: {
        entityType: "planned_expense" as const,
        entityId: inputData.afterPlan.id,
        name: inputData.afterPlan.name,
        action: changedAction(inputData.action),
      },
      impact:
        inputData.baseline && inputData.afterForecast
          ? {
              minimumFreeCashDeltaMinor,
              formattedMinimumFreeCashDelta: formatMoney(minimumFreeCashDeltaMinor, currency),
              baselineMinimumFreeCash: formatMoney(inputData.baseline.minimumFreeCashMinor, currency),
              afterMinimumFreeCash: formatMoney(inputData.afterForecast.minimumFreeCashMinor, currency),
              riskMonths: inputData.afterForecast.rows
                .filter((row) => row.riskLevel !== "ok")
                .map((row) => ({
                  month: row.month,
                  riskLevel: row.riskLevel as "tight" | "negative",
                  closingFreeCash: formatMoney(row.closingFreeCashMinor, currency),
                })),
            }
          : undefined,
      formattedPlan: {
        amount: formatMoney(inputData.afterPlan.amountMinor, currency),
        plannedFor: formatPlanDate(inputData.afterPlan.plannedFor),
        status: inputData.afterPlan.status,
        priority: inputData.afterPlan.priority,
      },
    };
  },
});

export const mutatePlannedExpense = createWorkflow({
  id: "mutate-planned-expense",
  inputSchema: mutatePlannedExpenseInputSchema,
  outputSchema: mutatePlannedExpenseOutputSchema,
})
  .then(loadPlannedExpenseProfileStep)
  .then(loadExistingPlannedExpenseStep)
  .then(collectPlannedExpenseBaselineStep)
  .then(applyPlannedExpenseMutationStep)
  .then(collectPlannedExpenseAfterForecastStep)
  .then(buildPlannedExpenseMutationResultStep)
  .commit();
