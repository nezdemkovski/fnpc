CREATE TYPE "financial_account_type" AS ENUM('checking', 'cash', 'savings', 'brokerage', 'crypto', 'other');--> statement-breakpoint
CREATE TYPE "financial_balance_source" AS ENUM('user_reported', 'imported', 'adjusted');--> statement-breakpoint
CREATE TYPE "financial_category_kind" AS ENUM('income', 'expense', 'savings', 'transfer');--> statement-breakpoint
CREATE TYPE "financial_event_entity_type" AS ENUM('account', 'account_balance', 'income_rule', 'income_event', 'recurring_expense', 'planned_expense', 'actual_expense', 'savings_bucket', 'savings_rule', 'goal', 'forecast_run');--> statement-breakpoint
CREATE TYPE "financial_event_type" AS ENUM('created', 'updated', 'moved', 'deleted', 'paid', 'cancelled', 'received', 'adjusted');--> statement-breakpoint
CREATE TYPE "financial_expense_priority" AS ENUM('must', 'should', 'nice_to_have');--> statement-breakpoint
CREATE TYPE "financial_expense_status" AS ENUM('planned', 'approved', 'paid', 'cancelled', 'moved');--> statement-breakpoint
CREATE TYPE "financial_funding_source" AS ENUM('free_cash', 'savings_bucket', 'account');--> statement-breakpoint
CREATE TYPE "financial_goal_status" AS ENUM('active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "financial_income_status" AS ENUM('planned', 'received', 'skipped');--> statement-breakpoint
CREATE TYPE "financial_recurring_frequency" AS ENUM('monthly', 'weekly', 'yearly');--> statement-breakpoint
CREATE TYPE "financial_savings_rule_type" AS ENUM('monthly_fixed', 'percentage_of_income', 'leftover');--> statement-breakpoint
CREATE TABLE "financial_account_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" "financial_balance_source" DEFAULT 'user_reported'::"financial_balance_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "financial_account_type" DEFAULT 'checking'::"financial_account_type" NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_actual_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"planned_expense_id" uuid,
	"account_id" uuid,
	"name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"spent_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'telegram' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" "financial_category_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"entity_type" "financial_event_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" "financial_event_type" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"source_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"target_date" timestamp with time zone,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" "financial_goal_status" DEFAULT 'active'::"financial_goal_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_forecast_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"forecast_run_id" uuid NOT NULL,
	"month" text NOT NULL,
	"opening_free_cash_minor" integer NOT NULL,
	"income_minor" integer NOT NULL,
	"recurring_expenses_minor" integer NOT NULL,
	"planned_expenses_minor" integer NOT NULL,
	"actual_expenses_minor" integer NOT NULL,
	"savings_contributions_minor" integer NOT NULL,
	"closing_free_cash_minor" integer NOT NULL,
	"protected_savings_minor" integer NOT NULL,
	"risk_level" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_forecast_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"horizon_months" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result_summary" jsonb NOT NULL,
	"source_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_income_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"income_rule_id" uuid,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"expected_date" timestamp with time zone,
	"received_date" timestamp with time zone,
	"status" "financial_income_status" DEFAULT 'planned'::"financial_income_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_income_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"frequency" "financial_recurring_frequency" DEFAULT 'monthly'::"financial_recurring_frequency" NOT NULL,
	"expected_day_from" integer,
	"expected_day_to" integer,
	"default_day" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_planned_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"planned_for" timestamp with time zone NOT NULL,
	"status" "financial_expense_status" DEFAULT 'planned'::"financial_expense_status" NOT NULL,
	"priority" "financial_expense_priority" DEFAULT 'should'::"financial_expense_priority" NOT NULL,
	"funding_source" "financial_funding_source" DEFAULT 'free_cash'::"financial_funding_source" NOT NULL,
	"account_id" uuid,
	"savings_bucket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"frequency" "financial_recurring_frequency" DEFAULT 'monthly'::"financial_recurring_frequency" NOT NULL,
	"day_of_month" integer,
	"is_essential" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_on" timestamp with time zone,
	"ends_on" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_savings_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_amount_minor" integer,
	"current_amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"is_protected" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_savings_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"bucket_id" uuid,
	"type" "financial_savings_rule_type" NOT NULL,
	"amount_minor" integer,
	"percent_bps" integer,
	"day_of_month" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"telegram_user_id" text,
	"mastra_resource_id" text,
	"display_name" text,
	"default_currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "financial_account_balances_account_id_idx" ON "financial_account_balances" ("account_id");--> statement-breakpoint
CREATE INDEX "financial_account_balances_as_of_idx" ON "financial_account_balances" ("as_of");--> statement-breakpoint
CREATE INDEX "financial_accounts_user_id_idx" ON "financial_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_actual_expenses_user_id_idx" ON "financial_actual_expenses" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_actual_expenses_spent_at_idx" ON "financial_actual_expenses" ("spent_at");--> statement-breakpoint
CREATE INDEX "financial_actual_expenses_planned_expense_id_idx" ON "financial_actual_expenses" ("planned_expense_id");--> statement-breakpoint
CREATE INDEX "financial_categories_user_id_idx" ON "financial_categories" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_categories_parent_id_idx" ON "financial_categories" ("parent_id");--> statement-breakpoint
CREATE INDEX "financial_events_user_id_idx" ON "financial_events" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_events_entity_idx" ON "financial_events" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "financial_events_created_at_idx" ON "financial_events" ("created_at");--> statement-breakpoint
CREATE INDEX "financial_goals_user_id_idx" ON "financial_goals" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_forecast_run_items_forecast_run_id_idx" ON "financial_forecast_run_items" ("forecast_run_id");--> statement-breakpoint
CREATE INDEX "financial_forecast_run_items_month_idx" ON "financial_forecast_run_items" ("month");--> statement-breakpoint
CREATE INDEX "financial_forecast_runs_user_id_idx" ON "financial_forecast_runs" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_forecast_runs_started_at_idx" ON "financial_forecast_runs" ("started_at");--> statement-breakpoint
CREATE INDEX "financial_income_events_user_id_idx" ON "financial_income_events" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_income_events_income_rule_id_idx" ON "financial_income_events" ("income_rule_id");--> statement-breakpoint
CREATE INDEX "financial_income_rules_user_id_idx" ON "financial_income_rules" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_planned_expenses_user_id_idx" ON "financial_planned_expenses" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_planned_expenses_planned_for_idx" ON "financial_planned_expenses" ("planned_for");--> statement-breakpoint
CREATE INDEX "financial_planned_expenses_status_idx" ON "financial_planned_expenses" ("status");--> statement-breakpoint
CREATE INDEX "financial_recurring_expenses_user_id_idx" ON "financial_recurring_expenses" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_recurring_expenses_category_id_idx" ON "financial_recurring_expenses" ("category_id");--> statement-breakpoint
CREATE INDEX "financial_savings_buckets_user_id_idx" ON "financial_savings_buckets" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_savings_rules_user_id_idx" ON "financial_savings_rules" ("user_id");--> statement-breakpoint
CREATE INDEX "financial_savings_rules_bucket_id_idx" ON "financial_savings_rules" ("bucket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_users_telegram_user_id_idx" ON "financial_users" ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_users_mastra_resource_id_idx" ON "financial_users" ("mastra_resource_id");--> statement-breakpoint
ALTER TABLE "financial_account_balances" ADD CONSTRAINT "financial_account_balances_LOBYPOro84wG_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" ADD CONSTRAINT "financial_actual_expenses_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" ADD CONSTRAINT "financial_actual_expenses_Q6elkM7oU0w4_fkey" FOREIGN KEY ("category_id") REFERENCES "financial_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" ADD CONSTRAINT "financial_actual_expenses_NRxApPFP6OXL_fkey" FOREIGN KEY ("planned_expense_id") REFERENCES "financial_planned_expenses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" ADD CONSTRAINT "financial_actual_expenses_account_id_financial_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_forecast_run_items" ADD CONSTRAINT "financial_forecast_run_items_9EFmPywST6aJ_fkey" FOREIGN KEY ("forecast_run_id") REFERENCES "financial_forecast_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_forecast_runs" ADD CONSTRAINT "financial_forecast_runs_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_income_events" ADD CONSTRAINT "financial_income_events_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_income_events" ADD CONSTRAINT "financial_income_events_o69Rd8qj4vnc_fkey" FOREIGN KEY ("income_rule_id") REFERENCES "financial_income_rules"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_income_rules" ADD CONSTRAINT "financial_income_rules_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" ADD CONSTRAINT "financial_planned_expenses_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" ADD CONSTRAINT "financial_planned_expenses_eKIc2jHXlqa4_fkey" FOREIGN KEY ("category_id") REFERENCES "financial_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" ADD CONSTRAINT "financial_planned_expenses_M5sYDqnCltYl_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" ADD CONSTRAINT "financial_planned_expenses_hmiL8DXmBQAL_fkey" FOREIGN KEY ("savings_bucket_id") REFERENCES "financial_savings_buckets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_recurring_expenses" ADD CONSTRAINT "financial_recurring_expenses_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_recurring_expenses" ADD CONSTRAINT "financial_recurring_expenses_ujrOwRPpepof_fkey" FOREIGN KEY ("category_id") REFERENCES "financial_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "financial_savings_buckets" ADD CONSTRAINT "financial_savings_buckets_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_savings_rules" ADD CONSTRAINT "financial_savings_rules_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "financial_savings_rules" ADD CONSTRAINT "financial_savings_rules_CKgpsVHn0gLQ_fkey" FOREIGN KEY ("bucket_id") REFERENCES "financial_savings_buckets"("id") ON DELETE SET NULL;