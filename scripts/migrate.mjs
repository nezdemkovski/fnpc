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

const databaseUrl =
  optionalEnv("DATABASE_URL") ??
  `postgresql://${encodeURIComponent(requiredEnv("POSTGRES_USERNAME"))}:${encodeURIComponent(
    requiredEnv("POSTGRES_PASSWORD"),
  )}@${requiredEnv("POSTGRES_HOST")}:${optionalEnv("POSTGRES_PORT") ?? "5432"}/${encodeURIComponent(
    requiredEnv("POSTGRES_DATABASE"),
  )}`;

if (!databaseUrl) {
  throw new Error("Database connection settings are required to run database migrations");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations completed");
} finally {
  await pool.end();
}
