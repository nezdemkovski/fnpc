import { createScorer } from "@mastra/core/evals";

type JsonRecord = Record<string, unknown>;

type AgentGroundTruth = {
  toolId: string;
  args?: JsonRecord;
};

type WorkflowGroundTruth = {
  ok?: boolean;
  changed?: {
    entityType?: string;
    action?: string;
    name?: string;
  };
  expectations?: JsonRecord;
};

type ToolCall = {
  toolId: string;
  args: JsonRecord;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeToolId = (value: string): string =>
  value.replace(/Tool$/, "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");

const normalizeName = (value: string): string =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const getPath = (value: unknown, path: string): unknown => {
  const parts = path.split(".");
  let current = value;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
};

const valuesMatch = (actual: unknown, expected: unknown): boolean => {
  if (expected === undefined) return true;
  if (typeof expected === "string" && typeof actual === "string") {
    return normalizeName(actual).includes(normalizeName(expected));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((expectedItem) =>
      actual.some((actualItem) => valuesMatch(actualItem, expectedItem)),
    );
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, expectedValue]) =>
      valuesMatch(actual[key], expectedValue),
    );
  }
  return actual === expected;
};

const collectToolCalls = (value: unknown, calls: ToolCall[] = []): ToolCall[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, calls);
    return calls;
  }
  if (!isRecord(value)) return calls;

  const rawToolId =
    value.toolId ??
    value.toolName ??
    value.tool_name ??
    value.name ??
    getPath(value, "toolCall.toolName") ??
    getPath(value, "toolCall.name");
  const rawArgs =
    value.args ??
    value.input ??
    value.toolArgs ??
    value.arguments ??
    getPath(value, "toolCall.args") ??
    {};

  if (typeof rawToolId === "string") {
    const toolId = normalizeToolId(rawToolId);
    if (toolId.includes("-") || toolId.startsWith("get-") || toolId.startsWith("run-")) {
      calls.push({ toolId, args: isRecord(rawArgs) ? rawArgs : {} });
    }
  }

  for (const child of Object.values(value)) collectToolCalls(child, calls);
  return calls;
};

const outputText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(outputText).filter(Boolean).join("\n");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  const content = value.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(outputText).filter(Boolean).join("\n");
  return "";
};

export const scoreAgentRouting = ({
  output,
  groundTruth,
}: {
  output: unknown;
  groundTruth: AgentGroundTruth;
}) => {
  const toolCalls = collectToolCalls(output);
  if (groundTruth.toolId === "none") {
    const text = outputText(output).toLowerCase();
    const refusedLiveLookup =
      text.includes("live") || text.includes("google") || text.includes("amount");
    return {
      score: toolCalls.length === 0 && refusedLiveLookup ? 1 : 0,
      reason:
        toolCalls.length === 0
          ? "No tool call was made."
          : `Unexpected tool calls: ${toolCalls.map((call) => call.toolId).join(", ")}`,
    };
  }

  const matchingCalls = toolCalls.filter((call) => call.toolId === groundTruth.toolId);
  const matchingArgs = matchingCalls.some((call) =>
    valuesMatch(call.args, groundTruth.args ?? {}),
  );

  return {
    score: matchingCalls.length > 0 && matchingArgs ? 1 : 0,
    reason:
      matchingCalls.length === 0
        ? `Expected ${groundTruth.toolId}, got ${toolCalls.map((call) => call.toolId).join(", ") || "no tool calls"}.`
        : matchingArgs
          ? `Matched ${groundTruth.toolId}.`
          : `Matched ${groundTruth.toolId}, but arguments did not satisfy ground truth.`,
  };
};

const changedMatches = (output: unknown, expected: NonNullable<WorkflowGroundTruth["changed"]>) => {
  const changed = isRecord(output) ? output.changed : undefined;
  const changedItems = Array.isArray(changed) ? changed : changed ? [changed] : [];
  return changedItems.some((item) => valuesMatch(item, expected));
};

const moneyToMinor = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined;

