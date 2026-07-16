import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type FinancialPolicy = {
  minimumComfortableReadyToAssignMilliunits?: number;
};

export type PendingTransactionRequest = {
  accountId: string;
  categoryId?: string;
  payeeName: string;
  date: string;
  amountMilliunits: number;
  memo?: string;
  importId: string;
};

export type MutationSummary = {
  accountName: string;
  categoryName?: string;
  payeeName: string;
  date: string;
  amount: string;
  direction: "expense" | "income";
};

export const mutationStatusEnum = pgEnum("fnpc_mutation_status", [
  "pending",
  "committed",
  "expired",
  "failed",
]);

const idColumn = () => uuid("id").primaryKey().defaultRandom();
const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAtColumn = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const profiles = pgTable(
  "fnpc_profiles",
  {
    id: idColumn(),
    mastraResourceId: text("mastra_resource_id").notNull(),
    telegramUserId: text("telegram_user_id"),
    displayName: text("display_name"),
    preferredName: text("preferred_name"),
    responseLanguage: text("response_language"),
    timezone: text("timezone"),
    financialPolicy: jsonb("financial_policy")
      .$type<FinancialPolicy>()
      .notNull()
      .default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("fnpc_profiles_mastra_resource_id_idx").on(
      table.mastraResourceId,
    ),
    uniqueIndex("fnpc_profiles_telegram_user_id_idx").on(
      table.telegramUserId,
    ),
  ],
);

export const mutationAudit = pgTable(
  "fnpc_mutation_audit",
  {
    id: idColumn(),
    mastraResourceId: text("mastra_resource_id").notNull(),
    action: text("action").notNull(),
    sourceMessageId: text("source_message_id"),
    ynabEntityType: text("ynab_entity_type"),
    ynabEntityId: text("ynab_entity_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: mutationStatusEnum("status").notNull().default("pending"),
    request: jsonb("request").$type<PendingTransactionRequest>().notNull(),
    safeSummary: jsonb("safe_summary").$type<MutationSummary>().notNull(),
    confirmationTokenHash: text("confirmation_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    errorCode: text("error_code"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("fnpc_mutation_audit_idempotency_key_idx").on(
      table.idempotencyKey,
    ),
    uniqueIndex("fnpc_mutation_audit_confirmation_token_hash_idx").on(
      table.confirmationTokenHash,
    ),
    index("fnpc_mutation_audit_resource_created_idx").on(
      table.mastraResourceId,
      table.createdAt,
    ),
    index("fnpc_mutation_audit_status_expires_idx").on(
      table.status,
      table.expiresAt,
    ),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type MutationAudit = typeof mutationAudit.$inferSelect;
