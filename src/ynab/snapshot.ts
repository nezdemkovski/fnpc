import type {
  AccountBase,
  CategoryBase,
  CurrencyFormat,
  PlanDetail,
} from "ynab";

export type YnabAccount = {
  id: string;
  name: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  balance: number;
  clearedBalance: number;
  unclearedBalance: number;
  directImportLinked: boolean;
  directImportInError: boolean;
};

export type YnabCategory = {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  hidden: boolean;
  internal: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  goalType?: string;
  goalTarget?: number;
  goalTargetDate?: string;
  goalPercentageComplete?: number;
  goalUnderfunded?: number;
};

export type YnabMonth = {
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  readyToAssign: number;
  ageOfMoney?: number;
  categories: YnabCategory[];
};

export type YnabTransaction = {
  id: string;
  date: string;
  amount: number;
  memo?: string;
  cleared: string;
  approved: boolean;
  accountId: string;
  accountName: string;
  payeeId?: string;
  payeeName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryGroupName?: string;
  transferAccountId?: string;
  importId?: string;
};

export type YnabScheduledTransaction = {
  id: string;
  nextDate: string;
  frequency: string;
  amount: number;
  accountId: string;
  accountName: string;
  payeeName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryGroupName?: string;
};

export type YnabSnapshot = {
  planId: string;
  planName: string;
  currency: CurrencyFormat;
  serverKnowledge: number;
  fetchedAt: string;
  accounts: YnabAccount[];
  months: YnabMonth[];
  transactions: YnabTransaction[];
  scheduledTransactions: YnabScheduledTransaction[];
};

const normalizeCategory = (
  category: CategoryBase,
  groupNames: Map<string, string>,
): YnabCategory => ({
  id: category.id,
  groupId: category.category_group_id,
  groupName:
    category.category_group_name ??
    groupNames.get(category.category_group_id) ??
    "Unknown group",
  name: category.name,
  hidden: category.hidden,
  internal: category.internal,
  budgeted: category.budgeted,
  activity: category.activity,
  balance: category.balance,
  goalType: category.goal_type ?? undefined,
  goalTarget: category.goal_target ?? undefined,
  goalTargetDate: category.goal_target_date ?? undefined,
  goalPercentageComplete: category.goal_percentage_complete ?? undefined,
  goalUnderfunded: category.goal_under_funded ?? undefined,
});

const activeAccount = (account: AccountBase) => !account.deleted;

export const buildYnabSnapshot = ({
  plan,
  serverKnowledge,
  now = new Date(),
}: {
  plan: PlanDetail;
  serverKnowledge: number;
  now?: Date;
}): YnabSnapshot => {
  if (!plan.currency_format) {
    throw new Error("YNAB plan has no currency format");
  }

  const groupNames = new Map(
    (plan.category_groups ?? [])
      .filter((group) => !group.deleted)
      .map((group) => [group.id, group.name]),
  );
  const accounts = (plan.accounts ?? []).filter(activeAccount).map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    onBudget: account.on_budget,
    closed: account.closed,
    balance: account.balance,
    clearedBalance: account.cleared_balance,
    unclearedBalance: account.uncleared_balance,
    directImportLinked: account.direct_import_linked ?? false,
    directImportInError: account.direct_import_in_error ?? false,
  }));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const planCategories = [
    ...(plan.categories ?? []),
    ...(plan.months ?? []).flatMap((month) => month.categories),
  ]
    .filter((category) => !category.deleted)
    .map((category) => normalizeCategory(category, groupNames));
  const categoryNames = new Map(
    planCategories.map((category) => [category.id, category]),
  );
  const payeeNames = new Map(
    (plan.payees ?? [])
      .filter((payee) => !payee.deleted)
      .map((payee) => [payee.id, payee.name]),
  );

  return {
    planId: plan.id,
    planName: plan.name,
    currency: plan.currency_format,
    serverKnowledge,
    fetchedAt: now.toISOString(),
    accounts,
    months: (plan.months ?? [])
      .filter((month) => !month.deleted)
      .map((month) => ({
        month: month.month.slice(0, 7),
        income: month.income,
        budgeted: month.budgeted,
        activity: month.activity,
        readyToAssign: month.to_be_budgeted,
        ageOfMoney: month.age_of_money,
        categories: month.categories
          .filter((category) => !category.deleted)
          .map((category) => normalizeCategory(category, groupNames)),
      })),
    transactions: (plan.transactions ?? [])
      .filter((transaction) => !transaction.deleted)
      .map((transaction) => {
        const category = transaction.category_id
          ? categoryNames.get(transaction.category_id)
          : undefined;
        return {
          id: transaction.id,
          date: transaction.date,
          amount: transaction.amount,
          memo: transaction.memo ?? undefined,
          cleared: transaction.cleared,
          approved: transaction.approved,
          accountId: transaction.account_id,
          accountName:
            accountNames.get(transaction.account_id) ?? "Unknown account",
          payeeId: transaction.payee_id ?? undefined,
          payeeName: transaction.payee_id
            ? payeeNames.get(transaction.payee_id)
            : undefined,
          categoryId: transaction.category_id ?? undefined,
          categoryName: category?.name,
          categoryGroupName: category?.groupName,
          transferAccountId: transaction.transfer_account_id ?? undefined,
          importId: transaction.import_id ?? undefined,
        };
      }),
    scheduledTransactions: (plan.scheduled_transactions ?? [])
      .filter((transaction) => !transaction.deleted)
      .map((transaction) => {
        const category = transaction.category_id
          ? categoryNames.get(transaction.category_id)
          : undefined;
        return {
          id: transaction.id,
          nextDate: transaction.date_next,
          frequency: transaction.frequency,
          amount: transaction.amount,
          accountId: transaction.account_id,
          accountName:
            accountNames.get(transaction.account_id) ?? "Unknown account",
          payeeName: transaction.payee_id
            ? payeeNames.get(transaction.payee_id)
            : undefined,
          categoryId: transaction.category_id ?? undefined,
          categoryName: category?.name,
          categoryGroupName: category?.groupName,
        };
      }),
  };
};