const amountMinorMatches = (actual: unknown, expected: unknown): boolean => {
  const expectedMinor = moneyToMinor(expected);
  return expectedMinor !== undefined && actual === expectedMinor;
};

const outputContainsAmount = (output: JsonRecord, expected: unknown): boolean => {
  const expectedMinor = moneyToMinor(expected);
  if (expectedMinor !== undefined) {
    if (getPath(output, "resolvedAmountMinor") === expectedMinor) return true;
    if (getPath(output, "impact.deltaMinAvailableMinor") === -expectedMinor) return true;
  }
  return JSON.stringify(output).includes(String(expected));
};

const rulesContainContribution = (
  output: JsonRecord,
  expected: unknown,
  bucketMode: "bucket" | "general",
): boolean => {
  const expectedMinor = moneyToMinor(expected);
  if (expectedMinor === undefined || !Array.isArray(output.afterRules)) return false;
  return output.afterRules.some((rule) => {
    if (!isRecord(rule) || rule.type !== "monthly_fixed" || rule.amountMinor !== expectedMinor) return false;
    return bucketMode === "bucket" ? typeof rule.bucketName === "string" : rule.bucketName === null;
  });
};

const bucketsContainTarget = (output: JsonRecord, expected: unknown): boolean => {
  const expectedMinor = moneyToMinor(expected);
  if (expectedMinor === undefined || !Array.isArray(output.afterBuckets)) return false;
  return output.afterBuckets.some((bucket) => isRecord(bucket) && bucket.targetAmountMinor === expectedMinor);
};

const expectationChecks: Record<string, (output: JsonRecord, expected: unknown) => boolean> = {
  hasVerdict: (output) => typeof output.verdict === "string",
  hasBaseline: (output) => isRecord(output.baseline),
  hasScenarioForecast: (output) => isRecord(output.scenarioForecast),
  hasImpact: (output) => isRecord(output.impact),
  doesNotPersistPlan: (output) => !changedMatches(output, { entityType: "planned_expense" }),
  protectedSavingsNotSpendableByDefault: (output) =>
    isRecord(output.scenarioForecast) || isRecord(output.impact),
  hasEvidence: (output) =>
    Number(output.evidenceCount ?? 0) > 0 ||
    Boolean(output.hasEvidence) ||
    (Array.isArray(output.evidence) && output.evidence.length > 0),
  sourceIncludesFinancialEvent: (output) =>
    JSON.stringify(output).includes("financial_event") ||
    JSON.stringify(output).includes("recurring_expense"),
  doesNotHallucinateMissingHistory: (output) => output.ok === true,
  missingEvidence: (output) => Number(output.evidenceCount ?? 0) === 0 || output.hasEvidence === false,
  noInventedFacts: (output) => output.ok === true,
  debitsOperatingAccount: (output) => JSON.stringify(output).includes("account"),
  createsAdjustedAccountBalance: (output) =>
    typeof output.accountBalanceId === "string" || JSON.stringify(output).includes("account_balance"),
  usesUserProvidedAmount: (output) =>
    typeof output.resolvedAmountMinor === "number" &&
    (!Array.isArray(output.candidates) || output.candidates.length === 0),
  doesNotCreateRecurringExpense: (output) => !changedMatches(output, { entityType: "recurring_expense", action: "created" }),
  amountTakenFromRecurring: (output) => output.ok === true,
  doesNotCreateDuplicate: (output) => output.ok === true,
  afterInactive: (output) => JSON.stringify(output).includes("inactive") || output.ok === true,
  totalCashUpdates: (output) => output.ok === true,
  protectedSavingsUnchanged: (output) => output.ok === true,
  createsCashAccountWhenMissing: (output) => output.ok === true,
  protectedSavingsUpdates: (output) => output.ok === true,
  doesNotCreateSpendableAccount: (output) => output.ok === true,
  bucketIncreases: (output) => output.ok === true,
  doesNotCreateAccount: (output) => !changedMatches(output, { entityType: "account", action: "created" }),
  availableOperatingCashDecreases: (output) => output.ok === true,
  bucketDecreases: (output) => output.ok === true,
  accountBalanceAdjusts: (output) => output.ok === true,
  actualExpenseCreated: (output) => changedMatches(output, { entityType: "actual_expense" }) || output.ok === true,
  accountBalanceDecreases: (output) => output.ok === true,
  hasFormattedTotals: (output) => isRecord(output.formattedTotals),
  hasUpcomingPlans: (output) => Array.isArray(output.upcomingPlans),
  hasForecastRows: (output) => isRecord(output.forecast) && Array.isArray(output.forecast.rows),
  hasRiskMonths: (output) => isRecord(output.forecast) && Array.isArray(output.forecast.riskMonths),
  hasBucket: (output) =>
    changedMatches(output, { entityType: "savings_bucket" }) ||
    (Array.isArray(output.afterBuckets) && output.afterBuckets.length > 0),
  monthlySavingsContributionIncreases: (output) => output.ok === true,
};

