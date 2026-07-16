CREATE TYPE "fnpc_mutation_status" AS ENUM('pending', 'committed', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "fnpc_mutation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"mastra_resource_id" text NOT NULL,
	"action" text NOT NULL,
	"source_message_id" text,
	"ynab_entity_type" text,
	"ynab_entity_id" text,
	"idempotency_key" text NOT NULL,
	"status" "fnpc_mutation_status" DEFAULT 'pending'::"fnpc_mutation_status" NOT NULL,
	"request" jsonb NOT NULL,
	"safe_summary" jsonb NOT NULL,
	"confirmation_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fnpc_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"mastra_resource_id" text NOT NULL,
	"telegram_user_id" text,
	"display_name" text,
	"preferred_name" text,
	"response_language" text,
	"timezone" text,
	"financial_policy" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "fnpc_profiles" (
	"id",
	"mastra_resource_id",
	"telegram_user_id",
	"display_name",
	"preferred_name",
	"response_language",
	"timezone",
	"financial_policy",
	"created_at",
	"updated_at"
)
SELECT
	u."id",
	COALESCE(
		u."mastra_resource_id",
		'telegram:' || u."telegram_user_id",
		'legacy:' || u."id"::text
	),
	u."telegram_user_id",
	u."display_name",
	COALESCE(p."preferred_name", u."display_name"),
	p."response_language",
	u."timezone",
	'{}'::jsonb,
	u."created_at",
	GREATEST(u."updated_at", COALESCE(p."updated_at", u."updated_at"))
FROM "financial_users" u
LEFT JOIN "financial_user_preferences" p ON p."user_id" = u."id";
--> statement-breakpoint
ALTER TABLE "financial_account_balances" DROP CONSTRAINT "financial_account_balances_LOBYPOro84wG_fkey";--> statement-breakpoint
ALTER TABLE "financial_accounts" DROP CONSTRAINT "financial_accounts_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" DROP CONSTRAINT "financial_actual_expenses_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" DROP CONSTRAINT "financial_actual_expenses_Q6elkM7oU0w4_fkey";--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" DROP CONSTRAINT "financial_actual_expenses_NRxApPFP6OXL_fkey";--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" DROP CONSTRAINT "financial_actual_expenses_account_id_financial_accounts_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_categories" DROP CONSTRAINT "financial_categories_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_events" DROP CONSTRAINT "financial_events_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_goals" DROP CONSTRAINT "financial_goals_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_forecast_run_items" DROP CONSTRAINT "financial_forecast_run_items_9EFmPywST6aJ_fkey";--> statement-breakpoint
ALTER TABLE "financial_forecast_runs" DROP CONSTRAINT "financial_forecast_runs_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_income_events" DROP CONSTRAINT "financial_income_events_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_income_events" DROP CONSTRAINT "financial_income_events_o69Rd8qj4vnc_fkey";--> statement-breakpoint
ALTER TABLE "financial_income_rules" DROP CONSTRAINT "financial_income_rules_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" DROP CONSTRAINT "financial_planned_expenses_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" DROP CONSTRAINT "financial_planned_expenses_eKIc2jHXlqa4_fkey";--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" DROP CONSTRAINT "financial_planned_expenses_M5sYDqnCltYl_fkey";--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" DROP CONSTRAINT "financial_planned_expenses_hmiL8DXmBQAL_fkey";--> statement-breakpoint
ALTER TABLE "financial_recurring_expenses" DROP CONSTRAINT "financial_recurring_expenses_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_recurring_expenses" DROP CONSTRAINT "financial_recurring_expenses_ujrOwRPpepof_fkey";--> statement-breakpoint
ALTER TABLE "financial_savings_buckets" DROP CONSTRAINT "financial_savings_buckets_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_savings_rules" DROP CONSTRAINT "financial_savings_rules_user_id_financial_users_id_fkey";--> statement-breakpoint
ALTER TABLE "financial_savings_rules" DROP CONSTRAINT "financial_savings_rules_CKgpsVHn0gLQ_fkey";--> statement-breakpoint
ALTER TABLE "financial_user_preferences" DROP CONSTRAINT "financial_user_preferences_user_id_financial_users_id_fkey";--> statement-breakpoint
DROP TABLE "financial_account_balances";--> statement-breakpoint
DROP TABLE "financial_accounts";--> statement-breakpoint
DROP TABLE "financial_actual_expenses";--> statement-breakpoint
DROP TABLE "financial_categories";--> statement-breakpoint
DROP TABLE "financial_events";--> statement-breakpoint
DROP TABLE "financial_goals";--> statement-breakpoint
DROP TABLE "financial_forecast_run_items";--> statement-breakpoint
DROP TABLE "financial_forecast_runs";--> statement-breakpoint
DROP TABLE "financial_income_events";--> statement-breakpoint
DROP TABLE "financial_income_rules";--> statement-breakpoint
DROP TABLE "financial_planned_expenses";--> statement-breakpoint
DROP TABLE "financial_recurring_expenses";--> statement-breakpoint
DROP TABLE "financial_savings_buckets";--> statement-breakpoint
DROP TABLE "financial_savings_rules";--> statement-breakpoint
DROP TABLE "financial_user_preferences";--> statement-breakpoint
DROP TABLE "financial_users";--> statement-breakpoint
CREATE UNIQUE INDEX "fnpc_mutation_audit_idempotency_key_idx" ON "fnpc_mutation_audit" ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fnpc_mutation_audit_confirmation_token_hash_idx" ON "fnpc_mutation_audit" ("confirmation_token_hash");--> statement-breakpoint
CREATE INDEX "fnpc_mutation_audit_resource_created_idx" ON "fnpc_mutation_audit" ("mastra_resource_id","created_at");--> statement-breakpoint
CREATE INDEX "fnpc_mutation_audit_status_expires_idx" ON "fnpc_mutation_audit" ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fnpc_profiles_mastra_resource_id_idx" ON "fnpc_profiles" ("mastra_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fnpc_profiles_telegram_user_id_idx" ON "fnpc_profiles" ("telegram_user_id");--> statement-breakpoint
DROP TYPE "financial_account_type";--> statement-breakpoint
DROP TYPE "financial_balance_source";--> statement-breakpoint
DROP TYPE "financial_category_kind";--> statement-breakpoint
DROP TYPE "financial_event_entity_type";--> statement-breakpoint
DROP TYPE "financial_event_type";--> statement-breakpoint
DROP TYPE "financial_expense_priority";--> statement-breakpoint
DROP TYPE "financial_expense_status";--> statement-breakpoint
DROP TYPE "financial_funding_source";--> statement-breakpoint
DROP TYPE "financial_goal_status";--> statement-breakpoint
DROP TYPE "financial_income_status";--> statement-breakpoint
DROP TYPE "financial_recurring_frequency";--> statement-breakpoint
DROP TYPE "financial_savings_rule_type";
