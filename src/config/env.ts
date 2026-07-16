import { postgresConnection } from "../db/connection";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const normalizeMastraModel = (model: string): string => {
  if (model.includes("/")) return model;
  return `anthropic/${model}`;
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

const optionalAuthConfig = () => {
  const url = process.env.AUTH_URL;
  const realm = process.env.AUTH_REALM;
  const sessionSecret = process.env.AUTH_SESSION_SECRET;

  if (!url && !realm && !sessionSecret) return undefined;
  if (!url) throw new Error("AUTH_URL is required when auth is configured");
  if (!realm) throw new Error("AUTH_REALM is required when auth is configured");
  if (!sessionSecret) {
    throw new Error("AUTH_SESSION_SECRET is required when auth is configured");
  }

  return {
    url: url.replace(/\/+$/, ""),
    realm,
    sessionSecret,
  };
};

export const env = {
  get postgresConnection() {
    return postgresConnection();
  },
  model: normalizeMastraModel(process.env.AI_MODEL ?? "claude-opus-4-7"),
  ynab: {
    accessToken: process.env.YNAB_ACCESS_TOKEN,
    planId: process.env.YNAB_PLAN_ID ?? "last-used",
  },
  telegramAdapterMode: telegramAdapterMode(process.env.TELEGRAM_ADAPTER_MODE),
  clickhouse: optionalClickhouseConfig(),
  auth: optionalAuthConfig(),
};
