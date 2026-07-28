import * as ynab from "ynab";
import { env } from "../config/env";

type YnabClient = Pick<
  ynab.API,
  | "plans"
  | "accounts"
  | "categories"
  | "months"
  | "payees"
  | "scheduledTransactions"
  | "transactions"
>;

type YnabErrorCode =
  | "authentication_failed"
  | "access_denied"
  | "not_found"
  | "rate_limited"
  | "ynab_unavailable"
  | "invalid_request";

class YnabGatewayError extends Error {
  constructor(
    readonly code: YnabErrorCode,
    readonly status?: number,
  ) {
    super(`YNAB request failed: ${code}`);
    this.name = "YnabGatewayError";
  }
}

export const toYnabGatewayError = (error: unknown): YnabGatewayError => {
  if (error instanceof YnabGatewayError) return error;
  if (error instanceof ynab.ResponseError) {
    const status = error.response.status;
    const code: YnabErrorCode =
      status === 401
        ? "authentication_failed"
        : status === 403
          ? "access_denied"
          : status === 404
            ? "not_found"
            : status === 429
              ? "rate_limited"
              : status >= 500
                ? "ynab_unavailable"
                : "invalid_request";
    return new YnabGatewayError(code, status);
  }
  return new YnabGatewayError("ynab_unavailable");
};

export type TransactionQuery = {
  sinceDate?: string;
  untilDate?: string;
  type?: ynab.GetTransactionsTypeEnum;
};

export type YnabTransactionUpdate = Omit<
  ynab.ExistingTransaction,
  "category_id" | "payee_id" | "payee_name" | "memo"
> & {
  category_id?: string | null;
  payee_id?: string | null;
  payee_name?: string | null;
  memo?: string | null;
};

export class YnabGateway {
  private client?: YnabClient;

  constructor(
    private readonly options: {
      accessToken?: string;
      planId?: string;
      client?: YnabClient;
    },
  ) {
    this.client = options.client;
  }

  private configuration() {
    if (!this.options.planId) throw new Error("YNAB_PLAN_ID is required");
    if (!this.client) {
      if (!this.options.accessToken) {
        throw new Error("YNAB_ACCESS_TOKEN is required");
      }
      this.client = new ynab.API(this.options.accessToken);
    }

    return { client: this.client, planId: this.options.planId };
  }

  private request<T>(operation: () => Promise<T>) {
    return operation().catch((error) => Promise.reject(toYnabGatewayError(error)));
  }

  async getPlanSettings() {
    const { client, planId } = this.configuration();
    return this.request(() => client.plans.getPlanSettingsById(planId));
  }

  async getAccounts() {
    const { client, planId } = this.configuration();
    return this.request(() => client.accounts.getAccounts(planId));
  }

  async getAccount(accountId: string) {
    const { client, planId } = this.configuration();
    return this.request(() => client.accounts.getAccountById(planId, accountId));
  }

  async getCategories() {
    const { client, planId } = this.configuration();
    return this.request(() => client.categories.getCategories(planId));
  }

  async getCategory(categoryId: string) {
    const { client, planId } = this.configuration();
    return this.request(() => client.categories.getCategoryById(planId, categoryId));
  }

  async getMonthCategory(month: string, categoryId: string) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.categories.getMonthCategoryById(planId, month, categoryId),
    );
  }

  async getMonths() {
    const { client, planId } = this.configuration();
    return this.request(() => client.months.getPlanMonths(planId));
  }

  async getMonth(month: string) {
    const { client, planId } = this.configuration();
    return this.request(() => client.months.getPlanMonth(planId, month));
  }

  async getPayees() {
    const { client, planId } = this.configuration();
    return this.request(() => client.payees.getPayees(planId));
  }

  async getPayee(payeeId: string) {
    const { client, planId } = this.configuration();
    return this.request(() => client.payees.getPayeeById(planId, payeeId));
  }

  async getScheduledTransactions() {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.scheduledTransactions.getScheduledTransactions(planId),
    );
  }

  async getScheduledTransaction(scheduledTransactionId: string) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.scheduledTransactions.getScheduledTransactionById(
        planId,
        scheduledTransactionId,
      ),
    );
  }

  async getTransactions(query: TransactionQuery = {}) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.getTransactions(
        planId,
        query.sinceDate,
        query.untilDate,
        query.type,
      ),
    );
  }

  async getAccountTransactions(accountId: string, query: TransactionQuery = {}) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.getTransactionsByAccount(
        planId,
        accountId,
        query.sinceDate,
        query.untilDate,
        query.type,
      ),
    );
  }

  async getCategoryTransactions(categoryId: string, query: TransactionQuery = {}) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.getTransactionsByCategory(
        planId,
        categoryId,
        query.sinceDate,
        query.untilDate,
        query.type,
      ),
    );
  }

  async getMonthTransactions(month: string, query: TransactionQuery = {}) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.getTransactionsByMonth(
        planId,
        month,
        query.sinceDate,
        query.untilDate,
        query.type,
      ),
    );
  }

  async getPayeeTransactions(payeeId: string, query: TransactionQuery = {}) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.getTransactionsByPayee(
        planId,
        payeeId,
        query.sinceDate,
        query.untilDate,
        query.type,
      ),
    );
  }

  async getTransaction(transactionId: string) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.getTransactionById(planId, transactionId),
    );
  }

  async createTransaction(transaction: ynab.NewTransaction) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.createTransaction(planId, { transaction }),
    );
  }

  async updateTransaction(
    transactionId: string,
    transaction: YnabTransactionUpdate,
  ) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.updateTransaction(planId, transactionId, {
        transaction: transaction as ynab.ExistingTransaction,
      }),
    );
  }

  async deleteTransaction(transactionId: string) {
    const { client, planId } = this.configuration();
    return this.request(() =>
      client.transactions.deleteTransaction(planId, transactionId),
    );
  }
}

export const ynabGateway = new YnabGateway(env.ynab);
