import { eq } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { profiles, type FinancialPolicy } from "../db/schema";

export type ProfileIdentity = {
  mastraResourceId: string;
  telegramUserId?: string;
  displayName?: string;
};

export type ProfilePatch = {
  preferredName?: string;
  responseLanguage?: string;
  timezone?: string;
  financialPolicy?: FinancialPolicy;
};

export const getOrCreateProfile = async (
  identity: ProfileIdentity,
  database: Database = db,
) => {
  const [existing] = await database
    .select()
    .from(profiles)
    .where(eq(profiles.mastraResourceId, identity.mastraResourceId))
    .limit(1);
  if (existing) return existing;

  const [created] = await database
    .insert(profiles)
    .values({
      mastraResourceId: identity.mastraResourceId,
      telegramUserId: identity.telegramUserId,
      displayName: identity.displayName,
    })
    .returning();

  return created;
};

export const updateProfile = async ({
  identity,
  patch,
  database = db,
}: {
  identity: ProfileIdentity;
  patch: ProfilePatch;
  database?: Database;
}) => {
  const profile = await getOrCreateProfile(identity, database);
  const [updated] = await database
    .update(profiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(profiles.id, profile.id))
    .returning();

  return updated;
};
