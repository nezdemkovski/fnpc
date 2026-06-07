import { and, desc, eq } from "drizzle-orm";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { db } from "../../db/client";
import {
  accountBalances,
  accounts,
  financialEvents,
  savingsBuckets,
} from "../../db/schema";
import {
  currentDateKey,
  currentMonthKey,
  normalizeCurrency,
  safeReportedBalanceDate,
} from "../../finance/dates";
import { formatMoney, majorToMinor } from "../../finance/money";
import {
  getFinancialSnapshot,
  getOrCreateUser,
} from "../../finance/profile-service";

const targetTypeSchema = z.enum(["account", "savings_bucket"]);
const accountTypeSchema = z.enum([
  "checking",
  "cash",
  "savings",
  "brokerage",
  "crypto",
  "other",
]);

const updateAccountBalanceInputSchema = z.object({
  mastraResourceId: z.string(),
  targetType: targetTypeSchema,
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  accountType: accountTypeSchema.optional(),
  bucketId: z.string().optional(),
  bucketName: z.string().optional(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  asOf: z.string().optional(),
  isProtected: z.boolean().optional(),
  reason: z.string().optional(),
  sourceMessageId: z.string().optional(),
  sourceText: z.string().optional(),
});

type UpdateAccountBalanceInput = z.infer<typeof updateAccountBalanceInputSchema>;

const accountRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  currency: z.string(),
  isActive: z.boolean(),
});

const balanceRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amountMinor: z.number(),
  asOf: z.date(),
  source: z.enum(["user_reported", "imported", "adjusted"]),
});

const bucketRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  currentAmountMinor: z.number(),
  targetAmountMinor: z.number().nullable(),
  currency: z.string(),
  isProtected: z.boolean(),
});

const totalsSchema = z.object({
  totalCashMinor: z.number(),
  protectedSavingsMinor: z.number(),
  availableOperatingCashMinor: z.number(),
  monthlyIncomeMinor: z.number(),
  monthlyRecurringExpensesMinor: z.number(),
  monthlySavingsContributionsMinor: z.number(),
  monthlySurplusMinor: z.number(),
});

const updateAccountBalanceStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  targetType: targetTypeSchema,
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  message: z.string().optional(),
  beforeAccount: accountRecordSchema.optional(),
  afterAccount: accountRecordSchema.optional(),
  beforeBalance: balanceRecordSchema.optional(),
  afterBalance: balanceRecordSchema.optional(),
  beforeBucket: bucketRecordSchema.optional(),
  afterBucket: bucketRecordSchema.optional(),
  beforeTotals: totalsSchema.optional(),
  afterTotals: totalsSchema.optional(),
});

const updateAccountBalanceOutputSchema = updateAccountBalanceStateSchema.extend({
  changed: z
    .object({
      entityType: z.enum(["account_balance", "savings_bucket"]),
      entityId: z.string(),
      name: z.string(),
      action: z.enum(["created", "updated"]),
    })
    .optional(),
  formatted: z
    .object({
      amount: z.string(),
      totalCash: z.string(),
      protectedSavings: z.string(),
      availableOperatingCash: z.string(),
    })
    .optional(),
});

const missingProfileSettings = (user: {
  defaultCurrency?: string | null;
  timezone?: string | null;
}) => {
  const missing: string[] = [];
  if (!user.defaultCurrency) missing.push("defaultCurrency");
  if (!user.timezone) missing.push("timezone");
  return missing;
};

const defaultAccountName = (accountType: z.infer<typeof accountTypeSchema>) => {
  if (accountType === "cash") return "Cash";
  if (accountType === "savings") return "Savings account";
  if (accountType === "brokerage") return "Brokerage account";
  if (accountType === "crypto") return "Crypto account";
  return "Operating account";
};

const defaultBucketName = "Savings";

const asAccountRecord = (
  account: typeof accounts.$inferSelect,
): z.infer<typeof accountRecordSchema> => ({
  id: account.id,
  name: account.name,
  type: account.type,
  currency: account.currency,
  isActive: account.isActive,
});

const asBalanceRecord = (
  balance: typeof accountBalances.$inferSelect,
): z.infer<typeof balanceRecordSchema> => ({
  id: balance.id,
  accountId: balance.accountId,
  amountMinor: balance.amountMinor,
  asOf: balance.asOf,
  source: balance.source,
});

