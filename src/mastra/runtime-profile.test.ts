import { describe, expect, test } from "bun:test";
import type { YnabSnapshot } from "../ynab/snapshot";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

const {
  buildRuntimeContextMessage,
  getRuntimeProfile,
  missingRuntimeFields,
} = await import("./runtime-profile");

const currency: YnabSnapshot["currency"] = {
  iso_code: "EUR",
  example_format: "123.45",
  decimal_digits: 2,
  decimal_separator: ".",
  symbol_first: true,
  group_separator: ",",
  currency_symbol: "€",
  display_symbol: true,
};

const snapshot: YnabSnapshot = {
  planId: "plan-1",
  planName: "Personal",
  currency,
  serverKnowledge: 42,
  fetchedAt: "2026-07-17T10:00:00.000Z",
  accounts: [],
  months: [
    {
      month: "2026-07",
      income: 100_000,
      budgeted: 80_000,
      activity: -20_000,
      readyToAssign: 20_000,
      categories: [],
    },
  ],
  transactions: [],
  scheduledTransactions: [],
};

const profile = {
  id: "profile-1",
  mastraResourceId: "telegram:user-1",
  telegramUserId: "user-1",
  displayName: "Yuri",
  preferredName: "Yuri",
  responseLanguage: "ru",
  timezone: "Europe/Prague",
  financialPolicy: {},
  createdAt: new Date("2026-07-17T09:00:00.000Z"),
  updatedAt: new Date("2026-07-17T09:00:00.000Z"),
};

describe("runtime YNAB freshness", () => {
  test("forces one refresh and exposes an authoritative current state", async () => {
    let refreshOptions: { force?: boolean } | undefined;
    const result = await getRuntimeProfile("telegram:user-1", {
      getOrCreateProfile: async () => profile,
      ynabGateway: {
        getSnapshot: async (options) => {
          refreshOptions = options;
          return snapshot;
        },
      },
    });

    expect(refreshOptions).toEqual({ force: true });
    expect(result.ynab).toMatchObject({
      status: "fresh",
      fetchedAt: "2026-07-17T10:00:00.000Z",
      serverKnowledge: 42,
      currentState: { readyToAssign: "€20.00", issueCount: 0 },
    });
    expect(buildRuntimeContextMessage(result)).toContain(
      "current financial state supersedes all numbers in conversation memory",
    );
  });

  test("marks current data unavailable without restarting onboarding", async () => {
    const result = await getRuntimeProfile("telegram:user-1", {
      getOrCreateProfile: async () => profile,
      ynabGateway: {
        getSnapshot: async () => {
          throw new Error("network unavailable");
        },
      },
    });

    expect(result.ynab).toMatchObject({
      status: "unavailable",
      connected: false,
      errorCode: "ynab_unavailable",
    });
    expect(missingRuntimeFields(result)).toEqual([]);
    expect(buildRuntimeContextMessage(result)).toContain(
      "If snapshot status is unavailable, never answer current financial questions from memory",
    );
  });
});
