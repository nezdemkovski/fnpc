import { postgresConnection } from "../db/connection";
import {
  modelProviderOptions,
  normalizeMastraModel,
  normalizeXaiReasoningEffort,
} from "./model";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const telegramAdapterMode = (
  value: string | undefined,
): "auto" | "webhook" | "polling" | "off" => {
  if (
    value === "webhook" ||
    value === "polling" ||
    value === "auto" ||
    value === "off"
  ) {
    return value;
  }
  return "auto";
};

const optionalClickhouseConfig = () => {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return undefined;

  const username = requiredEnv("CLICKHOUSE_USERNAME");
  const password = requiredEnv("CLICKHOUSE_PASSWORD");
  const retentionDays = Number(process.env.CLICKHOUSE_RETENTION_DAYS ?? "14");

  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("CLICKHOUSE_RETENTION_DAYS must be a positive integer");
  }

  return {
    url,
    username,
    password,
    retentionDays,
  };
};

const trading212Environment = (
  value: string | undefined,
): "live" | "demo" => {
  if (value === undefined || value === "live") return "live";
  if (value === "demo") return "demo";
  throw new Error("TRADING212_ENV must be live or demo");
};

const model = normalizeMastraModel(process.env.AI_MODEL ?? "xai/grok-4.3");
const xaiReasoningEffort = normalizeXaiReasoningEffort(
  process.env.XAI_REASONING_EFFORT ?? "medium",
);

export const env = {
  get postgresConnection() {
    return postgresConnection();
  },
  model,
  modelProviderOptions: modelProviderOptions(model, xaiReasoningEffort),
  ynab: {
    accessToken: process.env.YNAB_ACCESS_TOKEN,
    planId: process.env.YNAB_PLAN_ID ?? "last-used",
  },
  braveSearch: {
    apiKey: process.env.BRAVE_SEARCH_API_KEY,
  },
  trading212: {
    apiKeyId: process.env.TRADING212_API_KEY_ID,
    secretKey: process.env.TRADING212_SECRET_KEY,
    environment: trading212Environment(process.env.TRADING212_ENV),
  },
  telegramAdapterMode: telegramAdapterMode(process.env.TELEGRAM_ADAPTER_MODE),
  clickhouse: optionalClickhouseConfig(),
  mastraJwtSecret: process.env.MASTRA_JWT_SECRET,
  mastraStudioToken: process.env.MASTRA_STUDIO_TOKEN,
};
