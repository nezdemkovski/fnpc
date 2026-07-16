import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  mutationAudit,
  type MutationSummary,
  type PendingTransactionRequest,
} from "../db/schema";
import { currentDateKey, isIsoDate } from "../finance/dates";
import { formatMilliunits, majorToMilliunits } from "../finance/money";
import { ynabGateway, type YnabGateway } from "./gateway";
import type { Account, Category, CurrencyFormat } from "ynab";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const normalizeName = (value: string) => value.trim().toLocaleLowerCase();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const productionDatabase = async () => (await import("../db/client")).db;

const exactAccount = (
  accounts: Account[],
  id: string | undefined,
  name: string | undefined,
): { value?: Account; candidates: Account[] } => {
  const available = accounts.filter((account) => !account.closed && !account.deleted);
  if (id) return { value: available.find((account) => account.id === id), candidates: [] };
  if (!name) return { candidates: [] };
  const matches = available.filter(
    (account) => normalizeName(account.name) === normalizeName(name),
  );
  return { value: matches.length === 1 ? matches[0] : undefined, candidates: matches };
};

const exactCategory = (
  categories: Category[],
  id: string | undefined,
  name: string | undefined,
): { value?: Category; candidates: Category[] } => {
  const available = categories.filter(
    (category) => !category.hidden && !category.internal && !category.deleted,
  );
  if (id) return { value: available.find((category) => category.id === id), candidates: [] };
  if (!name) return { candidates: [] };
  const normalized = normalizeName(name);
  const matches = available.filter(
    (category) =>
      normalizeName(category.name) === normalized ||
      normalizeName(
        `${category.category_group_name ?? "Unknown group"} / ${category.name}`,
      ) === normalized,
  );
  return { value: matches.length === 1 ? matches[0] : undefined, candidates: matches };
};

type PrepareTransactionInput = {
  mastraResourceId: string;
  sourceMessageId?: string;
  timezone: string;
  direction: "expense" | "income";
  amount: number;
  accountId?: string;
  accountName?: string;
  categoryId?: string;
  categoryName?: string;
  payeeName: string;
  date?: string;
  memo?: string;
};

export const prepareTransaction = async (
  input: PrepareTransactionInput,
  dependencies: { database?: Database; gateway?: YnabGateway; now?: Date } = {},
) => {
  const database = dependencies.database ?? (await productionDatabase());
  const gateway = dependencies.gateway ?? ynabGateway;
  const now = dependencies.now ?? new Date();
  const date = input.date ?? currentDateKey(input.timezone, now);
  if (!isIsoDate(date)) return { ok: false as const, error: "invalid_date" };
  if (date > currentDateKey(input.timezone, now)) {
    return { ok: false as const, error: "future_transactions_are_not_supported" };
  }
  if (!(input.amount > 0)) {
    return { ok: false as const, error: "amount_must_be_positive" };
  }

  const month = `${date.slice(0, 7)}-01`;
  const [accountsResponse, monthResponse, settingsResponse] = await Promise.all([
    gateway.getAccounts(),
    gateway.getMonth(month),
    gateway.getPlanSettings(),
  ]);

  const account = exactAccount(
    accountsResponse.data.accounts,
    input.accountId,
    input.accountName,
  );
  if (!account.value) {
    return {
      ok: false as const,
      error: "account_not_found_or_ambiguous",
      candidates: account.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
      })),
    };
  }

  const category = exactCategory(
    monthResponse.data.month.categories,
    input.categoryId,
    input.categoryName,
  );
  if (input.direction === "expense" && !category.value) {
    return {
      ok: false as const,
      error: "expense_category_not_found_or_ambiguous",
      candidates: category.candidates.map((candidate) => ({
        id: candidate.id,
        group: candidate.category_group_name,
        name: candidate.name,
      })),
    };
  }

  const unsignedAmount = majorToMilliunits(input.amount);
  const amountMilliunits =
    input.direction === "expense" ? -unsignedAmount : unsignedAmount;
  const idempotencyKey = hash(
    JSON.stringify({
      resource: input.mastraResourceId,
      source: input.sourceMessageId ?? randomUUID(),
      account: account.value.id,
      category: category.value?.id,
      payee: input.payeeName.trim(),
      date,
      amountMilliunits,
    }),
  );
  const importId = `FNPC:${idempotencyKey.slice(0, 27)}`;
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hash(token);
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
  const request: PendingTransactionRequest = {
    accountId: account.value.id,
    categoryId: category.value?.id,
    payeeName: input.payeeName.trim(),
    date,
    amountMilliunits,
    memo: input.memo?.trim() || undefined,
    importId,
  };
  const safeSummary: MutationSummary = {
    accountName: account.value.name,
    categoryName: category.value
      ? `${category.value.category_group_name ?? "Unknown group"} / ${category.value.name}`
      : undefined,
    payeeName: request.payeeName,
    date,
    amount: formatMilliunits(
      Math.abs(amountMilliunits),
      settingsResponse.data.settings.currency_format as CurrencyFormat,
    ),
    direction: input.direction,
  };

  const [existing] = await database
    .select()
    .from(mutationAudit)
    .where(eq(mutationAudit.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing?.status === "committed") {
    return {
      ok: true as const,
      alreadyCommitted: true,
      ynabTransactionId: existing.ynabEntityId,
      summary: existing.safeSummary,
    };
  }

  if (existing) {
    await database
      .update(mutationAudit)
      .set({
        status: "pending",
        request,
        safeSummary,
        confirmationTokenHash: tokenHash,
        expiresAt,
        errorCode: null,
        updatedAt: now,
      })
      .where(eq(mutationAudit.id, existing.id));
  } else {
    await database.insert(mutationAudit).values({
      mastraResourceId: input.mastraResourceId,
      action: "create_transaction",
      sourceMessageId: input.sourceMessageId,
      idempotencyKey,
      request,
      safeSummary,
      confirmationTokenHash: tokenHash,
      expiresAt,
    });
  }

  return {
    ok: true as const,
    requiresConfirmation: true,
    confirmationToken: token,
    expiresAt: expiresAt.toISOString(),
    summary: safeSummary,
    warning: "The transaction will be created in YNAB as unapproved.",
  };
};

