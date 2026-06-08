import { describe, expect, test } from "bun:test";
import { evalDatasetDefinitions } from "./datasets";

describe("eval dataset definitions", () => {
  test("have unique names, targets, scorers, and items", () => {
    const names = new Set<string>();

    for (const definition of evalDatasetDefinitions) {
      expect(names.has(definition.name), `${definition.name} is duplicated`).toBe(false);
      names.add(definition.name);
      expect(definition.targetType, `${definition.name} targetType`).toBeDefined();
      expect(definition.targetIds?.length, `${definition.name} targetIds`).toBeGreaterThan(0);
      expect(definition.scorerIds.length, `${definition.name} scorerIds`).toBeGreaterThan(0);
      expect(definition.items.length, `${definition.name} items`).toBeGreaterThan(0);
    }
  });

  test("items match their input and ground-truth schemas", () => {
    for (const definition of evalDatasetDefinitions) {
      for (const item of definition.items) {
        expect(() => definition.inputSchema.parse(item.input), `${definition.name} input`).not.toThrow();
        expect(
          () => definition.groundTruthSchema.parse(item.groundTruth),
          `${definition.name} groundTruth`,
        ).not.toThrow();
      }
    }
  });

  test("items carry stable category and case metadata", () => {
    for (const definition of evalDatasetDefinitions) {
      const cases = new Set<string>();
      for (const item of definition.items) {
        expect(typeof item.metadata?.category, `${definition.name} category`).toBe("string");
        expect(typeof item.metadata?.case, `${definition.name} case`).toBe("string");
        const caseKey = `${item.metadata?.category}:${item.metadata?.case}`;
        expect(cases.has(caseKey), `${definition.name} duplicate case ${caseKey}`).toBe(false);
        cases.add(caseKey);
      }
    }
  });

  test("agent routing datasets do not train generic profile mutation", () => {
    const agentDefinitions = evalDatasetDefinitions.filter(
      (definition) => definition.targetType === "agent",
    );

    for (const definition of agentDefinitions) {
      for (const item of definition.items) {
        const groundTruth = item.groundTruth as { toolId?: string };
        expect(groundTruth.toolId, `${definition.name} ${String(item.input)}`).not.toBe(
          "save-financial-facts",
        );
      }
    }
  });
});
