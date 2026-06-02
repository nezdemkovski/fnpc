process.env.TELEGRAM_ADAPTER_MODE = "off";

const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg?.slice("--target=".length) ?? "workflow";

if (target !== "agent" && target !== "workflow" && target !== "all") {
  throw new Error(`Unsupported --target value: ${target}`);
}

const { mastra } = await import("../src/mastra");
const { runEvalDatasets } = await import("../src/evals/runner");

const results = await runEvalDatasets(mastra, {
  targetKind: target,
  maxConcurrency: target === "agent" ? 1 : 2,
});

let failedCount = 0;
for (const result of results) {
  failedCount += result.summary.failedCount;
  console.log(
    `${result.datasetName} -> ${result.targetType}:${result.targetId}: ${result.summary.status} (${result.summary.succeededCount}/${result.summary.totalItems} succeeded, ${result.summary.failedCount} failed)`,
  );
}

process.exit(failedCount > 0 ? 1 : 0);
