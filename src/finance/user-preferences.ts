import { eq } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { financialEvents, userPreferences, users } from "../db/schema";
import { normalizeCurrency } from "./dates";
import { getOrCreateUser, type UserIdentity } from "./profile-service";

export type UserPreferencesPatch = {
  preferredName?: string;
  responseLanguage?: string;
  defaultCurrency?: string;
  timezone?: string;
};

export type UserProfileResult = Awaited<ReturnType<typeof getUserProfile>>;

export const getUserProfile = async (userId: string, database: Database = db) => {
  const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`Financial user not found: ${userId}`);

  const [preferences] = await database
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return {
    user,
    preferences: preferences ?? {
      id: null,
      userId,
      preferredName: null,
      responseLanguage: null,
      createdAt: null,
      updatedAt: null,
    },
  };
};

export const updateUserPreferences = async ({
  identity,
  patch,
  sourceMessageId,
  database = db,
}: {
  identity: UserIdentity;
  patch: UserPreferencesPatch;
  sourceMessageId?: string;
  database?: Database;
}) => {
  const user = await getOrCreateUser(identity, database);
  const before = await getUserProfile(user.id, database);

  const userValues: Partial<typeof users.$inferInsert> = {};
  if (patch.preferredName !== undefined) userValues.displayName = patch.preferredName;
  if (patch.defaultCurrency !== undefined) userValues.defaultCurrency = normalizeCurrency(patch.defaultCurrency);
  if (patch.timezone !== undefined) userValues.timezone = patch.timezone;

  let updatedUser = user;
  if (Object.keys(userValues).length > 0) {
    const [updated] = await database
      .update(users)
      .set({ ...userValues, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    updatedUser = updated;
  }

  const [existingPreferences] = await database
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1);

  const preferenceValues = {
    userId: user.id,
    preferredName: patch.preferredName,
    responseLanguage: patch.responseLanguage,
    updatedAt: new Date(),
  };

  const compactPreferenceValues = Object.fromEntries(
    Object.entries(preferenceValues).filter(([, value]) => value !== undefined),
  );

  const [updatedPreferences] = existingPreferences
    ? await database
        .update(userPreferences)
        .set(compactPreferenceValues)
        .where(eq(userPreferences.id, existingPreferences.id))
        .returning()
    : await database
        .insert(userPreferences)
        .values({
          userId: user.id,
          preferredName: patch.preferredName,
          responseLanguage: patch.responseLanguage,
        })
        .returning();

  const after = {
    user: updatedUser,
    preferences: updatedPreferences,
  };

  await database.insert(financialEvents).values({
    userId: user.id,
    entityType: "user_preferences",
    entityId: updatedPreferences.id,
    eventType: existingPreferences ? "updated" : "created",
    before,
    after,
    sourceMessageId,
  });

  return after;
};
