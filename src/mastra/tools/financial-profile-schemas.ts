import { z } from "zod";

export const accountSchema = z.object({
  name: z.string(),
  type: z.enum(["checking", "cash", "savings", "brokerage", "crypto", "other"]).optional(),
  currency: z.string().length(3).optional(),
  balance: z.number().optional(),
  balanceAsOf: z.string().optional(),
});

export const incomeRuleSchema = z.object({
  name: z.string(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  expectedDayFrom: z.number().int().min(1).max(31).optional(),
  expectedDayTo: z.number().int().min(1).max(31).optional(),
  defaultDay: z.number().int().min(1).max(31).optional(),
});

export const recurringExpenseSchema = z.object({
  name: z.string(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  isEssential: z.boolean().optional(),
});

export const plannedExpenseSchema = z.object({
  name: z.string(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  plannedFor: z.string().describe("YYYY-MM or ISO date"),
  priority: z.enum(["must", "should", "nice_to_have"]).optional(),
});

export const actualExpenseSchema = z.object({
  name: z.string(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  spentAt: z.string().optional().describe("ISO date/time, defaults to now"),
  note: z.string().optional(),
});

export const savingsBucketSchema = z.object({
  name: z.string(),
  currentAmount: z.number().optional(),
  targetAmount: z.number().optional(),
  currency: z.string().length(3).optional(),
  isProtected: z.boolean().optional(),
  priority: z.number().int().optional(),
});

export const savingsRuleSchema = z.object({
  type: z.enum(["monthly_fixed", "percentage_of_income", "leftover"]),
  amount: z.number().optional(),
  percent: z.number().optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  bucketName: z.string().optional(),
  mode: z
    .enum(["create_or_update", "replace_type", "reallocate_type"])
    .default("create_or_update")
    .describe(
      "create_or_update upserts a matching rule. replace_type deactivates other active rules of this type first. reallocate_type means this rule is part of replacing the existing total contribution for the type, not adding on top.",
    ),
});

export const deleteFactSchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.enum(["account", "income_rule", "recurring_expense", "planned_expense"]),
    name: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    entityType: z.literal("savings_rule"),
    ruleType: z.enum(["monthly_fixed", "percentage_of_income", "leftover"]),
    reason: z.string().optional(),
  }),
]);

export const financialFactsPatchSchema = z.object({
  accounts: z.array(accountSchema).default([]),
  incomeRules: z.array(incomeRuleSchema).default([]),
  recurringExpenses: z.array(recurringExpenseSchema).default([]),
  plannedExpenses: z.array(plannedExpenseSchema).default([]),
  actualExpenses: z.array(actualExpenseSchema).default([]),
  savingsBuckets: z.array(savingsBucketSchema).default([]),
  savingsRules: z.array(savingsRuleSchema).default([]),
  deleteFacts: z.array(deleteFactSchema).default([]),
});

export const needsDefaultCurrency = (input: z.infer<typeof financialFactsPatchSchema>) =>
  [
    ...input.accounts,
    ...input.incomeRules,
    ...input.recurringExpenses,
    ...input.plannedExpenses,
    ...input.actualExpenses,
    ...input.savingsBuckets,
  ].some((item) => !item.currency);

export const needsTimezone = (input: z.infer<typeof financialFactsPatchSchema>) =>
  input.accounts.some((account) => typeof account.balance === "number");
