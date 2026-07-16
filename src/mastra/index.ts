import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { ObservabilityStorageClickhouseVNext } from "@mastra/clickhouse";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { env } from "../config/env";
import { financialAgent } from "./agents/financial-agent";
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
          retention: {
            tracing: env.clickhouse.retentionDays,
            logs: env.clickhouse.retentionDays,
            metrics: env.clickhouse.retentionDays,
            scores: env.clickhouse.retentionDays,
            feedback: env.clickhouse.retentionDays,
          },
        }),
      },
    })
  : postgresStorage;

export const mastra = new Mastra({
  agents: { financialAgent },
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
