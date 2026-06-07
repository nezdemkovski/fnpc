import { and, desc, eq } from "drizzle-orm";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { db } from "../../db/client";
import {
  accountBalances,
  accounts,
  actualExpenses,
  financialEvents,
  plannedExpenses,
  savingsBuckets,
} from "../../db/schema";
import {
  currentDateKey,
  currentMonthKey,
  normalizeCurrency,
  parseUserDate,
  safeReportedBalanceDate,
} from "../../finance/dates";
import { rankEntityCandidates } from "../../finance/entity-matching";
import { formatMoney, majorToMinor } from "../../finance/money";
import { getFinancialSnapshot, getOrCreateUser } from "../../finance/profile-service";

const actionSchema = z.enum([
  "transfer_to_bucket",
  "transfer_from_bucket",
  "spend_from_bucket",
  "close_bucket",
]);

const transferToSavingsInputSchema = z.object({
  mastraResourceId: z.string(),
  action: actionSchema,
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
  bucketId: z.string().optional(),
  bucketName: z.string().optional(),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  expenseName: z.string().optional(),
  plannedExpenseId: z.string().optional(),
  spentAt: z.string().optional(),
  asOf: z.string().optional(),
  closeBucket: z.boolean().optional(),
  confirmedBucketId: z.string().optional(),
  confirmedAccountId: z.string().optional(),
  reason: z.string().optional(),
  sourceMessageId: z.string().optional(),
  sourceText: z.string().optional(),
});

type TransferToSavingsInput = z.infer<typeof transferToSavingsInputSchema>;

const accountRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["checking", "cash", "savings", "brokerage", "crypto", "other"]),
  currency: z.string(),
  latestBalanceMinor: z.number().nullable(),
});

const bucketRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  currentAmountMinor: z.number(),
  targetAmountMinor: z.number().nullable(),
  currency: z.string(),
  isProtected: z.boolean(),
  score: z.number().optional(),
  reason: z.string().optional(),
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

const transferToSavingsStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  action: actionSchema,
  userId: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  currentDate: z.string().nullable().optional(),
  currentMonth: z.string().nullable().optional(),
  missingProfileFields: z.array(z.string()).default([]),
  needsConfirmation: z.boolean().default(false),
  message: z.string().optional(),
  bucketCandidates: z.array(bucketRecordSchema).default([]),
  accountCandidates: z.array(accountRecordSchema).default([]),
  beforeBucket: bucketRecordSchema.optional(),
  afterBucket: bucketRecordSchema.optional(),
  sourceAccount: accountRecordSchema.optional(),
  accountBalanceId: z.string().optional(),
  actualExpenseId: z.string().optional(),
  beforeTotals: totalsSchema.optional(),
  afterTotals: totalsSchema.optional(),
});

const transferToSavingsOutputSchema = transferToSavingsStateSchema.extend({
  changed: z
    .array(
      z.object({
        entityType: z.enum(["savings_bucket", "account_balance", "actual_expense", "planned_expense"]),
        entityId: z.string(),
        name: z.string(),
        action: z.enum(["created", "updated", "paid", "closed"]),
      }),
    )
    .default([]),
  formatted: z
    .object({
      amount: z.string(),
      bucketBalance: z.string().optional(),
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

const asBucketRecord = (
  bucket: typeof savingsBuckets.$inferSelect,
  match?: { score: number; reason: string },
): z.infer<typeof bucketRecordSchema> => ({
  id: bucket.id,
  name: bucket.name,
  currentAmountMinor: bucket.currentAmountMinor,
  targetAmountMinor: bucket.targetAmountMinor,
  currency: bucket.currency,
  isProtected: bucket.isProtected,
  score: match?.score,
  reason: match?.reason,
});

const latestAccountBalance = async (accountId: string) => {
  const [balance] = await db
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId))
    .orderBy(desc(accountBalances.asOf))
    .limit(1);
  return balance;
};

const asAccountRecord = async (
  account: typeof accounts.$inferSelect,
): Promise<z.infer<typeof accountRecordSchema>> => {
  const balance = await latestAccountBalance(account.id);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    latestBalanceMinor: balance?.amountMinor ?? null,
  };
};

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
  entityType: "account_balance" | "actual_expense" | "planned_expense" | "savings_bucket";
  entityId: string;
  eventType: "created" | "updated" | "paid";
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

const loadTransferProfileStep = createStep({
  id: "load-transfer-profile",
  description: "Loads profile settings before moving money into or out of savings buckets.",
  inputSchema: transferToSavingsInputSchema,
  outputSchema: transferToSavingsStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({ mastraResourceId: inputData.mastraResourceId });
    const missingProfileFields = missingProfileSettings(user);

    if (missingProfileFields.length > 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        action: inputData.action,
        userId: user.id,
        currentDate: user.timezone ? currentDateKey(user.timezone) : null,
        currentMonth: user.timezone ? currentMonthKey(user.timezone) : null,
        missingProfileFields,
        needsConfirmation: false,
        bucketCandidates: [],
        accountCandidates: [],
        message: "Cannot transfer savings until defaultCurrency and timezone are known.",
      };
    }

    if (inputData.action !== "close_bucket" && inputData.amount === undefined) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        action: inputData.action,
        userId: user.id,
        currency: user.defaultCurrency!,
        timezone: user.timezone!,
        currentDate: currentDateKey(user.timezone!),
        currentMonth: currentMonthKey(user.timezone!),
        missingProfileFields: [],
        needsConfirmation: false,
        bucketCandidates: [],
        accountCandidates: [],
        message: "This savings transfer requires amount.",
      };
    }

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      action: inputData.action,
      userId: user.id,
      currency: user.defaultCurrency!,
      timezone: user.timezone!,
      currentDate: currentDateKey(user.timezone!),
      currentMonth: currentMonthKey(user.timezone!),
      missingProfileFields: [],
      needsConfirmation: false,
      bucketCandidates: [],
      accountCandidates: [],
    };
  },
});

