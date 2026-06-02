const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

const postgresConnection = () => {
  const explicitUrl = optionalEnv("DATABASE_URL");
  if (explicitUrl) return { connectionString: explicitUrl };

  return {
    user: requiredEnv("POSTGRES_USERNAME"),
    password: requiredEnv("POSTGRES_PASSWORD"),
    host: requiredEnv("POSTGRES_HOST"),
    port: Number(optionalEnv("POSTGRES_PORT") ?? "5432"),
    database: requiredEnv("POSTGRES_DATABASE"),
  };
};

const normalizeMastraModel = (model: string): string => {
  if (model.includes("/")) return model;
  return `anthropic/${model}`;
};

const telegramAdapterMode = (value: string | undefined): "auto" | "webhook" | "polling" | "off" => {
  if (value === "webhook" || value === "polling" || value === "auto" || value === "off") return value;
  return "auto";
};

const optionalClickhouseConfig = () => {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return undefined;

  const username = requiredEnv("CLICKHOUSE_USERNAME");
  const password = requiredEnv("CLICKHOUSE_PASSWORD");

  return {
    url,
    username,
    password,
  };
};

const optionalStudioAuthConfig = () => {
  const baseUrl = process.env.AUTH_BASE_URL;
  if (!baseUrl) return undefined;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    jwksUrl: requiredEnv("AUTH_JWKS_URL"),
    issuer: requiredEnv("AUTH_JWT_ISSUER"),
    audience: requiredEnv("AUTH_JWT_AUDIENCE"),
    sessionSecret: requiredEnv("AUTH_SESSION_SECRET"),
  };
};

export const env = {
  postgresConnection: postgresConnection(),
  model: normalizeMastraModel(process.env.AI_MODEL ?? "claude-sonnet-4-5"),
  telegramAdapterMode: telegramAdapterMode(process.env.TELEGRAM_ADAPTER_MODE),
  clickhouse: optionalClickhouseConfig(),
  studioAuth: optionalStudioAuthConfig(),
};
