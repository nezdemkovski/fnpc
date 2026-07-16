import { addDays, subDays } from "date-fns";
import { currentDateKey, currentMonthKey } from "../finance/dates";
import { formatMilliunits } from "../finance/money";
import type {
  YnabCategory,
  YnabSnapshot,
  YnabTransaction,
} from "./snapshot";

const activeCategories = (categories: YnabCategory[]) =>
  categories.filter((category) => !category.hidden && !category.internal);

const monthFor = (snapshot: YnabSnapshot, month: string) =>
  snapshot.months.find((candidate) => candidate.month === month);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const format = (snapshot: YnabSnapshot, value: number) =>
  formatMilliunits(value, snapshot.currency);

export const getBudgetOverview = (
  snapshot: YnabSnapshot,
  { timezone, now = new Date() }: { timezone: string; now?: Date },
) => {
  const monthKey = currentMonthKey(timezone, now);
  const month = monthFor(snapshot, monthKey);
  if (!month) throw new Error(`YNAB has no plan month for ${monthKey}`);

  const accounts = snapshot.accounts.filter((account) => !account.closed);
  const onBudget = accounts.filter((account) => account.onBudget);
  const tracking = accounts.filter((account) => !account.onBudget);
  const categories = activeCategories(month.categories);
  const today = currentDateKey(timezone, now);
  const scheduledThrough = currentDateKey(timezone, addDays(now, 31));
  const upcoming = snapshot.scheduledTransactions
    .filter(
      (transaction) =>
        transaction.nextDate >= today && transaction.nextDate <= scheduledThrough,
    )
    .sort((left, right) => left.nextDate.localeCompare(right.nextDate));

  return {
    source: "YNAB",
    plan: { id: snapshot.planId, name: snapshot.planName },
    fetchedAt: snapshot.fetchedAt,
    month: monthKey,
    currency: snapshot.currency.iso_code,
    readyToAssign: {
      milliunits: month.readyToAssign,
      formatted: format(snapshot, month.readyToAssign),
    },
    income: { milliunits: month.income, formatted: format(snapshot, month.income) },
    assigned: {
      milliunits: month.budgeted,
      formatted: format(snapshot, month.budgeted),
    },
    activity: {
      milliunits: month.activity,
      formatted: format(snapshot, month.activity),
    },
    ageOfMoneyDays: month.ageOfMoney,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      onBudget: account.onBudget,
      balance: account.balance,
      balanceFormatted: format(snapshot, account.balance),
      directImportInError: account.directImportInError,
    })),
    totals: {
      onBudgetBalance: format(snapshot, sum(onBudget.map((account) => account.balance))),
      trackingBalance: format(snapshot, sum(tracking.map((account) => account.balance))),
    },
    categories: categories.map((category) => ({
      id: category.id,
      group: category.groupName,
      name: category.name,
      assigned: format(snapshot, category.budgeted),
      activity: format(snapshot, category.activity),
      available: format(snapshot, category.balance),
      availableMilliunits: category.balance,
      goalUnderfunded: category.goalUnderfunded
        ? format(snapshot, category.goalUnderfunded)
        : undefined,
    })),
    scheduledNext31Days: upcoming.map((transaction) => ({
      date: transaction.nextDate,
      account: transaction.accountName,
      category: transaction.categoryName,
      payee: transaction.payeeName,
      amount: format(snapshot, transaction.amount),
    })),
  };
};

