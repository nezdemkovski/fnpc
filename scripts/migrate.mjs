import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optionalEnv = (name) => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

const connectionString = optionalEnv("DATABASE_URL");
const connectionConfig = connectionString
  ? { connectionString }
  : {
      user: requiredEnv("POSTGRES_USERNAME"),
      password: requiredEnv("POSTGRES_PASSWORD"),
      host: requiredEnv("POSTGRES_HOST"),
      port: Number(optionalEnv("POSTGRES_PORT") ?? "5432"),
      database: requiredEnv("POSTGRES_DATABASE"),
    };

if ("connectionString" in connectionConfig) {
  const url = new URL(connectionConfig.connectionString);
  console.log(`Running database migrations using DATABASE_URL host=${url.hostname} port=${url.port || "5432"}`);
} else {
  console.log(
    `Running database migrations using POSTGRES_* host=${connectionConfig.host} port=${connectionConfig.port} database=${connectionConfig.database}`,
  );
}

const pool = new pg.Pool(connectionConfig);
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations completed");
} finally {
  await pool.end();
}
