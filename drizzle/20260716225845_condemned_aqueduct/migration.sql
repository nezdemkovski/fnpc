DROP INDEX "fnpc_profiles_telegram_user_id_idx";--> statement-breakpoint
ALTER TABLE "fnpc_profiles" DROP COLUMN "telegram_user_id";--> statement-breakpoint
ALTER TABLE "fnpc_profiles" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "fnpc_profiles" DROP COLUMN "financial_policy";