export const listBudgetIssues = (
  snapshot: YnabSnapshot,
  { timezone, now = new Date() }: { timezone: string; now?: Date },
) => {
  const monthKey = currentMonthKey(timezone, now);
  const month = monthFor(snapshot, monthKey);
  if (!month) throw new Error(`YNAB has no plan month for ${monthKey}`);
  const today = currentDateKey(timezone, now);

  const issues: Array<{
    severity: "high" | "medium" | "low";
    type:
      | "overspent_category"
      | "underfunded_goal"
      | "direct_import_error"
      | "uncategorized_transactions"
      | "unapproved_transactions"
      | "overdue_scheduled_transactions";
    categoryId?: string;
    category?: string;
    accountId?: string;
    account?: string;
    count?: number;
    amount?: string;
  }> = [
    ...activeCategories(month.categories)
      .filter((category) => category.balance < 0)
      .map((category) => ({
        severity: "high" as const,
        type: "overspent_category" as const,
        categoryId: category.id,
        category: `${category.groupName} / ${category.name}`,
        amount: format(snapshot, Math.abs(category.balance)),
      })),
    ...activeCategories(month.categories)
      .filter((category) => (category.goalUnderfunded ?? 0) > 0)
      .map((category) => ({
        severity: "medium" as const,
        type: "underfunded_goal" as const,
        categoryId: category.id,
        category: `${category.groupName} / ${category.name}`,
        amount: format(snapshot, category.goalUnderfunded ?? 0),
      })),
    ...snapshot.accounts
      .filter((account) => !account.closed && account.directImportInError)
      .map((account) => ({
        severity: "high" as const,
        type: "direct_import_error" as const,
        accountId: account.id,
        account: account.name,
      })),
  ];

  const currentTransactions = snapshot.transactions.filter(
    (transaction) => transaction.date.startsWith(monthKey),
  );
  const uncategorized = currentTransactions.filter(
    (transaction) =>
      transaction.amount < 0 &&
      !transaction.categoryId &&
      !transaction.transferAccountId,
  );
  const unapproved = currentTransactions.filter(
    (transaction) => !transaction.approved,
  );
  const overdueScheduled = snapshot.scheduledTransactions.filter(
    (transaction) => transaction.nextDate < today,
  );

  if (uncategorized.length > 0) {
    issues.push({
      severity: "medium",
      type: "uncategorized_transactions",
      count: uncategorized.length,
      amount: format(
        snapshot,
        Math.abs(sum(uncategorized.map((transaction) => transaction.amount))),
      ),
    });
  }
  if (unapproved.length > 0) {
    issues.push({
      severity: "low",
      type: "unapproved_transactions",
      count: unapproved.length,
      amount: format(
        snapshot,
        Math.abs(sum(unapproved.map((transaction) => transaction.amount))),
      ),
    });
  }
  if (overdueScheduled.length > 0) {
    issues.push({
      severity: "medium",
      type: "overdue_scheduled_transactions",
      count: overdueScheduled.length,
      amount: format(
        snapshot,
        Math.abs(sum(overdueScheduled.map((transaction) => transaction.amount))),
      ),
    });
  }

  return {
    source: "YNAB",
    month: monthKey,
    fetchedAt: snapshot.fetchedAt,
    issueCount: issues.length,
    issues,
  };
};

const expenseTransactions = (
  transactions: YnabTransaction[],
  from: string,
  through: string,
) =>
  transactions.filter(
    (transaction) =>
      transaction.date >= from &&
      transaction.date <= through &&
      transaction.amount < 0 &&
      !transaction.transferAccountId,
  );

const aggregate = (
  transactions: YnabTransaction[],
  key: (transaction: YnabTransaction) => string,
) =>
  [...transactions.reduce((groups, transaction) => {
    const name = key(transaction);
    groups.set(name, (groups.get(name) ?? 0) + Math.abs(transaction.amount));
    return groups;
  }, new Map<string, number>())]
    .map(([name, amount]) => ({ name, amount }))
    .sort((left, right) => right.amount - left.amount);