const loadTransferCandidatesStep = createStep({
  id: "load-transfer-candidates",
  description: "Loads savings bucket and account candidates for the requested transfer.",
  inputSchema: transferToSavingsStateSchema,
  outputSchema: transferToSavingsStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<TransferToSavingsInput>();
    const [buckets, activeAccounts, beforeSnapshot] = await Promise.all([
      db.select().from(savingsBuckets).where(eq(savingsBuckets.userId, inputData.userId)),
      db.select().from(accounts).where(and(eq(accounts.userId, inputData.userId), eq(accounts.isActive, true))),
      getFinancialSnapshot(inputData.userId),
    ]);

    const bucketMatches = initial.bucketId
      ? buckets
          .filter((bucket) => bucket.id === initial.bucketId)
          .map((bucket) => asBucketRecord(bucket, { score: 1, reason: "matched by id" }))
      : initial.bucketName
        ? rankEntityCandidates({
            query: initial.bucketName,
            candidates: buckets.map((bucket) => ({
              id: bucket.id,
              type: "recurring_expense" as const,
              name: bucket.name,
              amountMinor: bucket.currentAmountMinor,
              currency: bucket.currency,
            })),
          }).map((match) => {
            const bucket = buckets.find((item) => item.id === match.id)!;
            return asBucketRecord(bucket, { score: match.score, reason: match.reason });
          })
        : buckets.length === 1
          ? [asBucketRecord(buckets[0], { score: 1, reason: "only savings bucket" })]
          : [];

    const accountMatches = await Promise.all(
      (initial.accountId
        ? activeAccounts.filter((account) => account.id === initial.accountId)
        : initial.accountName
          ? activeAccounts.filter((account) => account.name === initial.accountName)
          : activeAccounts.filter((account) => account.type === "checking")).map(asAccountRecord),
    );

    return {
      ...inputData,
      bucketCandidates: bucketMatches.slice(0, 5),
      accountCandidates: accountMatches.slice(0, 5),
      beforeTotals: beforeSnapshot.totals,
    };
  },
});

const resolveTransferTargetsStep = createStep({
  id: "resolve-transfer-targets",
  description: "Resolves transfer targets and asks for confirmation when bucket/account target is unclear.",
  inputSchema: transferToSavingsStateSchema,
  outputSchema: transferToSavingsStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) return inputData;

    const initial = getInitData<TransferToSavingsInput>();
    const selectedBucket =
      (initial.confirmedBucketId
        ? inputData.bucketCandidates.find((bucket) => bucket.id === initial.confirmedBucketId)
        : undefined) ?? inputData.bucketCandidates[0];
    const secondBucket = inputData.bucketCandidates[1];
    const bucketAmbiguous =
      selectedBucket && secondBucket && (selectedBucket.score ?? 0) - (secondBucket.score ?? 0) < 0.12;

    if (!selectedBucket && initial.action !== "transfer_to_bucket") {
      return {
        ...inputData,
        ok: false,
        message: "Savings bucket not found.",
      };
    }

    if (selectedBucket && ((selectedBucket.score ?? 1) < 0.72 || bucketAmbiguous) && !initial.confirmedBucketId) {
      return {
        ...inputData,
        ok: false,
        needsConfirmation: true,
        message: "Savings bucket match is weak or ambiguous. Confirm the bucket before moving money.",
      };
    }

    const selectedAccount =
      (initial.confirmedAccountId
        ? inputData.accountCandidates.find((account) => account.id === initial.confirmedAccountId)
        : undefined) ?? inputData.accountCandidates[0];

    if (
      (initial.action === "transfer_from_bucket" || initial.action === "spend_from_bucket") &&
      !selectedAccount
    ) {
      return {
        ...inputData,
        ok: false,
        message: "Source/target account is required to keep current cash accurate.",
      };
    }

    return {
      ...inputData,
      beforeBucket: selectedBucket,
      sourceAccount: selectedAccount,
    };
  },
});

