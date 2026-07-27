const inferredProviders = [
  ["claude-", "anthropic"],
  ["grok-", "xai"],
] as const;

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
