import { describe, expect, test } from "bun:test";
import { agentInputToTurns } from "./runner";

describe("eval runner", () => {
  test("normalizes single-turn and multi-turn agent inputs", () => {
    expect(agentInputToTurns("How much cash is free?")).toEqual(["How much cash is free?"]);
    expect(agentInputToTurns({ turns: ["Move the chair purchase.", "To August."] })).toEqual([
      "Move the chair purchase.",
      "To August.",
    ]);
  });
});
