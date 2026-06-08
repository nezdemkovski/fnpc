process.env.TELEGRAM_ADAPTER_MODE = "off";

const { evalDatasetDefinitions } = await import("../src/evals/datasets");
const { scoreAgentRouting, scoreWorkflowContract } = await import("../src/evals/scorers");
const { mastra } = await import("../src/mastra");

const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg?.slice("--target=".length) ?? "all";

if (target !== "agent" && target !== "workflow" && target !== "all") {
  throw new Error(`Unsupported --target value: ${target}`);
}

const listed = await mastra.datasets.list({ page: 0, perPage: 200 });
const listedByName = new Map(listed.datasets.map((dataset) => [dataset.name, dataset]));
const definedNames = new Set(evalDatasetDefinitions.map((definition) => definition.name));

let failures = 0;

for (const dataset of listed.datasets) {
  if (dataset.name.startsWith("fnpc-") && !definedNames.has(dataset.name)) {
    failures += 1;
    console.log(`stale ${dataset.name}: delete by running bun run eval:seed-datasets`);
  }
}

const definitions = evalDatasetDefinitions.filter(
  (definition) => target === "all" || definition.targetType === target,
);

const runStoredOrLocalScorer = ({
  scorerId,
  result,
}: {
  scorerId: string;
  result: any;
}) => {
  const storedScore = result.scores?.find((score: any) => score.scorerId === scorerId);
  if (storedScore) return storedScore;

  if (scorerId === "fnpc-agent-routing-contract") {
    const scored = scoreAgentRouting({
      output: result.output,
      groundTruth: result.groundTruth,
    });
    return { scorerId, ...scored };
  }

  if (scorerId === "fnpc-workflow-contract") {
    const scored = scoreWorkflowContract({
      output: result.output,
      groundTruth: result.groundTruth,
    });
    return { scorerId, ...scored };
  }

  return undefined;
};

for (const definition of definitions) {
  const dataset = listedByName.get(definition.name);
  if (!dataset) {
    failures += 1;
    console.log(`missing ${definition.name}`);
    continue;
  }

  const fullDataset = await mastra.datasets.get({ id: dataset.id });
  const experiments = await fullDataset.listExperiments({ page: 0, perPage: 100 });
  const latest = experiments.experiments.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!definition.targetType || !definition.targetIds?.[0]) {
    failures += 1;
    console.log(`bad ${definition.name}: runnable dataset has no target`);
    continue;
  }

  if (!latest) {
    failures += 1;
    console.log(`not-run ${definition.name}: target ${definition.targetType}:${definition.targetIds[0]}`);
    continue;
  }

  if (latest.status !== "completed" || latest.failedCount > 0) {
    failures += 1;
    console.log(
      `failed ${definition.name}: ${latest.status}, ${latest.succeededCount}/${latest.totalItems} succeeded, ${latest.failedCount} failed`,
    );
    continue;
  }

  const { results } = await fullDataset.listExperimentResults({
    experimentId: latest.id,
    page: 0,
    perPage: 200,
  });
  const expectedScorers = definition.scorerIds;
  const scoreFailures: string[] = [];

  for (const result of results) {
    for (const scorerId of expectedScorers) {
      const score = runStoredOrLocalScorer({ scorerId, result });
      if (!score) {
        scoreFailures.push(`${result.itemId}:${scorerId}:missing`);
        continue;
      }
      if (score.error) {
        scoreFailures.push(`${result.itemId}:${scorerId}:error ${score.error}`);
        continue;
      }
      if (score.score !== 1) {
        scoreFailures.push(`${result.itemId}:${scorerId}:score ${score.score} ${score.reason ?? ""}`.trim());
      }
    }
  }

  if (scoreFailures.length > 0) {
    failures += 1;
    console.log(`bad-scores ${definition.name}:`);
    for (const failure of scoreFailures) console.log(`  ${failure}`);
    continue;
  }

  console.log(
    `ok ${definition.name}: ${latest.status}, ${latest.succeededCount}/${latest.totalItems} succeeded, ${expectedScorers.length} scorer(s), target ${definition.targetType}:${definition.targetIds[0]}`,
  );
}

if (failures > 0) process.exit(1);
