import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { ObservabilityStorageClickhouseVNext } from "@mastra/clickhouse";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { env } from "../config/env";
import { financialAgent } from "./agents/financial-agent";
import { evaluatePurchase } from "./workflows/evaluate-purchase";
import { generateFinancialReport } from "./workflows/generate-financial-report";
import { mutatePlannedExpense } from "./workflows/mutate-planned-expense";
import { mutateSavingsPlan } from "./workflows/mutate-savings-plan";
import { updateFinancialProfile } from "./workflows/update-financial-profile";
import { createSharedAuthProvider } from "./auth/shared-auth-provider";

const postgresStorage = new PostgresStore({
  id: "fnpc-mastra-storage",
  connectionString: env.databaseUrl,
});

const storage = env.clickhouse
  ? new MastraCompositeStore({
      id: "fnpc-composite-storage",
      default: postgresStorage,
      domains: {
        observability: new ObservabilityStorageClickhouseVNext({
          url: env.clickhouse.url,
          username: env.clickhouse.username,
          password: env.clickhouse.password,
        }),
      },
    })
  : postgresStorage;

export const mastra = new Mastra({
  agents: { financialAgent },
  workflows: { evaluatePurchase, generateFinancialReport, mutatePlannedExpense, mutateSavingsPlan, updateFinancialProfile },
  storage,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "fnpc",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  server: env.studioAuth
    ? {
        auth: createSharedAuthProvider(env.studioAuth),
      }
    : undefined,
});
