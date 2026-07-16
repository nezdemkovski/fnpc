import * as ynab from "ynab";
import { env } from "../config/env";
import { buildYnabSnapshot, type YnabSnapshot } from "./snapshot";

type YnabClient = Pick<ynab.API, "plans" | "transactions">;

export type YnabErrorCode =
  | "authentication_failed"
  | "access_denied"
  | "not_found"
  | "rate_limited"
  | "ynab_unavailable"
  | "invalid_request";

export class YnabGatewayError extends Error {
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

export class YnabGateway {
  private client?: YnabClient;
  private cache?: { expiresAt: number; snapshot: YnabSnapshot };

  constructor(
    private readonly options: {
      accessToken?: string;
      planId?: string;
      cacheTtlMs: number;
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

  async getSnapshot({ force = false }: { force?: boolean } = {}) {
    if (!force && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.snapshot;
    }

    const { client, planId } = this.configuration();
    const response = await client.plans
      .getPlanById(planId)
      .catch((error) => Promise.reject(toYnabGatewayError(error)));
    const snapshot = buildYnabSnapshot({
      plan: response.data.plan,
      serverKnowledge: response.data.server_knowledge,
    });
    this.cache = {
      expiresAt: Date.now() + this.options.cacheTtlMs,
      snapshot,
    };
    return snapshot;
  }

  async createTransaction(transaction: ynab.NewTransaction) {
    const { client, planId } = this.configuration();
    const response = await client.transactions
      .createTransaction(planId, { transaction })
      .catch((error) => Promise.reject(toYnabGatewayError(error)));
    this.invalidate();
    return response.data;
  }

  invalidate() {
    this.cache = undefined;
  }
}

export const ynabGateway = new YnabGateway(env.ynab);
