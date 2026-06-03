import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { postgresConnection } from "../src/db/connection";

const pool = new pg.Pool(postgresConnection());

try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("Database migrations completed");
} finally {
  await pool.end();
}
