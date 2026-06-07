import { z } from "zod";

export const agentInputSchema = z.string();

export const agentIntentRoutingGroundTruthSchema = z.object({
  toolId: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const workflowInputSchema = z.record(z.string(), z.unknown());

export const workflowGroundTruthSchema = z.object({
  ok: z.boolean().optional(),
  changed: z
    .object({
      entityType: z.string().optional(),
      action: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  expectations: z.record(z.string(), z.unknown()).optional(),
});

export type EvalDatasetDefinition = {
  name: string;
  description: string;
  targetType?: "agent" | "workflow";
  targetIds?: string[];
  inputSchema: z.ZodType;
  groundTruthSchema: z.ZodType;
  items: Array<{
    input: unknown;
    groundTruth: unknown;
    metadata?: Record<string, unknown>;
  }>;
};

export const evalDatasetDefinitions: EvalDatasetDefinition[] = [
  {
    name: "fnpc-agent-intent-routing",
    description:
      "Neutral English prompts for checking that the FNPC agent routes user intent to the correct tool and arguments.",
    targetType: "agent",
    targetIds: ["fnpc"],
    inputSchema: agentInputSchema,
    groundTruthSchema: agentIntentRoutingGroundTruthSchema,
    items: [
      {
        input: "Move the office chair purchase to August.",
        groundTruth: {
          toolId: "mutate-planned-expense",
          args: { action: "move", name: "office chair", plannedFor: "2026-08" },
        },
        metadata: { category: "planned_expense", case: "move" },
      },
      {
        input: "Cancel the desk lamp plan, I don't need it anymore.",
        groundTruth: {
          toolId: "mutate-planned-expense",
          args: { action: "cancel", name: "desk lamp" },
        },
        metadata: { category: "planned_expense", case: "cancel" },
      },
      {
        input: "Can I buy a monitor for 12000 USD this month?",
        groundTruth: {
          toolId: "evaluate-purchase",
          args: { name: "monitor", amount: 12000 },
        },
        metadata: { category: "decision", case: "purchase_now" },
      },
      {
        input: "Show me the next three months of planned expenses.",
        groundTruth: {
          toolId: "generate-financial-report",
          args: { reportType: "forecast", horizonMonths: 3 },
        },
        metadata: { category: "report", case: "upcoming_plans" },
      },
      {
        input: "I spent 850 USD on a keyboard repair today.",
        groundTruth: {
          toolId: "record-actual-expense",
          args: { name: "keyboard repair", amount: 850, currency: "USD" },
        },
        metadata: { category: "actual_expense", case: "record" },
      },
      {
        input: "Where did the internet bill amount come from?",
        groundTruth: {
          toolId: "explain-financial-fact",
          args: { query: "internet bill" },
        },
        metadata: { category: "provenance", case: "explain_saved_fact" },
      },
      {
        input: "The coworking membership was charged.",
        groundTruth: {
          toolId: "mutate-recurring-expense",
          args: { action: "record_payment", name: "coworking membership" },
        },
        metadata: { category: "recurring_expense", case: "record_payment_without_amount" },
      },
      {
        input: "My operating account balance is 4200 USD.",
        groundTruth: {
          toolId: "update-account-balance",
          args: { targetType: "account", accountName: "Operating account", amount: 4200, currency: "USD" },
        },
        metadata: { category: "balance", case: "operating_account" },
      },
      {
        input: "Protected savings are 1200 USD now.",
        groundTruth: {
          toolId: "update-account-balance",
          args: { targetType: "savings_bucket", amount: 1200, currency: "USD", isProtected: true },
        },
        metadata: { category: "balance", case: "protected_savings_bucket" },
      },
      {
        input: "Move 500 USD into the reserve envelope.",
        groundTruth: {
          toolId: "transfer-to-savings",
          args: { action: "transfer_to_bucket", bucketName: "reserve", amount: 500, currency: "USD" },
        },
        metadata: { category: "savings_transfer", case: "transfer_to_bucket" },
      },
      {
        input: "I bought the bike from the reserve envelope for 900 USD.",
        groundTruth: {
          toolId: "transfer-to-savings",
          args: { action: "spend_from_bucket", bucketName: "reserve", expenseName: "bike", amount: 900, currency: "USD" },
        },
        metadata: { category: "savings_transfer", case: "spend_from_bucket" },
      },
      {
        input: "How much free operating cash do I have right now?",
        groundTruth: {
          toolId: "get-financial-snapshot",
          args: { field: "availableOperatingCash" },
        },
        metadata: { category: "snapshot", case: "current_free_cash_not_forecast" },
      },
      {
        input: "How much will be left by the end of this month?",
        groundTruth: {
          toolId: "generate-financial-report",
          args: { reportType: "forecast", horizonMonths: 1 },
        },
        metadata: { category: "forecast", case: "end_of_month" },
      },
      {
        input: "I want to save 20000 USD per month into the car envelope from my existing savings contribution.",
        groundTruth: {
          toolId: "save-financial-facts",
          args: { savingsRules: [{ type: "monthly_fixed", amount: 20000, bucketName: "car", mode: "reallocate_type" }] },
        },
        metadata: { category: "savings", case: "bucket_contribution" },
      },
      {
        input:
          "Split my existing 30000 USD monthly savings rule: 20000 USD should go to the used car envelope and 10000 USD should remain general savings.",
        groundTruth: {
          toolId: "save-financial-facts",
          args: {
            savingsRules: [
              { type: "monthly_fixed", amount: 20000, bucketName: "used car", mode: "reallocate_type" },
              { type: "monthly_fixed", amount: 10000, mode: "create_or_update" },
            ],
          },
        },
        metadata: { category: "savings", case: "split_existing_contribution" },
      },
      {
        input: "Can you google the current used sedan price?",
        groundTruth: {
          toolId: "none",
          args: { behavior: "state_no_live_web_access_and_ask_for_amount_or_estimate_confirmation" },
        },
        metadata: { category: "web_limit", case: "no_live_lookup" },
      },
    ],
  },
  {
    name: "fnpc-date-understanding",
    description:
      "Stable English date normalization cases for agent routing. Inputs avoid real personal data and use explicit reference dates.",
    targetType: "agent",
    targetIds: ["fnpc"],
    inputSchema: agentInputSchema,
    groundTruthSchema: agentIntentRoutingGroundTruthSchema,
    items: [
      {
        input:
          "Reference date: 2026-06-02. Timezone: UTC. Move the training course to next month.",
        groundTruth: {
          toolId: "mutate-planned-expense",
          args: { action: "move", name: "training course", plannedFor: "2026-07" },
        },
        metadata: { category: "date", case: "next_month" },
      },
      {
        input: "Reference date: 2026-06-02. Timezone: UTC. Add the backpack purchase for October.",
        groundTruth: {
          toolId: "mutate-planned-expense",
          args: { action: "create", name: "backpack", plannedFor: "2026-10" },
        },
        metadata: { category: "date", case: "month_name" },
      },
      {
        input:
          "Reference date: 2026-06-02. Timezone: UTC. Can I buy a coffee machine on July 15 for 4500 USD?",
        groundTruth: {
          toolId: "evaluate-purchase",
          args: { name: "coffee machine", amount: 4500, plannedFor: "2026-07-15" },
        },
        metadata: { category: "date", case: "explicit_day" },
      },
    ],
  },
  {
    name: "fnpc-planned-expense-workflow",
    description:
      "Synthetic workflow inputs for mutatePlannedExpense. Use only with fixture users/resources, not with real user data.",
    targetType: "workflow",
    targetIds: ["mutatePlannedExpense"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:planned-expense:create",
          action: "create",
          name: "desk organizer",
          amount: 1200,
          currency: "USD",
          plannedFor: "2026-07",
          horizonMonths: 3,
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "planned_expense", action: "created", name: "desk organizer" },
          expectations: { afterStatus: "planned", afterMonth: "2026-07" },
        },
        metadata: { category: "workflow", case: "create" },
      },
      {
        input: {
          mastraResourceId: "eval:planned-expense:move",
          action: "move",
          name: "language course",
          plannedFor: "2026-09",
          horizonMonths: 4,
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "planned_expense", action: "moved", name: "language course" },
          expectations: { afterMonth: "2026-09" },
        },
        metadata: { category: "workflow", case: "move_requires_fixture_plan" },
      },
      {
        input: {
          mastraResourceId: "eval:planned-expense:cancel",
          action: "cancel",
          name: "side table",
          horizonMonths: 3,
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "planned_expense", action: "cancelled", name: "side table" },
          expectations: { afterStatus: "cancelled" },
        },
        metadata: { category: "workflow", case: "cancel_requires_fixture_plan" },
      },
    ],
  },
  {
    name: "fnpc-purchase-decision-workflow",
    description:
      "Synthetic workflow inputs for evaluatePurchase. Cases are neutral purchases and expected structured decision fields.",
    targetType: "workflow",
    targetIds: ["evaluatePurchase"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:purchase:monitor",
          name: "monitor",
          amount: 12000,
          plannedFor: "2026-07",
          horizonMonths: 6,
        },
        groundTruth: {
          ok: true,
          expectations: {
            hasVerdict: true,
            hasBaseline: true,
            hasScenarioForecast: true,
            doesNotPersistPlan: true,
          },
        },
        metadata: { category: "workflow", case: "purchase_scenario" },
      },
      {
        input: {
          mastraResourceId: "eval:purchase:appliance",
          name: "small appliance",
          amount: 6500,
          horizonMonths: 3,
        },
        groundTruth: {
          ok: true,
          expectations: {
            hasImpact: true,
            protectedSavingsNotSpendableByDefault: true,
          },
        },
        metadata: { category: "workflow", case: "purchase_now" },
      },
    ],
  },
  {
    name: "fnpc-actual-expense-workflow",
    description:
      "Synthetic workflow inputs for recordActualExpense. Checks explicit payments and matching saved recurring expenses when amount is omitted.",
    targetType: "workflow",
    targetIds: ["recordActualExpense"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:actual-expense:explicit",
          name: "keyboard repair",
          amount: 850,
          currency: "USD",
          spentAt: "2026-06-02",
          sourceMessageId: "eval-message:actual-expense-explicit",
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "actual_expense", action: "created", name: "keyboard repair" },
          expectations: {
            amount: 850,
            usesUserProvidedAmount: true,
            debitsOperatingAccount: true,
            createsAdjustedAccountBalance: true,
          },
        },
        metadata: { category: "workflow", case: "explicit_actual_expense" },
      },
      {
        input: {
          mastraResourceId: "eval:actual-expense:recurring-match",
          name: "internet bill",
          spentAt: "2026-06-02",
          sourceMessageId: "eval-message:actual-expense-recurring-match",
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "actual_expense", action: "created", name: "internet service" },
          expectations: {
            amountTakenFromRecurring: true,
            doesNotCreateRecurringExpense: true,
            debitsOperatingAccount: true,
          },
        },
        metadata: { category: "workflow", case: "match_recurring_without_amount" },
      },
    ],
  },
  {
    name: "fnpc-explain-fact-workflow",
    description:
      "Synthetic workflow inputs for explainFinancialFact. Checks that saved event provenance can be retrieved instead of guessed.",
    targetType: "workflow",
    targetIds: ["explainFinancialFact"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:explain:recurring-event",
          query: "internet service",
          entityName: "internet service",
          limit: 5,
        },
        groundTruth: {
          ok: true,
          expectations: {
            hasEvidence: true,
            sourceIncludesFinancialEvent: true,
            doesNotHallucinateMissingHistory: true,
          },
        },
        metadata: { category: "workflow", case: "explain_financial_event" },
      },
      {
        input: {
          mastraResourceId: "eval:explain:no-evidence",
          query: "nonexistent camera drone",
          limit: 5,
        },
        groundTruth: {
          ok: true,
          expectations: {
            missingEvidence: true,
            noInventedFacts: true,
          },
        },
        metadata: { category: "workflow", case: "missing_evidence" },
      },
    ],
  },
  {
    name: "fnpc-recurring-expense-workflow",
    description:
      "Synthetic workflow inputs for mutateRecurringExpense. Checks update, delete, and recording a recurring payment without creating duplicate recurring facts.",
    targetType: "workflow",
    targetIds: ["mutateRecurringExpense"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:recurring:update",
          action: "update",
          name: "coworking membership",
          amount: 325,
          horizonMonths: 3,
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "recurring_expense", action: "updated", name: "coworking membership" },
          expectations: {
            amount: 325,
            doesNotCreateDuplicate: true,
          },
        },
        metadata: { category: "workflow", case: "update_existing_recurring" },
      },
      {
        input: {
          mastraResourceId: "eval:recurring:delete",
          action: "delete",
          name: "coworking membership",
          horizonMonths: 3,
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "recurring_expense", action: "deleted", name: "coworking membership" },
          expectations: {
            afterInactive: true,
          },
        },
        metadata: { category: "workflow", case: "delete_existing_recurring" },
      },
      {
        input: {
          mastraResourceId: "eval:recurring:payment",
          action: "record_payment",
          name: "coworking was charged",
          spentAt: "2026-06-02",
          sourceMessageId: "eval-message:recurring-payment",
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "actual_expense", action: "paid", name: "coworking membership" },
          expectations: {
            amountTakenFromRecurring: true,
            doesNotCreateRecurringExpense: true,
          },
        },
        metadata: { category: "workflow", case: "record_payment_without_amount" },
      },
    ],
  },
  {
    name: "fnpc-account-balance-workflow",
    description:
      "Synthetic workflow inputs for updateAccountBalance. Checks that account balances and protected savings buckets are updated as separate concepts.",
    targetType: "workflow",
    targetIds: ["updateAccountBalance"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:balance:operating",
          targetType: "account",
          accountName: "Operating account",
          accountType: "checking",
          amount: 4200,
          currency: "USD",
          asOf: "2026-06-02",
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "account_balance", action: "created", name: "Operating account" },
          expectations: {
            totalCashUpdates: true,
            protectedSavingsUnchanged: true,
          },
        },
        metadata: { category: "workflow", case: "operating_account_balance" },
      },
      {
        input: {
          mastraResourceId: "eval:balance:cash",
          targetType: "account",
          accountName: "Cash",
          accountType: "cash",
          amount: 350,
          currency: "USD",
          asOf: "2026-06-02",
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "account_balance", action: "created", name: "Cash" },
          expectations: {
            createsCashAccountWhenMissing: true,
          },
        },
        metadata: { category: "workflow", case: "cash_balance" },
      },
      {
        input: {
          mastraResourceId: "eval:balance:protected-savings",
          targetType: "savings_bucket",
          bucketName: "reserve",
          amount: 1200,
          currency: "USD",
          isProtected: true,
        },
        groundTruth: {
          ok: true,
          changed: { entityType: "savings_bucket", action: "updated", name: "reserve" },
          expectations: {
            protectedSavingsUpdates: true,
            doesNotCreateSpendableAccount: true,
          },
        },
        metadata: { category: "workflow", case: "protected_savings_bucket_balance" },
      },
    ],
  },
  {
    name: "fnpc-savings-transfer-workflow",
    description:
      "Synthetic workflow inputs for transferToSavings. Checks moving money into protected buckets and spending from a bucket without creating fake accounts.",
    targetType: "workflow",
    targetIds: ["transferToSavings"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:transfer:to-bucket",
          action: "transfer_to_bucket",
          bucketName: "reserve",
          amount: 500,
          currency: "USD",
        },
        groundTruth: {
          ok: true,
          expectations: {
            bucketIncreases: true,
            doesNotCreateAccount: true,
            availableOperatingCashDecreases: true,
          },
        },
        metadata: { category: "workflow", case: "transfer_to_bucket" },
      },
      {
        input: {
          mastraResourceId: "eval:transfer:from-bucket",
          action: "transfer_from_bucket",
          bucketName: "reserve",
          accountName: "Operating account",
          amount: 300,
          currency: "USD",
          asOf: "2026-06-02",
        },
        groundTruth: {
          ok: true,
          expectations: {
            bucketDecreases: true,
            accountBalanceAdjusts: true,
          },
        },
        metadata: { category: "workflow", case: "transfer_from_bucket" },
      },
      {
        input: {
          mastraResourceId: "eval:transfer:spend-bucket",
          action: "spend_from_bucket",
          bucketName: "reserve",
          accountName: "Operating account",
          expenseName: "bike",
          amount: 900,
          currency: "USD",
          spentAt: "2026-06-02",
        },
        groundTruth: {
          ok: true,
          expectations: {
            bucketDecreases: true,
            actualExpenseCreated: true,
            accountBalanceDecreases: true,
          },
        },
        metadata: { category: "workflow", case: "spend_from_bucket" },
      },
    ],
  },
  {
    name: "fnpc-report-workflow",
    description:
      "Synthetic workflow inputs for generateFinancialReport. Checks report shape rather than exact personal values.",
    targetType: "workflow",
    targetIds: ["generateFinancialReport"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:report:daily",
          reportType: "daily",
          horizonMonths: 3,
        },
        groundTruth: {
          ok: true,
          expectations: {
            hasFormattedTotals: true,
            hasUpcomingPlans: true,
            hasForecastRows: true,
          },
        },
        metadata: { category: "workflow", case: "daily_report" },
      },
      {
        input: {
          mastraResourceId: "eval:report:forecast",
          reportType: "forecast",
          horizonMonths: 6,
        },
        groundTruth: {
          ok: true,
          expectations: {
            horizonMonths: 6,
            hasRiskMonths: true,
          },
        },
        metadata: { category: "workflow", case: "forecast_report" },
      },
    ],
  },
  {
    name: "fnpc-savings-plan-workflow",
    description:
      "Synthetic workflow inputs for mutateSavingsPlan. Checks bucket creation, contribution setting, and reallocating existing savings instead of adding on top.",
    targetType: "workflow",
    targetIds: ["mutateSavingsPlan"],
    inputSchema: workflowInputSchema,
    groundTruthSchema: workflowGroundTruthSchema,
    items: [
      {
        input: {
          mastraResourceId: "eval:savings:create-bucket",
          action: "create_bucket",
          bucketName: "used car",
          targetAmount: 60000,
          currency: "USD",
          isProtected: true,
        },
        groundTruth: {
          ok: true,
          expectations: {
            hasBucket: true,
            targetAmount: 60000,
          },
        },
        metadata: { category: "workflow", case: "create_bucket" },
      },
      {
        input: {
          mastraResourceId: "eval:savings:set-contribution",
          action: "set_bucket_contribution",
          bucketName: "reserve",
          monthlyAmount: 15000,
          dayOfMonth: 1,
        },
        groundTruth: {
          ok: true,
          expectations: {
            monthlySavingsContributionIncreases: true,
          },
        },
        metadata: { category: "workflow", case: "set_bucket_contribution" },
      },
      {
        input: {
          mastraResourceId: "eval:savings:reallocate",
          action: "reallocate_monthly_fixed",
          bucketName: "used car",
          targetAmount: 60000,
          monthlyAmount: 20000,
          dayOfMonth: 1,
        },
        groundTruth: {
          ok: true,
          expectations: {
            totalMonthlySavingsStaysAt: 30000,
            bucketContribution: 20000,
            generalContribution: 10000,
          },
        },
        metadata: { category: "workflow", case: "reallocate_existing_monthly_fixed" },
      },
    ],
  },
];
