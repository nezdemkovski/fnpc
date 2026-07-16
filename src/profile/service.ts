import { eq } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { profiles } from "../db/schema";

type ProfilePatch = {
  preferredName?: string;
  responseLanguage?: string;
  timezone?: string;
};

export const getOrCreateProfile = async (
  mastraResourceId: string,
  database: Database = db,
) => {
  const [existing] = await database
    .select()
    .from(profiles)
    .where(eq(profiles.mastraResourceId, mastraResourceId))
    .limit(1);
  if (existing) return existing;

  const [created] = await database
    .insert(profiles)
    .values({ mastraResourceId })
    .returning();

  return created;
};

export const updateProfile = async ({
  mastraResourceId,
  patch,
  database = db,
}: {
  mastraResourceId: string;
  patch: ProfilePatch;
  database?: Database;
}) => {
  const profile = await getOrCreateProfile(mastraResourceId, database);
  const [updated] = await database
    .update(profiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(profiles.id, profile.id))
    .returning();

  return updated;
};
