import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env";
import * as schema from "./schema";

export const db = drizzle(env.databaseUrl, { schema });

export type Database = typeof db;