const asBucketRecord = (
  bucket: typeof savingsBuckets.$inferSelect,
): z.infer<typeof bucketRecordSchema> => ({
  id: bucket.id,
  name: bucket.name,
  currentAmountMinor: bucket.currentAmountMinor,
  targetAmountMinor: bucket.targetAmountMinor,
  currency: bucket.currency,
  isProtected: bucket.isProtected,
});

const saveEvent = async ({
  userId,
  entityType,
  entityId,
  eventType,
  before,
  after,
  reason,
  sourceMessageId,
}: {
  userId: string;
  entityType: "account" | "account_balance" | "savings_bucket";
  entityId: string;
  eventType: "created" | "updated";
  before?: unknown;
  after: unknown;
  reason?: string;
  sourceMessageId?: string;
}) => {
  await db.insert(financialEvents).values({
    userId,
    entityType,
    entityId,
    eventType,
    before,
    after,
    reason,
    sourceMessageId,
  });
};

const loadBalanceProfileStep = createStep({
  id: "load-balance-profile",
  description: "Loads profile settings required to update account or savings bucket balances.",
  inputSchema: updateAccountBalanceInputSchema,
  outputSchema: updateAccountBalanceStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({
      mastraResourceId: inputData.mastraResourceId,
    });
    const missingProfileFields = missingProfileSettings(user);

    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        targetType: inputData.targetType,
        userId: user.id,
        currentDate: user.timezone ? currentDateKey(user.timezone) : null,
        currentMonth: user.timezone ? currentMonthKey(user.timezone) : null,
        missingProfileFields,
        message:
          "Cannot update balances until defaultCurrency and timezone are known.",
      };
    }

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      targetType: inputData.targetType,
      userId: user.id,
      currency: user.defaultCurrency!,
      timezone: user.timezone!,
      currentDate: currentDateKey(user.timezone!),
      currentMonth: currentMonthKey(user.timezone!),
      missingProfileFields: [],
    };
  },
});

const collectBeforeTotalsStep = createStep({
  id: "collect-balance-before-totals",
  description: "Collects current totals before applying a reported balance.",
  inputSchema: updateAccountBalanceStateSchema,
  outputSchema: updateAccountBalanceStateSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const snapshot = await getFinancialSnapshot(inputData.userId);
    return {
      ...inputData,
      beforeTotals: snapshot.totals,
    };
  },
});

