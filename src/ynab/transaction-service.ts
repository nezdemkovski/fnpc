import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  mutationAudit,
  type MutationSummary,
  type PendingCreateTransactionRequest,
  type PendingDeleteTransactionRequest,
  type PendingTransactionRequest,
  type PendingUpdateTransactionRequest,
  type TransactionSummary,
} from "../db/schema";
import { currentDateKey, isIsoDate } from "../finance/dates";
import { formatMilliunits, majorToMilliunits } from "../finance/money";
import {
  ynabGateway,
  type YnabGateway,
  type YnabTransactionUpdate,
} from "./gateway";
import type {
  Account,
  Category,
  CurrencyFormat,
  TransactionDetail,
} from "ynab";

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

const isCreateRequest = (
  request: PendingTransactionRequest,
): request is PendingCreateTransactionRequest =>
  request.kind === undefined || request.kind === "create";

const transactionFingerprint = (transaction: TransactionDetail) =>
  hash(
    JSON.stringify({
      id: transaction.id,
      accountId: transaction.account_id,
      categoryId: transaction.category_id ?? null,
      payeeId: transaction.payee_id ?? null,
      payeeName: transaction.payee_name ?? null,
      date: transaction.date,
      amount: transaction.amount,
      memo: transaction.memo ?? null,
      cleared: transaction.cleared,
      approved: transaction.approved,
      flagColor: transaction.flag_color ?? null,
      deleted: transaction.deleted,
      subtransactions: transaction.subtransactions,
    }),
  );

const transactionSummary = (
  transaction: {
    id?: string;
    accountName: string;
    categoryName?: string | null;
    payeeName?: string | null;
    date: string;
    amount: number;
    memo?: string | null;
  },
  currencyFormat: CurrencyFormat,
): TransactionSummary => ({
  transactionId: transaction.id,
  accountName: transaction.accountName,
  categoryName: transaction.categoryName ?? undefined,
  payeeName: transaction.payeeName ?? undefined,
  memo: transaction.memo ?? undefined,
  date: transaction.date,
  amount: formatMilliunits(Math.abs(transaction.amount), currencyFormat),
  direction: transaction.amount < 0 ? "expense" : "income",
});

const changedFields = (
  before: TransactionDetail,
  after: PendingUpdateTransactionRequest["transaction"],
) => {
  const changes: string[] = [];
  if (before.account_id !== after.accountId) changes.push("account");
  if ((before.category_id ?? null) !== (after.categoryId ?? null)) {
    changes.push("category");
  }
  if (
    (before.payee_id ?? null) !== (after.payeeId ?? null) ||
    (before.payee_name ?? null) !== (after.payeeName ?? null)
  ) {
    changes.push("payee");
  }
  if (before.date !== after.date) changes.push("date");
  if (before.amount !== after.amountMilliunits) changes.push("amount");
  if ((before.memo ?? null) !== (after.memo ?? null)) changes.push("memo");
  return changes;
};

const persistPreparedMutation = async ({
  database,
  mastraResourceId,
  sourceMessageId,
  action,
  idempotencyKey,
  request,
  safeSummary,
  now,
}: {
  database: Database;
  mastraResourceId: string;
  sourceMessageId?: string;
  action: "update_transaction" | "delete_transaction";
  idempotencyKey: string;
  request: PendingUpdateTransactionRequest | PendingDeleteTransactionRequest;
  safeSummary: MutationSummary;
  now: Date;
}) => {
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hash(token);
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
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
      mastraResourceId,
      action,
      sourceMessageId,
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
  };
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
    kind: "create",
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
    if (
      audit.action !== "create_transaction" ||
      !isCreateRequest(audit.request)
    ) {
      return { ok: false as const, error: "confirmation_action_mismatch" };
    }
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

type PrepareTransactionUpdateInput = {
  mastraResourceId: string;
  sourceMessageId?: string;
  timezone: string;
  transactionId: string;
  direction?: "expense" | "income";
  amount?: number;
  accountId?: string;
  accountName?: string;
  categoryId?: string;
  categoryName?: string;
  clearCategory?: boolean;
  payeeName?: string;
  clearPayee?: boolean;
  date?: string;
  memo?: string;
  clearMemo?: boolean;
};

