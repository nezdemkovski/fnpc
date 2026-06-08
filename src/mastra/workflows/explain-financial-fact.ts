import { desc, ilike, sql } from "drizzle-orm";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { db } from "../../db/client";
import { financialEvents } from "../../db/schema";
import { getOrCreateUser } from "../../finance/profile-service";

const explainFinancialFactInputSchema = z.object({
  mastraResourceId: z.string(),
  query: z.string().optional(),
  entityName: z.string().optional(),
  entityType: z.string().optional(),
  amount: z.number().optional(),
  sourceMessageId: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

type ExplainFinancialFactInput = z.infer<typeof explainFinancialFactInputSchema>;

const evidenceSchema = z.object({
  source: z.enum(["financial_event", "mastra_message", "workflow_snapshot"]),
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  createdAt: z.string().nullable(),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const explainFinancialFactStateSchema = z.object({
  ok: z.boolean(),
  mastraResourceId: z.string(),
  userId: z.string().optional(),
  searchTerms: z.array(z.string()).default([]),
  evidence: z.array(evidenceSchema).default([]),
  message: z.string().optional(),
});

const explainFinancialFactOutputSchema = explainFinancialFactStateSchema.extend({
  missingEvidence: z.boolean(),
});

type Evidence = z.infer<typeof evidenceSchema>;

type MastraMessageRow = {
  id: string;
  role: string | null;
  type: string | null;
  content: unknown;
  created_at: Date | string | null;
};

type WorkflowSnapshotRow = {
  id: string;
  workflow_name: string | null;
  snapshot: unknown;
  created_at: Date | string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const safeJson = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const compact = (value: unknown, maxLength = 360): string => {
  const text = safeJson(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
};

const createdAtString = (value: Date | string | null | undefined) =>
  value instanceof Date ? value.toISOString() : value ?? null;

const searchTermsFor = (input: ExplainFinancialFactInput) => {
  const values = [input.query, input.entityName, input.sourceMessageId, input.amount?.toString()]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  return [...new Set(values)];
};

const likeFor = (term: string) => `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

const scoreText = (text: string, terms: string[]) => {
  const normalized = text.toLowerCase();
  return terms.reduce(
    (score, term) => score + (normalized.includes(term.toLowerCase()) ? 1 : 0),
    0,
  );
};

const rankEvidence = (evidence: Evidence[], terms: string[], limit: number) =>
  evidence
    .map((item) => ({
      ...item,
      score: item.score + scoreText(`${item.title} ${item.summary}`, terms),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

const tableExists = async (tableName: string) => {
  const result = await db.execute<{ exists: string | null }>(
    sql`select to_regclass(${tableName}) as exists`,
  );
  const rows = result.rows as Array<{ exists: string | null }>;
  return rows.some((row) => row.exists);
};

const searchMastraMessages = async ({
  mastraResourceId,
  terms,
  limit,
}: {
  mastraResourceId: string;
  terms: string[];
  limit: number;
}): Promise<Evidence[]> => {
  if (terms.length === 0 || !(await tableExists("public.mastra_messages"))) return [];

  const likeTerms = terms.map(likeFor);
  const result = await db.execute<MastraMessageRow>(
    sql`
      select
        id::text,
        role::text,
        type::text,
        content,
        "createdAt" as created_at
      from mastra_messages
      where "resourceId" = ${mastraResourceId}
        and (${sql.join(likeTerms.map((term) => sql`content::text ilike ${term}`), sql` or `)})
      order by "createdAt" desc
      limit ${limit}
    `,
  );

  const rows = result.rows as MastraMessageRow[];

  return rows.map((row) => ({
    source: "mastra_message" as const,
    id: row.id,
    title: `Mastra ${row.role ?? row.type ?? "message"}`,
    summary: compact(row.content),
    createdAt: createdAtString(row.created_at),
    score: 1,
    metadata: {
      role: row.role,
      type: row.type,
    },
  }));
};

const searchWorkflowSnapshots = async ({
  mastraResourceId,
  terms,
  limit,
}: {
  mastraResourceId: string;
  terms: string[];
  limit: number;
}): Promise<Evidence[]> => {
  if (terms.length === 0 || !(await tableExists("public.mastra_workflow_snapshot"))) return [];

  const likeTerms = terms.map(likeFor);
  const result = await db.execute<WorkflowSnapshotRow>(
    sql`
      select
        run_id::text as id,
        workflow_name::text,
        snapshot,
        "createdAt" as created_at
      from mastra_workflow_snapshot
      where "resourceId" = ${mastraResourceId}
        and coalesce(workflow_name::text, '') != 'explain-financial-fact'
        and (${sql.join(likeTerms.map((term) => sql`snapshot::text ilike ${term}`), sql` or `)})
      order by "createdAt" desc
      limit ${limit}
    `,
  );

  const rows = result.rows as WorkflowSnapshotRow[];

  return rows.map((row) => ({
    source: "workflow_snapshot" as const,
    id: row.id,
    title: row.workflow_name ?? "Mastra workflow",
    summary: compact(row.snapshot),
    createdAt: createdAtString(row.created_at),
    score: 1,
  }));
};

const loadExplainProfileStep = createStep({
  id: "load-explain-profile",
  description: "Loads the user profile before searching financial provenance.",
  inputSchema: explainFinancialFactInputSchema,
  outputSchema: explainFinancialFactStateSchema,
  execute: async ({ inputData }) => {
    const user = await getOrCreateUser({ mastraResourceId: inputData.mastraResourceId });
    const searchTerms = searchTermsFor(inputData);

    if (searchTerms.length === 0) {
      return {
        ok: false,
        mastraResourceId: inputData.mastraResourceId,
        userId: user.id,
        searchTerms,
        evidence: [],
        message: "No query, entity name, amount, or source message id was provided.",
      };
    }

    return {
      ok: true,
      mastraResourceId: inputData.mastraResourceId,
      userId: user.id,
      searchTerms,
      evidence: [],
    };
  },
});

const searchFinancialEventsStep = createStep({
  id: "search-financial-events",
  description: "Searches durable financial event provenance for matching facts.",
  inputSchema: explainFinancialFactStateSchema,
  outputSchema: explainFinancialFactStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok || !inputData.userId) return inputData;

    const initial = getInitData<ExplainFinancialFactInput>();
    const limit = initial.limit ?? 8;
    const likeTerms = inputData.searchTerms.map(likeFor);
    const amountMinor =
      typeof initial.amount === "number" ? Math.round(initial.amount * 100) : undefined;

    const rows = await db
      .select({
        id: financialEvents.id,
        entityType: financialEvents.entityType,
        entityId: financialEvents.entityId,
        eventType: financialEvents.eventType,
        before: financialEvents.before,
        after: financialEvents.after,
        reason: financialEvents.reason,
        sourceMessageId: financialEvents.sourceMessageId,
        createdAt: financialEvents.createdAt,
      })
      .from(financialEvents)
      .where(
        sql`${financialEvents.userId} = ${inputData.userId}
          and (${sql.join(
            [
              initial.entityType ? sql`${financialEvents.entityType}::text = ${initial.entityType}` : undefined,
              initial.sourceMessageId
                ? sql`${financialEvents.sourceMessageId} = ${initial.sourceMessageId}`
                : undefined,
              amountMinor !== undefined
                ? sql`${financialEvents.before}::text ilike ${likeFor(amountMinor.toString())}
                    or ${financialEvents.after}::text ilike ${likeFor(amountMinor.toString())}`
                : undefined,
              ...likeTerms.flatMap((term) => [
                ilike(financialEvents.reason, term),
                sql`${financialEvents.before}::text ilike ${term}`,
                sql`${financialEvents.after}::text ilike ${term}`,
                ilike(financialEvents.sourceMessageId, term),
              ]),
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition)),
            sql` or `,
          )})`,
      )
      .orderBy(desc(financialEvents.createdAt))
      .limit(limit);

    const evidence: Evidence[] = rows.map((row) => {
      const after = asRecord(row.after);
      const name = typeof after.name === "string" ? after.name : row.entityType;
      return {
        source: "financial_event" as const,
        id: row.id,
        title: `${row.entityType}.${row.eventType}: ${name}`,
        summary: compact({
          before: row.before,
          after: row.after,
          reason: row.reason,
          sourceMessageId: row.sourceMessageId,
        }),
        createdAt: row.createdAt.toISOString(),
        score: 2,
        metadata: {
          entityType: row.entityType,
          entityId: row.entityId,
          eventType: row.eventType,
          sourceMessageId: row.sourceMessageId,
        },
      };
    });

    return {
      ...inputData,
      evidence: rankEvidence([...inputData.evidence, ...evidence], inputData.searchTerms, limit),
    };
  },
});

const searchMastraHistoryStep = createStep({
  id: "search-mastra-history",
  description: "Searches Mastra message history and workflow snapshots for matching context.",
  inputSchema: explainFinancialFactStateSchema,
  outputSchema: explainFinancialFactOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) {
      return {
        ...inputData,
        missingEvidence: true,
      };
    }

    const initial = getInitData<ExplainFinancialFactInput>();
    const limit = initial.limit ?? 8;
    const [messages, snapshots] = await Promise.all([
      searchMastraMessages({
        mastraResourceId: inputData.mastraResourceId,
        terms: inputData.searchTerms,
        limit,
      }),
      searchWorkflowSnapshots({
        mastraResourceId: inputData.mastraResourceId,
        terms: inputData.searchTerms,
        limit,
      }),
    ]);
    const evidence = rankEvidence(
      [...inputData.evidence, ...messages, ...snapshots],
      inputData.searchTerms,
      limit,
    );

    return {
      ...inputData,
      evidence,
      missingEvidence: evidence.length === 0,
      message:
        evidence.length === 0
          ? "No matching saved events, messages, or workflow snapshots were found."
          : undefined,
    };
  },
});

export const explainFinancialFact = createWorkflow({
  id: "explain-financial-fact",
  inputSchema: explainFinancialFactInputSchema,
  outputSchema: explainFinancialFactOutputSchema,
})
  .then(loadExplainProfileStep)
  .then(searchFinancialEventsStep)
  .then(searchMastraHistoryStep)
  .commit();
