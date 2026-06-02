ALTER TABLE "financial_accounts" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_actual_expenses" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_goals" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_income_events" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_income_rules" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_planned_expenses" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_recurring_expenses" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_savings_buckets" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_users" ALTER COLUMN "default_currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "financial_users" ALTER COLUMN "timezone" DROP DEFAULT;