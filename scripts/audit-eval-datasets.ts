process.env.TELEGRAM_ADAPTER_MODE = "off";

const { evalDatasetDefinitions } = await import("../src/evals/datasets");
const { mastra } = await import("../src/mastra");

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

for (const definition of evalDatasetDefinitions) {
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

  console.log(
    `ok ${definition.name}: ${latest.status}, ${latest.succeededCount}/${latest.totalItems} succeeded, target ${definition.targetType}:${definition.targetIds[0]}`,
  );
}

if (failures > 0) process.exit(1);
