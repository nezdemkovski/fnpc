const inferredProviders = [
  ["claude-", "anthropic"],
  ["grok-", "xai"],
] as const;

const xaiReasoningEfforts = ["none", "low", "medium", "high"] as const;

export type XaiReasoningEffort = (typeof xaiReasoningEfforts)[number];

export const normalizeMastraModel = (value: string): string => {
  const model = value.trim();

  if (!model) {
    throw new Error("AI_MODEL must not be empty");
  }

  if (model.includes("/")) {
    return model;
  }

  const inferred = inferredProviders.find(([prefix]) =>
    model.startsWith(prefix),
  );

  if (!inferred) {
    throw new Error(
      `AI_MODEL must include a provider prefix, for example "xai/${model}"`,
    );
  }

  return `${inferred[1]}/${model}`;
};

export const normalizeXaiReasoningEffort = (
  value: string,
): XaiReasoningEffort => {
  const reasoningEffort = value.trim();

  if (xaiReasoningEfforts.includes(reasoningEffort as XaiReasoningEffort)) {
    return reasoningEffort as XaiReasoningEffort;
  }

  throw new Error(
    "XAI_REASONING_EFFORT must be one of: none, low, medium, high",
  );
};

export const modelProviderOptions = (
  model: string,
  reasoningEffort: XaiReasoningEffort,
) =>
  model.startsWith("xai/")
    ? {
        xai: {
          reasoningEffort,
        },
      }
    : undefined;