export const getSpendingAnalysis = (
  snapshot: YnabSnapshot,
  {
    timezone,
    days,
    now = new Date(),
  }: { timezone: string; days: number; now?: Date },
) => {
  const through = currentDateKey(timezone, now);
  const from = currentDateKey(timezone, subDays(now, days - 1));
  const transactions = expenseTransactions(snapshot.transactions, from, through);
  const total = sum(transactions.map((transaction) => Math.abs(transaction.amount)));

  const present = (items: Array<{ name: string; amount: number }>) =>
    items.map((item) => ({
      name: item.name,
      amountMilliunits: item.amount,
      amount: format(snapshot, item.amount),
      sharePercent: total === 0 ? 0 : Math.round((item.amount / total) * 1000) / 10,
    }));

  return {
    source: "YNAB",
    range: { from, through, days },
    fetchedAt: snapshot.fetchedAt,
    transactionCount: transactions.length,
    total: format(snapshot, total),
    totalMilliunits: total,
    byCategory: present(
      aggregate(transactions, (transaction) => transaction.categoryName ?? "Uncategorized"),
    ),
    byCategoryGroup: present(
      aggregate(
        transactions,
        (transaction) => transaction.categoryGroupName ?? "Uncategorized",
      ),
    ),
    byPayee: present(
      aggregate(transactions, (transaction) => transaction.payeeName ?? "No payee"),
    ),
  };
};

const normalizeName = (value: string) => value.trim().toLocaleLowerCase();

const matchesName = (value: string | undefined, expected: string) =>
  value ? normalizeName(value) === normalizeName(expected) : false;

export const findNamedCategory = (snapshot: YnabSnapshot, name: string) => {
  const normalized = normalizeName(name);
  const matches = snapshot.months
    .flatMap((month) => month.categories)
    .filter((category) => !category.hidden && !category.internal)
    .filter(
      (category) =>
        normalizeName(category.name) === normalized ||
        normalizeName(`${category.groupName} / ${category.name}`) === normalized,
    );
  return [...new Map(matches.map((category) => [category.id, category])).values()];
};

export const listTransactions = (
  snapshot: YnabSnapshot,
  {
    timezone,
    days = 30,
    from,
    through,
    accountId,
    accountName,
    categoryId,
    categoryName,
    payeeName,
    includeTransfers = true,
    limit = 20,
    now = new Date(),
  }: {
    timezone: string;
    days?: number;
    from?: string;
    through?: string;
    accountId?: string;
    accountName?: string;
    categoryId?: string;
    categoryName?: string;
    payeeName?: string;
    includeTransfers?: boolean;
    limit?: number;
    now?: Date;
  },
) => {
  const rangeThrough = through ?? currentDateKey(timezone, now);
  const rangeFrom =
    from ?? currentDateKey(timezone, subDays(now, Math.max(days, 1) - 1));
  const accounts = snapshot.accounts.filter((account) => !account.closed);
  const matchingAccounts = accountId
    ? accounts.filter((account) => account.id === accountId)
    : accountName
      ? accounts.filter((account) => matchesName(account.name, accountName))
      : [];
  const matchingCategories = categoryId
    ? snapshot.months
        .flatMap((month) => month.categories)
        .filter((category) => category.id === categoryId)
    : categoryName
      ? findNamedCategory(snapshot, categoryName)
      : [];
  const uniqueCategories = [
    ...new Map(matchingCategories.map((category) => [category.id, category])).values(),
  ];

  if ((accountId || accountName) && matchingAccounts.length !== 1) {
    return {
      source: "YNAB",
      status: "needs_account" as const,
      matchingAccounts: matchingAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
      })),
    };
  }
  if ((categoryId || categoryName) && uniqueCategories.length !== 1) {
    return {
      source: "YNAB",
      status: "needs_category" as const,
      matchingCategories: uniqueCategories.map((category) => ({
        id: category.id,
        group: category.groupName,
        name: category.name,
      })),
    };
  }

  const selectedAccount = matchingAccounts[0];
  const selectedCategory = uniqueCategories[0];
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const transactions = snapshot.transactions
    .filter(
      (transaction) =>
        transaction.date >= rangeFrom && transaction.date <= rangeThrough,
    )
    .filter(
      (transaction) =>
        !selectedAccount || transaction.accountId === selectedAccount.id,
    )
    .filter(
      (transaction) =>
        !selectedCategory || transaction.categoryId === selectedCategory.id,
    )
    .filter(
      (transaction) =>
        !payeeName || matchesName(transaction.payeeName, payeeName),
    )
    .filter((transaction) => includeTransfers || !transaction.transferAccountId)
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
    )
    .slice(0, limit)
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      amount: format(snapshot, transaction.amount),
      amountMilliunits: transaction.amount,
      direction: transaction.amount < 0 ? ("expense" as const) : ("income" as const),
      account: transaction.accountName,
      payee: transaction.payeeName,
      category: transaction.categoryName,
      categoryGroup: transaction.categoryGroupName,
      memo: transaction.memo,
      approved: transaction.approved,
      cleared: transaction.cleared,
      transfer: transaction.transferAccountId
        ? {
            account: accountNames.get(transaction.transferAccountId) ?? "Unknown account",
            transactionId: transaction.transferTransactionId,
          }
        : undefined,
    }));

  return {
    source: "YNAB",
    status: "ok" as const,
    fetchedAt: snapshot.fetchedAt,
    range: { from: rangeFrom, through: rangeThrough },
    filters: {
      account: selectedAccount
        ? { id: selectedAccount.id, name: selectedAccount.name }
        : undefined,
      category: selectedCategory
        ? {
            id: selectedCategory.id,
            group: selectedCategory.groupName,
            name: selectedCategory.name,
          }
        : undefined,
      payeeName,
      includeTransfers,
    },
    transactionCount: transactions.length,
    transactions,
  };
};

