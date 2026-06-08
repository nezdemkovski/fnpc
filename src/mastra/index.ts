import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { ObservabilityStorageClickhouseVNext } from "@mastra/clickhouse";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { env } from "../config/env";
import { agentRoutingScorer, workflowContractScorer } from "../evals/scorers";
import { financialAgent } from "./agents/financial-agent";
import { evaluatePurchase } from "./workflows/evaluate-purchase";
import { explainFinancialFact } from "./workflows/explain-financial-fact";
import { generateFinancialReport } from "./workflows/generate-financial-report";
import { mutatePlannedExpense } from "./workflows/mutate-planned-expense";
import { mutateRecurringExpense } from "./workflows/mutate-recurring-expense";
import { mutateSavingsPlan } from "./workflows/mutate-savings-plan";
import { recordActualExpense } from "./workflows/record-actual-expense";
import { transferToSavings } from "./workflows/transfer-to-savings";
import { updateAccountBalance } from "./workflows/update-account-balance";
import { updateFinancialProfile } from "./workflows/update-financial-profile";
import { MastraAuthRealm } from "./auth/shared-auth-provider";

const postgresStorage = new PostgresStore({
  id: "fnpc-mastra-storage",
  ...env.postgresConnection,
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
  workflows: {
    evaluatePurchase,
    explainFinancialFact,
    generateFinancialReport,
    mutatePlannedExpense,
    mutateRecurringExpense,
    mutateSavingsPlan,
    recordActualExpense,
    transferToSavings,
    updateAccountBalance,
    updateFinancialProfile,
  },
  scorers: {
    agentRoutingScorer,
    workflowContractScorer,
  },
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
  server: env.studioAuthEnabled
    ? {
        auth: new MastraAuthRealm(),
      }
    : undefined,
});
