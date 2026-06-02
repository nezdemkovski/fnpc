import type { Mastra } from "@mastra/core";
import type { ExperimentSummary } from "@mastra/core/datasets";
import { evalDatasetDefinitions, type EvalDatasetDefinition } from "./datasets";
import { cleanupWorkflowEvalFixtures, resetWorkflowEvalFixtures } from "./fixtures";

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

export const runEvalDatasets = async (
  mastra: Mastra,
  options: RunEvalDatasetsOptions,
): Promise<EvalExperimentResult[]> => {
  const definitions = runnableDefinitions(options.targetKind);
  const workflowDefinitions = definitions.filter((definition) => definition.targetType === "workflow");
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
      const summary = await dataset.startExperiment({
        name: experimentName(definition),
        targetType,
        targetId,
        maxConcurrency: options.maxConcurrency ?? 1,
      });

      results.push({ datasetName: definition.name, targetType, targetId, summary });
    }

    return results;
  } finally {
    await cleanupWorkflowEvalFixtures(fixtureResourceIds);
  }
};
