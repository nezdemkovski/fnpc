ALTER TYPE "financial_event_entity_type" ADD VALUE 'user_preferences' BEFORE 'account';--> statement-breakpoint
CREATE TABLE "financial_user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"preferred_name" text,
	"response_language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_user_preferences_user_id_idx" ON "financial_user_preferences" ("user_id");--> statement-breakpoint
ALTER TABLE "financial_user_preferences" ADD CONSTRAINT "financial_user_preferences_user_id_financial_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "financial_users"("id") ON DELETE CASCADE;
