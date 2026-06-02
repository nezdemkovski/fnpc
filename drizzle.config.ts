import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://fnpc:fnpc@localhost:5432/fnpc",
  },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
