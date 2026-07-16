import type {
  Account,
  Category,
  CategoryGroupWithCategories,
  HybridTransaction,
  MonthDetail,
  MonthSummary,
  Payee,
  ScheduledSubTransaction,
  ScheduledTransactionDetail,
  ScheduledTransactionSummary,
  SubTransaction,
  TransactionDetail,
} from "ynab";

const presentAmount = (
  milliunits: number,
  formatted?: string | null,
  currency?: number | null,
) => ({ milliunits, formatted: formatted ?? undefined, currency: currency ?? undefined });

export const presentAccount = (account: Account) => ({
  id: account.id,
  name: account.name,
  type: account.type,
  onBudget: account.on_budget,
  closed: account.closed,
  note: account.note,
  balance: presentAmount(
    account.balance,
    account.balance_formatted,
    account.balance_currency,
  ),
  clearedBalance: presentAmount(
    account.cleared_balance,
    account.cleared_balance_formatted,
    account.cleared_balance_currency,
  ),
  unclearedBalance: presentAmount(
    account.uncleared_balance,
    account.uncleared_balance_formatted,
    account.uncleared_balance_currency,
  ),
  directImportLinked: account.direct_import_linked ?? false,
  directImportInError: account.direct_import_in_error ?? false,
  lastReconciledAt: account.last_reconciled_at,
});

export const presentCategory = (category: Category, groupName?: string) => ({
  id: category.id,
  groupId: category.category_group_id,
  groupName: category.category_group_name ?? groupName,
  name: category.name,
  hidden: category.hidden,
  internal: category.internal,
  note: category.note,
  assigned: presentAmount(
    category.budgeted,
    category.budgeted_formatted,
    category.budgeted_currency,
  ),
  activity: presentAmount(
    category.activity,
    category.activity_formatted,
    category.activity_currency,
  ),
  available: presentAmount(
    category.balance,
    category.balance_formatted,
    category.balance_currency,
  ),
  goal: category.goal_type
    ? {
        type: category.goal_type,
        needsWholeAmount: category.goal_needs_whole_amount,
        day: category.goal_day,
        cadence: category.goal_cadence,
        cadenceFrequency: category.goal_cadence_frequency,
        targetDate: category.goal_target_date,
        target: category.goal_target == null
          ? undefined
          : presentAmount(
              category.goal_target,
              category.goal_target_formatted,
              category.goal_target_currency,
            ),
        underfunded: category.goal_under_funded == null
          ? undefined
          : presentAmount(
              category.goal_under_funded,
              category.goal_under_funded_formatted,
              category.goal_under_funded_currency,
            ),
        percentageComplete: category.goal_percentage_complete,
        monthsToBudget: category.goal_months_to_budget,
        snoozedAt: category.goal_snoozed_at,
      }
    : undefined,
});

export const presentCategoryGroup = (group: CategoryGroupWithCategories) => ({
  id: group.id,
  name: group.name,
  hidden: group.hidden,
  internal: group.internal,
  categories: group.categories
    .filter((category) => !category.deleted)
    .map((category) => presentCategory(category, group.name)),
});

export const presentMonth = (month: MonthSummary | MonthDetail) => ({
  month: month.month,
  note: month.note,
  income: presentAmount(month.income, month.income_formatted, month.income_currency),
  assigned: presentAmount(
    month.budgeted,
    month.budgeted_formatted,
    month.budgeted_currency,
  ),
  activity: presentAmount(
    month.activity,
    month.activity_formatted,
    month.activity_currency,
  ),
  readyToAssign: presentAmount(
    month.to_be_budgeted,
    month.to_be_budgeted_formatted,
    month.to_be_budgeted_currency,
  ),
  ageOfMoneyDays: month.age_of_money,
  categories:
    "categories" in month
      ? month.categories
          .filter((category) => !category.deleted)
          .map((category) => presentCategory(category))
      : undefined,
});

export const presentPayee = (payee: Payee) => ({
  id: payee.id,
  name: payee.name,
  transferAccountId: payee.transfer_account_id ?? undefined,
});

const presentSubtransaction = (
  item: SubTransaction | ScheduledSubTransaction,
) => ({
  id: item.id,
  amount: presentAmount(item.amount, item.amount_formatted, item.amount_currency),
  memo: item.memo,
  payeeId: item.payee_id,
  payeeName: item.payee_name,
  categoryId: item.category_id,
  categoryName: item.category_name,
  transferAccountId: item.transfer_account_id,
  transferTransactionId:
    "transfer_transaction_id" in item
      ? item.transfer_transaction_id
      : undefined,
});

export const presentTransaction = (
  transaction: TransactionDetail | HybridTransaction,
) => ({
  id: transaction.id,
  date: transaction.date,
  amount: presentAmount(
    transaction.amount,
    transaction.amount_formatted,
    transaction.amount_currency,
  ),
  memo: transaction.memo,
  cleared: transaction.cleared,
  approved: transaction.approved,
  accountId: transaction.account_id,
  accountName: transaction.account_name,
  payeeId: transaction.payee_id,
  payeeName: transaction.payee_name ?? undefined,
  categoryId: transaction.category_id,
  categoryName: transaction.category_name ?? undefined,
  transferAccountId: transaction.transfer_account_id,
  transferTransactionId: transaction.transfer_transaction_id,
  matchedTransactionId: transaction.matched_transaction_id,
  importId: transaction.import_id,
  transactionType: "type" in transaction ? transaction.type : "transaction",
  parentTransactionId:
    "parent_transaction_id" in transaction
      ? transaction.parent_transaction_id ?? undefined
      : undefined,
  subtransactions:
    "subtransactions" in transaction
      ? transaction.subtransactions
          .filter((item) => !item.deleted)
          .map(presentSubtransaction)
      : undefined,
});

export const presentScheduledTransaction = (
  transaction: ScheduledTransactionSummary | ScheduledTransactionDetail,
) => ({
  id: transaction.id,
  firstDate: transaction.date_first,
  nextDate: transaction.date_next,
  frequency: transaction.frequency,
  amount: presentAmount(
    transaction.amount,
    transaction.amount_formatted,
    transaction.amount_currency,
  ),
  memo: transaction.memo,
  flagColor: transaction.flag_color ?? undefined,
  accountId: transaction.account_id,
  accountName:
    "account_name" in transaction ? transaction.account_name : undefined,
  payeeId: transaction.payee_id,
  payeeName:
    "payee_name" in transaction
      ? transaction.payee_name ?? undefined
      : undefined,
  categoryId: transaction.category_id,
  categoryName:
    "category_name" in transaction
      ? transaction.category_name ?? undefined
      : undefined,
  transferAccountId: transaction.transfer_account_id,
  subtransactions:
    "subtransactions" in transaction
      ? transaction.subtransactions
          .filter((item) => !item.deleted)
          .map(presentSubtransaction)
      : undefined,
});

export const presentTransactionPage = (
  transactions: Array<TransactionDetail | HybridTransaction>,
  limit: number,
) => {
  const active = transactions.filter((transaction) => !transaction.deleted);
  return {
    totalCount: active.length,
    returnedCount: Math.min(active.length, limit),
    truncated: active.length > limit,
    transactions: active.slice(0, limit).map(presentTransaction),
  };
};