const applyAccountBalanceStep = createStep({
  id: "apply-account-balance",
  description: "Updates an account balance or savings bucket amount.",
  inputSchema: updateAccountBalanceStateSchema,
  outputSchema: updateAccountBalanceStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency || !inputData.timezone) {
      return inputData;
    }

    const initial = getInitData<UpdateAccountBalanceInput>();
    const currency = normalizeCurrency(initial.currency, inputData.currency);
    const amountMinor = majorToMinor(initial.amount);
    const reason = initial.reason
      ? JSON.stringify({
          source: "update-account-balance",
          reason: initial.reason,
          sourceText: initial.sourceText,
        })
      : JSON.stringify({
          source: "update-account-balance",
          sourceText: initial.sourceText,
        });

    if (initial.targetType === "savings_bucket") {
      const bucketName = initial.bucketName ?? defaultBucketName;
      const [existing] = initial.bucketId
        ? await db
            .select()
            .from(savingsBuckets)
            .where(
              and(
                eq(savingsBuckets.userId, inputData.userId),
                eq(savingsBuckets.id, initial.bucketId),
              ),
            )
            .limit(1)
        : await db
            .select()
            .from(savingsBuckets)
            .where(
              and(
                eq(savingsBuckets.userId, inputData.userId),
                eq(savingsBuckets.name, bucketName),
              ),
            )
            .limit(1);

      const beforeBucket = existing ? asBucketRecord(existing) : undefined;
      const values = {
        userId: inputData.userId,
        name: existing?.name ?? bucketName,
        currentAmountMinor: amountMinor,
        currency,
        isProtected: initial.isProtected ?? existing?.isProtected ?? true,
        priority: existing?.priority ?? 100,
        targetAmountMinor: existing?.targetAmountMinor ?? null,
        updatedAt: new Date(),
      };
      const [bucket] = existing
        ? await db
            .update(savingsBuckets)
            .set(values)
            .where(eq(savingsBuckets.id, existing.id))
            .returning()
        : await db.insert(savingsBuckets).values(values).returning();

      await saveEvent({
        userId: inputData.userId,
        entityType: "savings_bucket",
        entityId: bucket.id,
        eventType: existing ? "updated" : "created",
        before: beforeBucket,
        after: bucket,
        reason,
        sourceMessageId: initial.sourceMessageId,
      });

      return {
        ...inputData,
        beforeBucket,
        afterBucket: asBucketRecord(bucket),
      };
    }

    const accountType = initial.accountType ?? "checking";
    const accountName = initial.accountName ?? defaultAccountName(accountType);
    const [existingAccount] = initial.accountId
      ? await db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, inputData.userId),
              eq(accounts.id, initial.accountId),
            ),
          )
          .limit(1)
      : await db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, inputData.userId),
              eq(accounts.name, accountName),
            ),
          )
          .limit(1);

    const accountValues = {
      userId: inputData.userId,
      name: existingAccount?.name ?? accountName,
      type: existingAccount?.type ?? accountType,
      currency,
      isActive: true,
      updatedAt: new Date(),
    };
    const [account] = existingAccount
      ? await db
          .update(accounts)
          .set(accountValues)
          .where(eq(accounts.id, existingAccount.id))
          .returning()
      : await db.insert(accounts).values(accountValues).returning();

    if (!existingAccount) {
      await saveEvent({
        userId: inputData.userId,
        entityType: "account",
        entityId: account.id,
        eventType: "created",
        after: account,
        reason,
        sourceMessageId: initial.sourceMessageId,
      });
    }

    const [latestBalance] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, account.id))
      .orderBy(desc(accountBalances.asOf))
      .limit(1);
    const [balance] = await db
      .insert(accountBalances)
      .values({
        accountId: account.id,
        amountMinor,
        asOf: safeReportedBalanceDate({
          value: initial.asOf,
          timezone: inputData.timezone,
        }),
        source: "user_reported",
      })
      .returning();

    await saveEvent({
      userId: inputData.userId,
      entityType: "account_balance",
      entityId: balance.id,
      eventType: "created",
      before: latestBalance,
      after: balance,
      reason,
      sourceMessageId: initial.sourceMessageId,
    });

    return {
      ...inputData,
      beforeAccount: existingAccount ? asAccountRecord(existingAccount) : undefined,
      afterAccount: asAccountRecord(account),
      beforeBalance: latestBalance ? asBalanceRecord(latestBalance) : undefined,
      afterBalance: asBalanceRecord(balance),
    };
  },
});

const buildBalanceResultStep = createStep({
  id: "build-balance-result",
  description: "Builds a structured result after a balance update.",
  inputSchema: updateAccountBalanceStateSchema,
  outputSchema: updateAccountBalanceOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency) return inputData;

    const snapshot = await getFinancialSnapshot(inputData.userId);
    const changed =
      inputData.targetType === "savings_bucket" && inputData.afterBucket
        ? {
            entityType: "savings_bucket" as const,
            entityId: inputData.afterBucket.id,
            name: inputData.afterBucket.name,
            action: inputData.beforeBucket ? ("updated" as const) : ("created" as const),
          }
        : inputData.afterBalance && inputData.afterAccount
          ? {
              entityType: "account_balance" as const,
              entityId: inputData.afterBalance.id,
              name: inputData.afterAccount.name,
              action: "created" as const,
            }
          : undefined;
    const amountMinor =
      inputData.afterBucket?.currentAmountMinor ?? inputData.afterBalance?.amountMinor ?? 0;

    return {
      ...inputData,
      afterTotals: snapshot.totals,
      changed,
      formatted: {
        amount: formatMoney(amountMinor, inputData.currency),
        totalCash: formatMoney(snapshot.totals.totalCashMinor, inputData.currency),
        protectedSavings: formatMoney(
          snapshot.totals.protectedSavingsMinor,
          inputData.currency,
        ),
        availableOperatingCash: formatMoney(
          snapshot.totals.availableOperatingCashMinor,
          inputData.currency,
        ),
      },
    };
  },
});

export const updateAccountBalance = createWorkflow({
  id: "update-account-balance",
  inputSchema: updateAccountBalanceInputSchema,
  outputSchema: updateAccountBalanceOutputSchema,
})
  .then(loadBalanceProfileStep)
  .then(collectBeforeTotalsStep)
  .then(applyAccountBalanceStep)
  .then(buildBalanceResultStep)
  .commit();