const applyTransferStep = createStep({
  id: "apply-savings-transfer",
  description: "Applies a savings bucket transfer, withdrawal, purchase, or closure.",
  inputSchema: transferToSavingsStateSchema,
  outputSchema: transferToSavingsOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId || !inputData.currency || !inputData.timezone) {
      return { ...inputData, changed: [] };
    }

    const initial = getInitData<TransferToSavingsInput>();
    const currency = normalizeCurrency(initial.currency, inputData.currency);
    const amountMinor = initial.amount === undefined ? 0 : majorToMinor(initial.amount);
    const provenance = JSON.stringify({
      source: "transfer-to-savings",
      action: initial.action,
      reason: initial.reason,
      sourceText: initial.sourceText,
    });
    const changed: z.infer<typeof transferToSavingsOutputSchema>["changed"] = [];
    let afterBucket = inputData.beforeBucket;
    let actualExpenseId: string | undefined;
    let accountBalanceId: string | undefined;

    if (initial.action === "transfer_to_bucket") {
      const bucketName = initial.bucketName ?? "Savings";
      const existing = inputData.beforeBucket;
      const [bucket] = existing
        ? await db
            .update(savingsBuckets)
            .set({
              currentAmountMinor: existing.currentAmountMinor + amountMinor,
              currency,
              isProtected: true,
              updatedAt: new Date(),
            })
            .where(eq(savingsBuckets.id, existing.id))
            .returning()
        : await db
            .insert(savingsBuckets)
            .values({
              userId: inputData.userId,
              name: bucketName,
              currentAmountMinor: amountMinor,
              currency,
              isProtected: true,
            })
            .returning();

      await saveEvent({
        userId: inputData.userId,
        entityType: "savings_bucket",
        entityId: bucket.id,
        eventType: existing ? "updated" : "created",
        before: existing,
        after: bucket,
        reason: provenance,
        sourceMessageId: initial.sourceMessageId,
      });
      afterBucket = asBucketRecord(bucket);
      changed.push({
        entityType: "savings_bucket",
        entityId: bucket.id,
        name: bucket.name,
        action: existing ? "updated" : "created",
      });
    }

    if (initial.action === "transfer_from_bucket" || initial.action === "spend_from_bucket") {
      if (!inputData.beforeBucket || !inputData.sourceAccount) {
        return {
          ...inputData,
          ok: false,
          changed: [],
          message: "Savings bucket and account are required for this transfer.",
        };
      }
      if (inputData.beforeBucket.currentAmountMinor < amountMinor) {
        return {
          ...inputData,
          ok: false,
          changed: [],
          message: "Savings bucket balance is lower than the requested amount.",
        };
      }

      const [bucket] = await db
        .update(savingsBuckets)
        .set({
          currentAmountMinor: inputData.beforeBucket.currentAmountMinor - amountMinor,
          updatedAt: new Date(),
        })
        .where(eq(savingsBuckets.id, inputData.beforeBucket.id))
        .returning();
      afterBucket = asBucketRecord(bucket);
      await saveEvent({
        userId: inputData.userId,
        entityType: "savings_bucket",
        entityId: bucket.id,
        eventType: "updated",
        before: inputData.beforeBucket,
        after: bucket,
        reason: provenance,
        sourceMessageId: initial.sourceMessageId,
      });
      changed.push({
        entityType: "savings_bucket",
        entityId: bucket.id,
        name: bucket.name,
        action: "updated",
      });

      const latestBalance = await latestAccountBalance(inputData.sourceAccount.id);
      const balanceDelta =
        initial.action === "transfer_from_bucket" ? amountMinor : -amountMinor;
      const [balance] = await db
        .insert(accountBalances)
        .values({
          accountId: inputData.sourceAccount.id,
          amountMinor: (latestBalance?.amountMinor ?? 0) + balanceDelta,
          asOf: safeReportedBalanceDate({ value: initial.asOf, timezone: inputData.timezone }),
          source: "adjusted",
        })
        .returning();
      accountBalanceId = balance.id;
      await saveEvent({
        userId: inputData.userId,
        entityType: "account_balance",
        entityId: balance.id,
        eventType: "created",
        before: latestBalance,
        after: balance,
        reason: provenance,
        sourceMessageId: initial.sourceMessageId,
      });
      changed.push({
        entityType: "account_balance",
        entityId: balance.id,
        name: inputData.sourceAccount.name,
        action: "created",
      });

      if (initial.action === "spend_from_bucket") {
        const [actualExpense] = await db
          .insert(actualExpenses)
          .values({
            userId: inputData.userId,
            name: initial.expenseName ?? inputData.beforeBucket.name,
            amountMinor,
            currency,
            spentAt: initial.spentAt ? parseUserDate(initial.spentAt) : parseUserDate(inputData.currentDate!),
            source: "telegram",
            note: provenance,
          })
          .returning();
        actualExpenseId = actualExpense.id;
        await saveEvent({
          userId: inputData.userId,
          entityType: "actual_expense",
          entityId: actualExpense.id,
          eventType: "created",
          after: actualExpense,
          reason: provenance,
          sourceMessageId: initial.sourceMessageId,
        });
        changed.push({
          entityType: "actual_expense",
          entityId: actualExpense.id,
          name: actualExpense.name,
          action: "created",
        });

        if (initial.plannedExpenseId) {
          const [plannedExpense] = await db
            .update(plannedExpenses)
            .set({ status: "paid", updatedAt: new Date() })
            .where(eq(plannedExpenses.id, initial.plannedExpenseId))
            .returning();
          if (plannedExpense) {
            await saveEvent({
              userId: inputData.userId,
              entityType: "planned_expense",
              entityId: plannedExpense.id,
              eventType: "paid",
              after: plannedExpense,
              reason: provenance,
              sourceMessageId: initial.sourceMessageId,
            });
            changed.push({
              entityType: "planned_expense",
              entityId: plannedExpense.id,
              name: plannedExpense.name,
              action: "paid",
            });
          }
        }
      }
    }

    if (initial.action === "close_bucket") {
      if (!inputData.beforeBucket) {
        return { ...inputData, ok: false, changed: [], message: "Savings bucket not found." };
      }
      const [bucket] = await db
        .update(savingsBuckets)
        .set({ currentAmountMinor: 0, isProtected: false, updatedAt: new Date() })
        .where(eq(savingsBuckets.id, inputData.beforeBucket.id))
        .returning();
      afterBucket = asBucketRecord(bucket);
      await saveEvent({
        userId: inputData.userId,
        entityType: "savings_bucket",
        entityId: bucket.id,
        eventType: "updated",
        before: inputData.beforeBucket,
        after: bucket,
        reason: provenance,
        sourceMessageId: initial.sourceMessageId,
      });
      changed.push({
        entityType: "savings_bucket",
        entityId: bucket.id,
        name: bucket.name,
        action: "closed",
      });
    }

    const afterSnapshot = await getFinancialSnapshot(inputData.userId);

    return {
      ...inputData,
      afterBucket,
      accountBalanceId,
      actualExpenseId,
      afterTotals: afterSnapshot.totals,
      changed,
      formatted: {
        amount: formatMoney(amountMinor, currency),
        bucketBalance: afterBucket
          ? formatMoney(afterBucket.currentAmountMinor, afterBucket.currency)
          : undefined,
        totalCash: formatMoney(afterSnapshot.totals.totalCashMinor, inputData.currency),
        protectedSavings: formatMoney(afterSnapshot.totals.protectedSavingsMinor, inputData.currency),
        availableOperatingCash: formatMoney(afterSnapshot.totals.availableOperatingCashMinor, inputData.currency),
      },
    };
  },
});

export const transferToSavings = createWorkflow({
  id: "transfer-to-savings",
  inputSchema: transferToSavingsInputSchema,
  outputSchema: transferToSavingsOutputSchema,
})
  .then(loadTransferProfileStep)
  .then(loadTransferCandidatesStep)
  .then(resolveTransferTargetsStep)
  .then(applyTransferStep)
  .commit();