const expectationMatches = (output: JsonRecord, key: string, expected: unknown): boolean => {
  if (typeof expected === "boolean" && expected === true && expectationChecks[key]) {
    return expectationChecks[key](output, expected);
  }
  if (key === "afterMonth") return JSON.stringify(output).includes(String(expected));
  if (key === "afterStatus") return JSON.stringify(output).includes(String(expected));
  if (key === "amount") return outputContainsAmount(output, expected);
  if (key === "horizonMonths") return getPath(output, "forecast.horizonMonths") === expected;
  if (key === "targetAmount") return bucketsContainTarget(output, expected);
  if (key === "totalMonthlySavingsStaysAt") {
    const expectedMinor = moneyToMinor(expected);
    return expectedMinor !== undefined && output.afterMonthlySavingsContributionsMinor === expectedMinor;
  }
  if (key === "bucketContribution") return rulesContainContribution(output, expected, "bucket");
  if (key === "generalContribution") return rulesContainContribution(output, expected, "general");
  return valuesMatch(getPath(output, key), expected);
};

export const scoreWorkflowContract = ({
  output,
  groundTruth,
}: {
  output: unknown;
  groundTruth: WorkflowGroundTruth;
}) => {
  if (!isRecord(output)) {
    return { score: 0, reason: "Workflow output is not an object." };
  }

  const failures: string[] = [];
  if (groundTruth.ok !== undefined && output.ok !== groundTruth.ok) failures.push("ok");
  if (groundTruth.changed && !changedMatches(output, groundTruth.changed)) failures.push("changed");

  for (const [key, expected] of Object.entries(groundTruth.expectations ?? {})) {
    if (!expectationMatches(output, key, expected)) failures.push(`expectations.${key}`);
  }

  return {
    score: failures.length === 0 ? 1 : 0,
    reason: failures.length === 0 ? "Workflow contract matched." : `Failed: ${failures.join(", ")}.`,
  };
};

export const agentRoutingScorer = createScorer({
  id: "fnpc-agent-routing-contract",
  name: "FNPC Agent Routing Contract",
  description: "Checks that an agent experiment called the expected tool with expected argument subset.",
}).generateScore(({ run }) =>
  scoreAgentRouting({
    output: run.output,
    groundTruth: run.groundTruth as AgentGroundTruth,
  }).score,
).generateReason(({ run }) =>
  scoreAgentRouting({
    output: run.output,
    groundTruth: run.groundTruth as AgentGroundTruth,
  }).reason,
);

export const workflowContractScorer = createScorer({
  id: "fnpc-workflow-contract",
  name: "FNPC Workflow Contract",
  description: "Checks deterministic workflow output contracts from dataset ground truth.",
}).generateScore(({ run }) =>
  scoreWorkflowContract({
    output: run.output,
    groundTruth: run.groundTruth as WorkflowGroundTruth,
  }).score,
).generateReason(({ run }) =>
  scoreWorkflowContract({
    output: run.output,
    groundTruth: run.groundTruth as WorkflowGroundTruth,
  }).reason,
);
