import { describe, expect, test } from "bun:test";

import { normalizeMastraModel } from "./model";

describe("Mastra model configuration", () => {
  test("keeps provider-qualified model identifiers unchanged", () => {
    expect(normalizeMastraModel("xai/grok-4.5")).toBe("xai/grok-4.5");
  });

  test("supports the existing bare Anthropic model identifier", () => {
    expect(normalizeMastraModel("claude-opus-4-7")).toBe(
      "anthropic/claude-opus-4-7",
    );
  });

  test("infers xAI for a bare Grok model identifier", () => {
    expect(normalizeMastraModel("grok-4.5")).toBe("xai/grok-4.5");
  });

  test("rejects an ambiguous bare model identifier", () => {
    expect(() => normalizeMastraModel("some-model")).toThrow(
      "AI_MODEL must include a provider prefix",
    );
  });
});
