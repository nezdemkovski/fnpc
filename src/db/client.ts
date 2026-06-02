import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env";
import * as schema from "./schema";

export const db = drizzle({ connection: env.postgresConnection, schema });

export type Database = typeof db;
