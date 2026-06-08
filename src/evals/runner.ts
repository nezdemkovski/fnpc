import type { Mastra } from "@mastra/core";
import type { MastraScorer } from "@mastra/core/evals";
import type { ExperimentSummary } from "@mastra/core/datasets";
import { evalDatasetDefinitions, type EvalDatasetDefinition } from "./datasets";
import {
  agentResourceIdFromMetadata,
  cleanupAgentEvalFixtures,
  cleanupWorkflowEvalFixtures,
  resetAgentEvalFixtures,
  resetWorkflowEvalFixtures,
} from "./fixtures";

export type EvalTargetKind = "agent" | "workflow";

export type RunEvalDatasetsOptions = {
  targetKind: EvalTargetKind | "all";
  maxConcurrency?: number;
};

export type EvalExperimentResult = {
  datasetName: string;
  targetType: EvalTargetKind;
  targetId: string;
  summary: ExperimentSummary;
};

const runnableDefinitions = (targetKind: RunEvalDatasetsOptions["targetKind"]): EvalDatasetDefinition[] =>
  evalDatasetDefinitions.filter((definition) => {
    if (!definition.targetType || !definition.targetIds?.[0]) return false;
    return targetKind === "all" || definition.targetType === targetKind;
  });

const experimentName = (definition: EvalDatasetDefinition): string =>
  `${definition.name}-${new Date().toISOString()}`;

const scorersForDefinition = (
  mastra: Mastra,
  definition: EvalDatasetDefinition,
): MastraScorer<any, any, any, any>[] =>
  definition.scorerIds.map((scorerId) => mastra.getScorerById(scorerId as never));

export const runEvalDatasets = async (
  mastra: Mastra,
  options: RunEvalDatasetsOptions,
): Promise<EvalExperimentResult[]> => {
  const definitions = runnableDefinitions(options.targetKind);
  const agentDefinitions = definitions.filter((definition) => definition.targetType === "agent");
  const workflowDefinitions = definitions.filter((definition) => definition.targetType === "workflow");
  const agentFixtureResourceIds = await resetAgentEvalFixtures(agentDefinitions);
  const fixtureResourceIds = await resetWorkflowEvalFixtures(workflowDefinitions);

  try {
    const listedDatasets = await mastra.datasets.list({ page: 0, perPage: 100 });
    const datasetByName = new Map(listedDatasets.datasets.map((dataset) => [dataset.name, dataset]));
    const results: EvalExperimentResult[] = [];

    for (const definition of definitions) {
      const listedDataset = datasetByName.get(definition.name);
      const targetType = definition.targetType;
      const targetId = definition.targetIds?.[0];

      if (!listedDataset || !targetType || !targetId) continue;

      const dataset = await mastra.datasets.get({ id: listedDataset.id });
      const name = experimentName(definition);
      const summary =
        targetType === "agent"
          ? await dataset.startExperiment({
              name,
              task: async ({ input, metadata }) => {
                const agent = mastra.getAgent("financialAgent");
                const memory = await agent.getMemory();
                const resourceId =
                  agentResourceIdFromMetadata(metadata) ?? `eval:agent:${definition.name}`;
                const threadId = `${resourceId}:${name}`;
                await memory?.createThread({ threadId, resourceId, title: String(input) }).catch(() => undefined);
                const result = await agent.generate(String(input), {
                  memory: { thread: threadId, resource: resourceId },
                });
                return {
                  text: result.text,
                  steps: result.steps?.map((step) => ({
                    toolCalls: step.toolCalls,
                    toolResults: step.toolResults,
                  })),
                };
              },
              scorers: scorersForDefinition(mastra, definition),
              maxConcurrency: options.maxConcurrency ?? 1,
              itemTimeout: 90_000,
              maxRetries: 0,
              metadata: {
                datasetName: definition.name,
                expectedScorers: definition.scorerIds,
              },
            })
          : await dataset.startExperiment({
              name,
              targetType,
              targetId,
              scorers: scorersForDefinition(mastra, definition),
              maxConcurrency: options.maxConcurrency ?? 1,
              itemTimeout: 30_000,
              maxRetries: 0,
              metadata: {
                datasetName: definition.name,
                expectedScorers: definition.scorerIds,
              },
            });

      results.push({ datasetName: definition.name, targetType, targetId, summary });
    }

    return results;
  } finally {
    await cleanupWorkflowEvalFixtures(fixtureResourceIds);
    await cleanupAgentEvalFixtures(agentFixtureResourceIds);
  }
};