export const prepareTransactionUpdate = async (
  input: PrepareTransactionUpdateInput,
  dependencies: { database?: Database; gateway?: YnabGateway; now?: Date } = {},
) => {
  const database = dependencies.database ?? (await productionDatabase());
  const gateway = dependencies.gateway ?? ynabGateway;
  const now = dependencies.now ?? new Date();

  if (input.accountId && input.accountName) {
    return { ok: false as const, error: "choose_account_id_or_name" };
  }
  if (input.categoryId && input.categoryName) {
    return { ok: false as const, error: "choose_category_id_or_name" };
  }
  if (
    (input.categoryId || input.categoryName) &&
    input.clearCategory
  ) {
    return { ok: false as const, error: "category_change_is_ambiguous" };
  }
  if (input.payeeName && input.clearPayee) {
    return { ok: false as const, error: "payee_change_is_ambiguous" };
  }
  if (input.memo !== undefined && input.clearMemo) {
    return { ok: false as const, error: "memo_change_is_ambiguous" };
  }
  if (input.amount !== undefined && !(input.amount > 0)) {
    return { ok: false as const, error: "amount_must_be_positive" };
  }
  if (input.date && !isIsoDate(input.date)) {
    return { ok: false as const, error: "invalid_date" };
  }
  if (
    input.date &&
    input.date > currentDateKey(input.timezone, now)
  ) {
    return { ok: false as const, error: "future_transactions_are_not_supported" };
  }

  const [transactionResponse, settingsResponse] = await Promise.all([
    gateway.getTransaction(input.transactionId),
    gateway.getPlanSettings(),
  ]);
  const current = transactionResponse.data.transaction;
  if (current.deleted) {
    return { ok: false as const, error: "transaction_is_deleted" };
  }
  if (current.transfer_account_id) {
    return { ok: false as const, error: "transfer_updates_are_not_supported" };
  }
  if (current.subtransactions.length > 0) {
    return { ok: false as const, error: "split_transaction_updates_are_not_supported" };
  }

  let accountId = current.account_id;
  let accountName = current.account_name;
  if (input.accountId || input.accountName) {
    const accountsResponse = await gateway.getAccounts();
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
    accountId = account.value.id;
    accountName = account.value.name;
  }

  const date = input.date ?? current.date;
  let categoryId: string | null = current.category_id ?? null;
  let categoryName: string | null = current.category_name ?? null;
  if (input.clearCategory) {
    categoryId = null;
    categoryName = null;
  } else if (input.categoryId || input.categoryName) {
    const monthResponse = await gateway.getMonth(`${date.slice(0, 7)}-01`);
    const category = exactCategory(
      monthResponse.data.month.categories,
      input.categoryId,
      input.categoryName,
    );
    if (!category.value) {
      return {
        ok: false as const,
        error: "category_not_found_or_ambiguous",
        candidates: category.candidates.map((candidate) => ({
          id: candidate.id,
          group: candidate.category_group_name,
          name: candidate.name,
        })),
      };
    }
    categoryId = category.value.id;
    categoryName = `${category.value.category_group_name ?? "Unknown group"} / ${category.value.name}`;
  }

  const currentDirection = current.amount < 0 ? "expense" : "income";
  const direction = input.direction ?? currentDirection;
  const unsignedAmount =
    input.amount === undefined
      ? Math.abs(current.amount)
      : majorToMilliunits(input.amount);
  const amountMilliunits =
    direction === "expense" ? -unsignedAmount : unsignedAmount;
  const payeeId = input.clearPayee || input.payeeName ? null : current.payee_id ?? null;
  const payeeName = input.clearPayee
    ? null
    : input.payeeName?.trim() ?? current.payee_name ?? null;
  const memo = input.clearMemo
    ? null
    : input.memo?.trim() ?? current.memo ?? null;

  const request: PendingUpdateTransactionRequest = {
    kind: "update",
    transactionId: current.id,
    originalFingerprint: transactionFingerprint(current),
    transaction: {
      accountId,
      categoryId,
      payeeId,
      payeeName,
      date,
      amountMilliunits,
      memo,
      cleared: current.cleared,
      approved: current.approved,
      flagColor: current.flag_color || null,
    },
  };
  const changes = changedFields(current, request.transaction);
  if (changes.length === 0) {
    return { ok: false as const, error: "no_changes" };
  }

  const currencyFormat = settingsResponse.data.settings
    .currency_format as CurrencyFormat;
  const safeSummary: MutationSummary = {
    action: "update_transaction",
    transactionId: current.id,
    before: transactionSummary(
      {
        id: current.id,
        accountName: current.account_name,
        categoryName: current.category_name,
        payeeName: current.payee_name,
        date: current.date,
        amount: current.amount,
        memo: current.memo,
      },
      currencyFormat,
    ),
    after: transactionSummary(
      {
        id: current.id,
        accountName,
        categoryName,
        payeeName,
        date,
        amount: amountMilliunits,
        memo,
      },
      currencyFormat,
    ),
    changes,
  };
  const idempotencyKey = hash(
    JSON.stringify({
      resource: input.mastraResourceId,
      source: input.sourceMessageId ?? randomUUID(),
      action: "update_transaction",
      transactionId: current.id,
      transaction: request.transaction,
    }),
  );

  return persistPreparedMutation({
    database,
    mastraResourceId: input.mastraResourceId,
    sourceMessageId: input.sourceMessageId,
    action: "update_transaction",
    idempotencyKey,
    request,
    safeSummary,
    now,
  });
};

