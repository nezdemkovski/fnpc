process.env.TELEGRAM_ADAPTER_MODE = "off";

const { evalDatasetDefinitions } = await import("../src/evals/datasets");
const { mastra } = await import("../src/mastra");

const existing = await mastra.datasets.list({ page: 0, perPage: 100 });
const existingByName = new Map(existing.datasets.map((dataset) => [dataset.name, dataset]));
const definedNames = new Set(evalDatasetDefinitions.map((definition) => definition.name));

for (const dataset of existing.datasets) {
  if (dataset.name.startsWith("fnpc-") && !definedNames.has(dataset.name)) {
    await mastra.datasets.delete({ id: dataset.id });
    console.log(`deleted stale ${dataset.name}`);
  }
}

for (const definition of evalDatasetDefinitions) {
  const current = existingByName.get(definition.name);
  if (current) {
    await mastra.datasets.delete({ id: current.id });
  }

  const dataset = await mastra.datasets.create({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    groundTruthSchema: definition.groundTruthSchema,
    metadata: {
      project: "fnpc",
      seededBy: "scripts/seed-eval-datasets.ts",
      suite: definition.targetType,
      scorerIds: definition.scorerIds,
    },
    targetType: definition.targetType,
    targetIds: definition.targetIds,
  });

  await dataset.addItems({
    items: definition.items.map((item) => ({
      input: item.input,
      groundTruth: item.groundTruth,
      metadata: item.metadata,
      source: "code",
    })),
  });

  const details = await dataset.getDetails();
  console.log(`${details.name}: ${definition.items.length} items`);
}

process.exit(0);
