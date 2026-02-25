import { describe, expect, it } from "vitest";
import { AssumptionDriftPackSchema } from "../schemas.js";

// Minimal valid pack factory to reduce repetition
function validPack(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    gameType: "assumption_drift" as const,
    gameId: "2026-01-01",
    packId: "2026-01-01-test",
    title: "Test Pack",
    meta: { difficulty: "easy", tags: [] },
    payload: {
      instructions: "Pick one.",
      questions: [
        {
          id: "q1",
          scenario: "Scenario text.",
          drift: "Something changes.",
          prompt: "What happens?",
          choiceStyle: "directional",
          choices: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
            { id: "c", label: "Option C" },
          ],
          answer: "a",
          solution: { text: "Because of reason X." },
        },
      ],
    },
    ...overrides,
  };
}

describe("AssumptionDriftPackSchema", () => {
  it("accepts a valid pack with 3 choices", () => {
    const result = AssumptionDriftPackSchema.safeParse(validPack());
    expect(result.success).toBe(true);
  });

  it("accepts a valid pack with 6 choices", () => {
    const pack = validPack();
    pack.payload.questions[0].choices = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
      { id: "e", label: "E" },
      { id: "f", label: "F" },
    ];
    pack.payload.questions[0].answer = "a";
    const result = AssumptionDriftPackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });

  // ── Spec test 1: rejects packs with fewer than 3 choices ────────────────
  it("rejects a pack with fewer than 3 choices", () => {
    const pack = validPack();
    pack.payload.questions[0].choices = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const result = AssumptionDriftPackSchema.safeParse(pack);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("at least 3"))).toBe(true);
    }
  });

  it("rejects a pack with more than 6 choices", () => {
    const pack = validPack();
    pack.payload.questions[0].choices = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      label: `Option ${i}`,
    }));
    pack.payload.questions[0].answer = "0";
    const result = AssumptionDriftPackSchema.safeParse(pack);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("at most 6"))).toBe(true);
    }
  });

  // ── Spec test 2: rejects packs where answer is not one of the choice ids ─
  it("rejects a pack where answer is not one of the choice ids", () => {
    const pack = validPack();
    pack.payload.questions[0].answer = "does_not_exist";
    const result = AssumptionDriftPackSchema.safeParse(pack);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("must be one of the choice ids"))).toBe(true);
    }
  });
});
