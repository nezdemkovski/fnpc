import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

const {
  buildRuntimeContextMessage,
  getRuntimeProfile,
  missingRuntimeFields,
} = await import("./runtime-profile");

const profile = {
  id: "profile-1",
  mastraResourceId: "telegram:user-1",
  preferredName: "Yuri",
  responseLanguage: "ru",
  timezone: "Europe/Prague",
  createdAt: new Date("2026-07-17T09:00:00.000Z"),
  updatedAt: new Date("2026-07-17T09:00:00.000Z"),
};

describe("runtime profile", () => {
  test("loads only durable local context", async () => {
    let reads = 0;
    const result = await getRuntimeProfile("telegram:user-1", {
      getOrCreateProfile: async () => {
        reads += 1;
        return profile;
      },
    });

    expect(reads).toBe(1);
    expect(result).toEqual({
      resourceId: "telegram:user-1",
      preferredName: "Yuri",
      responseLanguage: "ru",
      timezone: "Europe/Prague",
    });
    expect(missingRuntimeFields(result)).toEqual([]);
  });

  test("explicitly requires endpoint tools for financial facts", async () => {
    const result = await getRuntimeProfile("telegram:user-1", {
      getOrCreateProfile: async () => profile,
    });
    const context = buildRuntimeContextMessage(result);

    expect(context).toContain("no current YNAB data is preloaded");
    expect(context).toContain(
      "Conversation and long-term memory are never financial sources of truth",
    );
  });
});