export const commitPreparedTransactionUpdate = async (
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
    if (
      audit.action !== "update_transaction" ||
      audit.request.kind !== "update"
    ) {
      return { ok: false as const, error: "confirmation_action_mismatch" };
    }
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

    const currentResponse = await gateway.getTransaction(
      audit.request.transactionId,
    );
    const current = currentResponse.data.transaction;
    if (
      current.deleted ||
      transactionFingerprint(current) !== audit.request.originalFingerprint
    ) {
      return { ok: false as const, error: "ynab_transaction_changed" };
    }

    const pending = audit.request.transaction;
    const saveTransaction: YnabTransactionUpdate = {
      account_id: pending.accountId,
      category_id: pending.categoryId,
      payee_id: pending.payeeId,
      payee_name: pending.payeeName,
      date: pending.date,
      amount: pending.amountMilliunits,
      memo: pending.memo,
      cleared: pending.cleared,
      approved: pending.approved,
      flag_color: pending.flagColor,
    };
    const result = await gateway.updateTransaction(
      audit.request.transactionId,
      saveTransaction,
    );
    const ynabTransactionId =
      result.data.transaction.id ?? audit.request.transactionId;

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
      alreadyCommitted: false,
      ynabTransactionId,
      summary: audit.safeSummary,
    };
  });
};

type PrepareTransactionDeletionInput = {
  mastraResourceId: string;
  sourceMessageId?: string;
  transactionId: string;
};

export const prepareTransactionDeletion = async (
  input: PrepareTransactionDeletionInput,
  dependencies: { database?: Database; gateway?: YnabGateway; now?: Date } = {},
) => {
  const database = dependencies.database ?? (await productionDatabase());
  const gateway = dependencies.gateway ?? ynabGateway;
  const now = dependencies.now ?? new Date();
  const [transactionResponse, settingsResponse] = await Promise.all([
    gateway.getTransaction(input.transactionId),
    gateway.getPlanSettings(),
  ]);
  const current = transactionResponse.data.transaction;
  if (current.deleted) {
    return { ok: false as const, error: "transaction_is_deleted" };
  }

  const request: PendingDeleteTransactionRequest = {
    kind: "delete",
    transactionId: current.id,
    originalFingerprint: transactionFingerprint(current),
  };
  const safeSummary: MutationSummary = {
    action: "delete_transaction",
    transactionId: current.id,
    transaction: transactionSummary(
      {
        id: current.id,
        accountName: current.account_name,
        categoryName: current.category_name,
        payeeName: current.payee_name,
        date: current.date,
        amount: current.amount,
        memo: current.memo,
      },
      settingsResponse.data.settings.currency_format as CurrencyFormat,
    ),
  };
  const idempotencyKey = hash(
    JSON.stringify({
      resource: input.mastraResourceId,
      source: input.sourceMessageId ?? randomUUID(),
      action: "delete_transaction",
      transactionId: current.id,
      fingerprint: request.originalFingerprint,
    }),
  );
  const prepared = await persistPreparedMutation({
    database,
    mastraResourceId: input.mastraResourceId,
    sourceMessageId: input.sourceMessageId,
    action: "delete_transaction",
    idempotencyKey,
    request,
    safeSummary,
    now,
  });

  return current.transfer_account_id
    ? {
        ...prepared,
        warning: "This is a transfer transaction; YNAB may remove both sides.",
      }
    : prepared;
};

export const commitPreparedTransactionDeletion = async (
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
    if (
      audit.action !== "delete_transaction" ||
      audit.request.kind !== "delete"
    ) {
      return { ok: false as const, error: "confirmation_action_mismatch" };
    }
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

    const currentResponse = await gateway.getTransaction(
      audit.request.transactionId,
    );
    const current = currentResponse.data.transaction;
    if (
      current.deleted ||
      transactionFingerprint(current) !== audit.request.originalFingerprint
    ) {
      return { ok: false as const, error: "ynab_transaction_changed" };
    }

    await gateway.deleteTransaction(audit.request.transactionId);
    await transaction
      .update(mutationAudit)
      .set({
        status: "committed",
        ynabEntityType: "transaction",
        ynabEntityId: audit.request.transactionId,
        errorCode: null,
        updatedAt: now,
      })
      .where(eq(mutationAudit.id, audit.id));

    return {
      ok: true as const,
      alreadyCommitted: false,
      ynabTransactionId: audit.request.transactionId,
      summary: audit.safeSummary,
    };
  });
};