export const evaluatePurchase = (
  snapshot: YnabSnapshot,
  {
    timezone,
    amountMilliunits,
    categoryId,
    categoryName,
    minimumReadyToAssignMilliunits = 0,
    now = new Date(),
  }: {
    timezone: string;
    amountMilliunits: number;
    categoryId?: string;
    categoryName?: string;
    minimumReadyToAssignMilliunits?: number;
    now?: Date;
  },
) => {
  const monthKey = currentMonthKey(timezone, now);
  const month = monthFor(snapshot, monthKey);
  if (!month) throw new Error(`YNAB has no plan month for ${monthKey}`);
  const categories = activeCategories(month.categories);
  const category = categoryId
    ? categories.find((candidate) => candidate.id === categoryId)
    : categoryName
      ? findNamedCategory(snapshot, categoryName).find((candidate) =>
          categories.some((current) => current.id === candidate.id),
        )
      : undefined;

  if (!category) {
    return {
      source: "YNAB",
      verdict: "needs_category" as const,
      reason:
        "A purchase is affordable only when its YNAB category has enough available money.",
      requestedAmount: format(snapshot, amountMilliunits),
      matchingCategories: categoryName
        ? findNamedCategory(snapshot, categoryName).map((candidate) => ({
            id: candidate.id,
            group: candidate.groupName,
            name: candidate.name,
          }))
        : [],
    };
  }

  const afterPurchase = category.balance - amountMilliunits;
  const verdict =
    afterPurchase >= 0
      ? "affordable"
      : month.readyToAssign - Math.abs(afterPurchase) >=
          minimumReadyToAssignMilliunits
        ? "fund_category_first"
        : "not_affordable";

  return {
    source: "YNAB",
    verdict,
    month: monthKey,
    requestedAmount: format(snapshot, amountMilliunits),
    category: {
      id: category.id,
      group: category.groupName,
      name: category.name,
      availableBefore: format(snapshot, category.balance),
      availableAfter: format(snapshot, afterPurchase),
    },
    readyToAssign: format(snapshot, month.readyToAssign),
    minimumReadyToAssignAfterFunding: format(
      snapshot,
      minimumReadyToAssignMilliunits,
    ),
    explanation:
      verdict === "affordable"
        ? "The category already covers the purchase."
        : verdict === "fund_category_first"
          ? "The category is short, but Ready to Assign can cover the gap. Assign the money before buying."
          : "The category is short and Ready to Assign cannot cover the gap.",
  };
};