export const commitPreparedTransaction = async (
  {
    mastraResourceId,
    confirmationToken,
  }: { mastraResourceId: string; confirmationToken: string },
  dependencies: { database?: Database; gateway?: YnabGateway; now?: Date } = {},
) => {
  const database = dependencies.database ?? (await productionDatabase());
  const gateway = dependencies.gateway ?? ynabGateway;
  const now = dependencies.now ?? new Date();
  const tokenHash = hash(confirmationToken);

  return database.transaction(async (transaction) => {
    const [audit] = await transaction
      .select()
      .from(mutationAudit)
      .where(
        and(
          eq(mutationAudit.confirmationTokenHash, tokenHash),
          eq(mutationAudit.mastraResourceId, mastraResourceId),
        ),
      )
      .for("update")
      .limit(1);

    if (!audit) return { ok: false as const, error: "invalid_confirmation" };
    if (audit.status === "committed") {
      return {
        ok: true as const,
        alreadyCommitted: true,
        ynabTransactionId: audit.ynabEntityId,
        summary: audit.safeSummary,
      };
    }
    if (audit.expiresAt <= now) {
      await transaction
        .update(mutationAudit)
        .set({ status: "expired", updatedAt: now })
        .where(eq(mutationAudit.id, audit.id));
      return { ok: false as const, error: "confirmation_expired" };
    }

    const categoryRequest = audit.request.categoryId
      ? gateway.getMonthCategory(
          `${audit.request.date.slice(0, 7)}-01`,
          audit.request.categoryId,
        )
      : undefined;
    const [accountResponse, categoryResponse] = await Promise.all([
      gateway.getAccount(audit.request.accountId),
      categoryRequest,
    ]);
    const account = accountResponse.data.account;
    const category = categoryResponse?.data.category;
    if (
      account.deleted ||
      account.closed ||
      (audit.request.categoryId &&
        (!category || category.deleted || category.hidden))
    ) {
      return { ok: false as const, error: "ynab_reference_changed" };
    }

    const result = await gateway.createTransaction({
      account_id: audit.request.accountId,
      category_id: audit.request.categoryId,
      payee_name: audit.request.payeeName,
      date: audit.request.date,
      amount: audit.request.amountMilliunits,
      memo: audit.request.memo,
      cleared: "uncleared",
      approved: false,
      import_id: audit.request.importId,
    });
    const ynabTransactionId =
      result.data.transaction?.id ?? result.data.transaction_ids[0];
    const duplicate = result.data.duplicate_import_ids?.includes(
      audit.request.importId,
    );

    await transaction
      .update(mutationAudit)
      .set({
        status: "committed",
        ynabEntityType: "transaction",
        ynabEntityId: ynabTransactionId,
        errorCode: null,
        updatedAt: now,
      })
      .where(eq(mutationAudit.id, audit.id));

    return {
      ok: true as const,
      alreadyCommitted: Boolean(duplicate),
      ynabTransactionId,
      summary: audit.safeSummary,
      approved: false,
    };
  });
};
