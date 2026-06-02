import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum("financial_account_type", [
  "checking",
  "cash",
  "savings",
  "brokerage",
  "crypto",
  "other",
]);

export const balanceSourceEnum = pgEnum("financial_balance_source", [
  "user_reported",
  "imported",
  "adjusted",
]);

export const categoryKindEnum = pgEnum("financial_category_kind", [
  "income",
  "expense",
  "savings",
  "transfer",
]);

export const expensePriorityEnum = pgEnum("financial_expense_priority", [
  "must",
  "should",
  "nice_to_have",
]);

export const expenseStatusEnum = pgEnum("financial_expense_status", [
  "planned",
  "approved",
  "paid",
  "cancelled",
  "moved",
]);

export const incomeStatusEnum = pgEnum("financial_income_status", [
  "planned",
  "received",
  "skipped",
]);

export const recurringFrequencyEnum = pgEnum("financial_recurring_frequency", [
  "monthly",
  "weekly",
  "yearly",
]);

export const savingsRuleTypeEnum = pgEnum("financial_savings_rule_type", [
  "monthly_fixed",
  "percentage_of_income",
  "leftover",
]);

export const fundingSourceEnum = pgEnum("financial_funding_source", [
  "free_cash",
  "savings_bucket",
  "account",
]);

export const goalStatusEnum = pgEnum("financial_goal_status", [
  "active",
  "paused",
  "completed",
  "cancelled",
]);

export const eventEntityTypeEnum = pgEnum("financial_event_entity_type", [
  "user_preferences",
  "account",
  "account_balance",
  "income_rule",
  "income_event",
  "recurring_expense",
  "planned_expense",
  "actual_expense",
  "savings_bucket",
  "savings_rule",
  "goal",
  "forecast_run",
]);

export const eventTypeEnum = pgEnum("financial_event_type", [
  "created",
  "updated",
  "moved",
  "deleted",
  "paid",
  "cancelled",
  "received",
  "adjusted",
]);

const idColumn = () => uuid("id").primaryKey().defaultRandom();
const createdAtColumn = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAtColumn = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const currencyColumn = (name = "currency") => varchar(name, { length: 3 }).notNull();

