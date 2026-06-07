import { eq } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { users } from "../db/schema";
export {
  getFinancialSnapshot,
  type FinancialSnapshot,
} from "./snapshot";
export {
  runForecast,
  type ForecastResult,
  type ForecastRow,
  type ForecastScenarioExpense,
} from "./forecast";

export type UserIdentity = {
  mastraResourceId: string;
  telegramUserId?: string;
  displayName?: string;
};

export const getOrCreateUser = async (
  identity: UserIdentity,
  database: Database = db,
) => {
  const [existing] = await database
    .select()
    .from(users)
    .where(eq(users.mastraResourceId, identity.mastraResourceId))
    .limit(1);
  if (existing) return existing;

  const [created] = await database
    .insert(users)
    .values({
      mastraResourceId: identity.mastraResourceId,
      telegramUserId: identity.telegramUserId,
      displayName: identity.displayName,
    })
    .returning();

  return created;
};
