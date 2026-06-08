import { describe, expect, test } from "bun:test";
import { scoreAgentRouting, scoreWorkflowContract } from "./scorers";

describe("eval scorers", () => {
  test("scores agent tool routing with argument subset", () => {
    const result = scoreAgentRouting({
      output: {
        toolInvocations: [
          {
            toolName: "mutate-planned-expense",
            args: { action: "move", name: "office chair", plannedFor: "2026-08" },
          },
        ],
      },
      groundTruth: {
        toolId: "mutate-planned-expense",
        args: { action: "move", plannedFor: "2026-08" },
      },
    });

    expect(result.score).toBe(1);
  });

  test("fails agent routing when tool is wrong", () => {
    const result = scoreAgentRouting({
      output: {
        toolInvocations: [{ toolName: "get-financial-snapshot", args: {} }],
      },
      groundTruth: {
        toolId: "evaluate-purchase",
        args: { amount: 12000 },
      },
    });

    expect(result.score).toBe(0);
  });

  test("scores agent text expectations and forbidden tools", () => {
    const result = scoreAgentRouting({
      output: {
        text: "I cannot find evidence for that saved plan, so I will not invent it.",
        steps: [
          {
            toolCalls: [
              {
                toolName: "explainFinancialFactTool",
                args: { query: "unknown plan" },
              },
            ],
          },
        ],
      },
      groundTruth: {
        toolId: "explain-financial-fact",
        args: { query: "unknown plan" },
        forbiddenToolIds: ["mutate-planned-expense"],
        answer: {
          includes: ["cannot find evidence"],
          excludes: ["saved it"],
        },
      },
    });

    expect(result.score).toBe(1);
  });

  test("fails agent text expectations when answer hallucinates persistence", () => {
    const result = scoreAgentRouting({
      output: {
        text: "I saved it as planned.",
        steps: [
          {
            toolCalls: [
              {
                toolName: "explainFinancialFactTool",
                args: { query: "unknown plan" },
              },
            ],
          },
        ],
      },
      groundTruth: {
        toolId: "explain-financial-fact",
        args: { query: "unknown plan" },
        forbiddenToolIds: ["mutate-planned-expense"],
        answer: {
          includes: ["cannot find evidence"],
          excludes: ["saved it"],
        },
      },
    });

    expect(result.score).toBe(0);
  });

  test("scores workflow contracts with changed arrays and expectations", () => {
    const result = scoreWorkflowContract({
      output: {
        ok: true,
        changed: [
          { entityType: "planned_expense", action: "moved", name: "language course" },
        ],
        forecast: { rows: [], horizonMonths: 3, riskMonths: [] },
      },
      groundTruth: {
        ok: true,
        changed: {
          entityType: "planned_expense",
          action: "moved",
          name: "language course",
        },
        expectations: { hasForecastRows: true },
      },
    });

    expect(result.score).toBe(1);
  });

  test("fails workflow contracts when required changed item is missing", () => {
    const result = scoreWorkflowContract({
      output: { ok: true, changed: [] },
      groundTruth: {
        ok: true,
        changed: { entityType: "actual_expense", action: "created" },
      },
    });

    expect(result.score).toBe(0);
  });

  test("fails workflow contracts when savings buckets are duplicated", () => {
    const result = scoreWorkflowContract({
      output: {
        ok: true,
        afterBuckets: [{ name: "Car" }, { name: "car" }],
      },
      groundTruth: {
        ok: true,
        expectations: { noDuplicateBucketNames: true },
      },
    });

    expect(result.score).toBe(0);
  });
});