export const users = pgTable(
  "financial_users",
  {
    id: idColumn(),
    telegramUserId: text("telegram_user_id"),
    mastraResourceId: text("mastra_resource_id"),
    displayName: text("display_name"),
    defaultCurrency: varchar("default_currency", { length: 3 }),
    timezone: text("timezone"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("financial_users_telegram_user_id_idx").on(table.telegramUserId),
    uniqueIndex("financial_users_mastra_resource_id_idx").on(table.mastraResourceId),
  ],
);

export const userPreferences = pgTable(
  "financial_user_preferences",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    preferredName: text("preferred_name"),
    responseLanguage: text("response_language"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("financial_user_preferences_user_id_idx").on(table.userId),
  ],
);

export const categories = pgTable(
  "financial_categories",
  {
    id: idColumn(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    kind: categoryKindEnum("kind").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("financial_categories_user_id_idx").on(table.userId),
    index("financial_categories_parent_id_idx").on(table.parentId),
  ],
);

export const accounts = pgTable(
  "financial_accounts",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull().default("checking"),
    currency: currencyColumn(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("financial_accounts_user_id_idx").on(table.userId)],
);

export const accountBalances = pgTable(
  "financial_account_balances",
  {
    id: idColumn(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    source: balanceSourceEnum("source").notNull().default("user_reported"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("financial_account_balances_account_id_idx").on(table.accountId),
    index("financial_account_balances_as_of_idx").on(table.asOf),
  ],
);

export const savingsBuckets = pgTable(
  "financial_savings_buckets",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetAmountMinor: integer("target_amount_minor"),
    currentAmountMinor: integer("current_amount_minor").notNull().default(0),
    currency: currencyColumn(),
    isProtected: boolean("is_protected").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("financial_savings_buckets_user_id_idx").on(table.userId)],
);

export const savingsRules = pgTable(
  "financial_savings_rules",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bucketId: uuid("bucket_id").references(() => savingsBuckets.id, { onDelete: "set null" }),
    type: savingsRuleTypeEnum("type").notNull(),
    amountMinor: integer("amount_minor"),
    percentBps: integer("percent_bps"),
    dayOfMonth: integer("day_of_month"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("financial_savings_rules_user_id_idx").on(table.userId),
    index("financial_savings_rules_bucket_id_idx").on(table.bucketId),
  ],
);

export const incomeRules = pgTable(
  "financial_income_rules",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: currencyColumn(),
    frequency: recurringFrequencyEnum("frequency").notNull().default("monthly"),
    expectedDayFrom: integer("expected_day_from"),
    expectedDayTo: integer("expected_day_to"),
    defaultDay: integer("default_day"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("financial_income_rules_user_id_idx").on(table.userId)],
);

export const incomeEvents = pgTable(
  "financial_income_events",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    incomeRuleId: uuid("income_rule_id").references(() => incomeRules.id, { onDelete: "set null" }),
    amountMinor: integer("amount_minor").notNull(),
    currency: currencyColumn(),
    expectedDate: timestamp("expected_date", { withTimezone: true }),
    receivedDate: timestamp("received_date", { withTimezone: true }),
    status: incomeStatusEnum("status").notNull().default("planned"),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("financial_income_events_user_id_idx").on(table.userId),
    index("financial_income_events_income_rule_id_idx").on(table.incomeRuleId),
  ],
);

export const recurringExpenses = pgTable(
  "financial_recurring_expenses",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: currencyColumn(),
    frequency: recurringFrequencyEnum("frequency").notNull().default("monthly"),
    dayOfMonth: integer("day_of_month"),
    isEssential: boolean("is_essential").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    startsOn: timestamp("starts_on", { withTimezone: true }),
    endsOn: timestamp("ends_on", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("financial_recurring_expenses_user_id_idx").on(table.userId),
    index("financial_recurring_expenses_category_id_idx").on(table.categoryId),
  ],
);

export const plannedExpenses = pgTable(
  "financial_planned_expenses",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: currencyColumn(),
    plannedFor: timestamp("planned_for", { withTimezone: true }).notNull(),
    status: expenseStatusEnum("status").notNull().default("planned"),
    priority: expensePriorityEnum("priority").notNull().default("should"),
    fundingSource: fundingSourceEnum("funding_source").notNull().default("free_cash"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    savingsBucketId: uuid("savings_bucket_id").references(() => savingsBuckets.id, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("financial_planned_expenses_user_id_idx").on(table.userId),
    index("financial_planned_expenses_planned_for_idx").on(table.plannedFor),
    index("financial_planned_expenses_status_idx").on(table.status),
  ],
);

export const actualExpenses = pgTable(
  "financial_actual_expenses",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    plannedExpenseId: uuid("planned_expense_id").references(() => plannedExpenses.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: currencyColumn(),
    spentAt: timestamp("spent_at", { withTimezone: true }).notNull(),
    source: text("source").notNull().default("telegram"),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("financial_actual_expenses_user_id_idx").on(table.userId),
    index("financial_actual_expenses_spent_at_idx").on(table.spentAt),
    index("financial_actual_expenses_planned_expense_id_idx").on(table.plannedExpenseId),
  ],
);

export const financialGoals = pgTable(
  "financial_goals",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetAmountMinor: integer("target_amount_minor").notNull(),
    currency: currencyColumn(),
    targetDate: timestamp("target_date", { withTimezone: true }),
    priority: integer("priority").notNull().default(100),
    status: goalStatusEnum("status").notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("financial_goals_user_id_idx").on(table.userId)],
);

export const forecastRuns = pgTable(
  "financial_forecast_runs",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    horizonMonths: integer("horizon_months").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    inputSnapshot: jsonb("input_snapshot").notNull(),
    resultSummary: jsonb("result_summary").notNull(),
    sourceMessageId: text("source_message_id"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("financial_forecast_runs_user_id_idx").on(table.userId),
    index("financial_forecast_runs_started_at_idx").on(table.startedAt),
  ],
);

export const forecastRunItems = pgTable(
  "financial_forecast_run_items",
  {
    id: idColumn(),
    forecastRunId: uuid("forecast_run_id").notNull().references(() => forecastRuns.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    openingFreeCashMinor: integer("opening_free_cash_minor").notNull(),
    incomeMinor: integer("income_minor").notNull(),
    recurringExpensesMinor: integer("recurring_expenses_minor").notNull(),
    plannedExpensesMinor: integer("planned_expenses_minor").notNull(),
    actualExpensesMinor: integer("actual_expenses_minor").notNull(),
    savingsContributionsMinor: integer("savings_contributions_minor").notNull(),
    closingFreeCashMinor: integer("closing_free_cash_minor").notNull(),
    protectedSavingsMinor: integer("protected_savings_minor").notNull(),
    riskLevel: text("risk_level").notNull(),
  },
  (table) => [
    index("financial_forecast_run_items_forecast_run_id_idx").on(table.forecastRunId),
    index("financial_forecast_run_items_month_idx").on(table.month),
  ],
);

export const financialEvents = pgTable(
  "financial_events",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    entityType: eventEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    eventType: eventTypeEnum("event_type").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    sourceMessageId: text("source_message_id"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("financial_events_user_id_idx").on(table.userId),
    index("financial_events_entity_idx").on(table.entityType, table.entityId),
    index("financial_events_created_at_idx").on(table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type AccountBalance = typeof accountBalances.$inferSelect;
export type NewAccountBalance = typeof accountBalances.$inferInsert;
export type SavingsBucket = typeof savingsBuckets.$inferSelect;
export type NewSavingsBucket = typeof savingsBuckets.$inferInsert;
export type IncomeRule = typeof incomeRules.$inferSelect;
export type NewIncomeRule = typeof incomeRules.$inferInsert;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;
export type PlannedExpense = typeof plannedExpenses.$inferSelect;
export type NewPlannedExpense = typeof plannedExpenses.$inferInsert;
export type ActualExpense = typeof actualExpenses.$inferSelect;
export type NewActualExpense = typeof actualExpenses.$inferInsert;
