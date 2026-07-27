import { describe, expect, test } from "bun:test";

import {
  modelProviderOptions,
  normalizeMastraModel,
  normalizeXaiReasoningEffort,
} from "./model";

describe("Mastra model configuration", () => {
  test("keeps provider-qualified model identifiers unchanged", () => {
    expect(normalizeMastraModel("xai/grok-4.3")).toBe("xai/grok-4.3");
  });

  test("supports the existing bare Anthropic model identifier", () => {
    expect(normalizeMastraModel("claude-opus-4-7")).toBe(
      "anthropic/claude-opus-4-7",
    );
  });

  test("infers xAI for a bare Grok model identifier", () => {
    expect(normalizeMastraModel("grok-4.3")).toBe("xai/grok-4.3");
  });

  test("rejects an ambiguous bare model identifier", () => {
    expect(() => normalizeMastraModel("some-model")).toThrow(
      "AI_MODEL must include a provider prefix",
    );
  });

  test("passes the configured reasoning effort to xAI models", () => {
    expect(modelProviderOptions("xai/grok-4.3", "medium")).toEqual({
      xai: {
        reasoningEffort: "medium",
      },
    });
  });

  test("does not pass xAI options to another provider", () => {
    expect(
      modelProviderOptions("anthropic/claude-opus-4-7", "medium"),
    ).toBeUndefined();
  });

  test("rejects unsupported xAI reasoning efforts", () => {
    expect(() => normalizeXaiReasoningEffort("maximum")).toThrow(
      "XAI_REASONING_EFFORT must be one of",
    );
  });
});
